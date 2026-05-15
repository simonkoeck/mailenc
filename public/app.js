const addressEl = document.getElementById("address");
const copyBtn = document.getElementById("copy");
const timelineEl = document.getElementById("timeline");
const botKeyLink = document.getElementById("bot-key-link");

const HANDLERS = {
  "session-created": (d) => addEvent("Session opened", d.address, "info"),
  "email-received": (d) =>
    addEvent("Email received", `from ${d.from} — “${d.subject}”`, "info"),
  "encryption-detected": (d) =>
    addEvent("Encryption detected", `protocol: ${d.protocol}`, "ok"),
  "encryption-missing": () =>
    addEvent("Encryption missing", "no PGP body found", "fail"),
  decrypted: (d) =>
    addEvent(
      "Decrypted with bot key",
      d.signatureKeyIDs.length
        ? `${d.signatureKeyIDs.length} embedded signature(s)`
        : "no embedded signatures",
      "ok"
    ),
  "decrypt-failed": (d) => addEvent("Decryption failed", d.reason, "fail"),
  "wkd-result": (d) => {
    const status = d.advanced.ok ? "advanced" : d.direct.ok ? "direct" : null;
    if (status) addEvent("WKD lookup", `success via ${status}`, "ok");
    else
      addEvent(
        "WKD lookup",
        `advanced=${attemptDescr(d.advanced)} · direct=${attemptDescr(d.direct)}`,
        "fail"
      );
  },
  "autocrypt-result": (d) =>
    addEvent(
      "Autocrypt header",
      d.found ? "present in message" : d.reason || "not found",
      d.found ? "ok" : "fail"
    ),
  "hkps-result": (d) =>
    addEvent(
      "HKPS keys.openpgp.org",
      d.found ? "key found" : d.reason || "not found",
      d.found ? "ok" : "fail"
    ),
  "key-picked": (d) =>
    addEvent("Reply key chosen", `${d.source} · fp ${shortFp(d.fingerprint)}`, "ok"),
  "no-key-found": () =>
    addEvent("No reply key", "reply will be plaintext", "warn"),
  "signature-verified": (d) =>
    addEvent("Signature verified", `fp ${shortFp(d.fingerprint)}`, "ok"),
  "signature-unverified": (d) =>
    addEvent("Signature not verified", d.reason || "unknown", "fail"),
  "reply-sent": (d) =>
    addEvent("Reply sent", d.encrypted ? "encrypted" : "plaintext", d.encrypted ? "ok" : "warn"),
  done: () => addEvent("Done", "verification complete", "ok"),
};

function attemptDescr(a) {
  if (a.ok) return "ok";
  if (a.status) return `HTTP ${a.status}`;
  if (a.error) return a.error;
  return "fail";
}

function shortFp(fp) {
  if (!fp) return "?";
  const hex = String(fp).replace(/\s+/g, "");
  return hex.length > 10 ? `${hex.slice(0, 10)}…` : hex;
}

function addEvent(title, detail, level) {
  const waiting = timelineEl.querySelector(".waiting");
  if (waiting) waiting.remove();
  const li = document.createElement("li");
  li.className = `event event--${level}`;

  const marker = document.createElement("span");
  marker.className = "event__marker";
  li.appendChild(marker);

  const body = document.createElement("span");
  body.className = "event__body";

  const titleEl = document.createElement("span");
  titleEl.className = "event__title";
  titleEl.textContent = String(title);
  body.appendChild(titleEl);

  const detailEl = document.createElement("span");
  detailEl.className = "event__detail";
  detailEl.textContent = String(detail ?? "");
  body.appendChild(detailEl);

  li.appendChild(body);
  timelineEl.appendChild(li);
  li.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function start() {
  const res = await fetch("/api/session", { method: "POST" });
  if (!res.ok) {
    addressEl.textContent = "Failed to create session";
    return;
  }
  const { token, address } = await res.json();
  addressEl.textContent = address;
  copyBtn.disabled = false;
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(address);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    } catch {
      copyBtn.textContent = "Press Ctrl-C";
    }
  };
  if (botKeyLink) {
    const at = address.indexOf("@");
    const domain = at >= 0 ? address.slice(at + 1) : "";
    botKeyLink.href = `https://${domain}/.well-known/openpgpkey/policy`;
  }
  openStream(token);
}

function openStream(token) {
  const sse = new EventSource(`/api/session/${token}/stream`);

  sse.addEventListener("snapshot", (e) => {
    try {
      const data = JSON.parse(e.data);
      for (const ev of data.events ?? []) {
        const h = HANDLERS[ev.kind];
        if (h) h(ev);
      }
    } catch (err) {
      console.warn("snapshot parse failed", err);
    }
  });

  for (const [name, fn] of Object.entries(HANDLERS)) {
    sse.addEventListener(name, (e) => {
      try {
        fn(JSON.parse(e.data));
      } catch (err) {
        console.warn(name, "parse failed", err);
      }
      if (name === "done") sse.close();
    });
  }

  sse.onerror = () => {
    // EventSource auto-reconnects.
  };
}

start();
