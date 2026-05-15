const addressEl = document.getElementById("address");
const copyBtn = document.getElementById("copy");
const copyText = copyBtn.querySelector(".copy-text");
const timelineEl = document.getElementById("timeline");
const botKeyLink = document.getElementById("bot-key-link");
const botKeyInline = document.getElementById("bot-key-inline");
const ttlEl = document.getElementById("ttl");
const pillEl = document.getElementById("status-pill");
const pillLabelEl = document.getElementById("status-pill-label");

const TAG = { ok: "ok", fail: "er", warn: "hm", info: "··", done: "ok" };

const HANDLERS = {
  "session-created": (d) => addEvent("session opened", d.address, "info", d.at),
  "email-received": (d) =>
    addEvent(
      "email received",
      `from ${d.from} · “${d.subject || "(no subject)"}”`,
      "info",
      d.at
    ),
  "encryption-detected": (d) =>
    addEvent("encryption detected", `protocol ${d.protocol}`, "ok", d.at),
  "encryption-missing": (d) =>
    addEvent("encryption missing", "no pgp body found", "fail", d.at),
  decrypted: (d) =>
    addEvent(
      "decrypted with bot key",
      d.signatureKeyIDs.length
        ? `${d.signatureKeyIDs.length} embedded signature(s)`
        : "no embedded signatures",
      "ok",
      d.at
    ),
  "decrypt-failed": (d) =>
    addEvent("decryption failed", d.reason, "fail", d.at),
  "wkd-result": (d) => {
    const via = d.advanced.ok ? "advanced" : d.direct.ok ? "direct" : null;
    if (via) addEvent("wkd lookup", `key found via ${via}`, "ok", d.at);
    else
      addEvent(
        "wkd lookup",
        `advanced=${attemptDescr(d.advanced)} · direct=${attemptDescr(d.direct)}`,
        "fail",
        d.at
      );
  },
  "autocrypt-result": (d) =>
    addEvent(
      "autocrypt header",
      d.found ? "present in message" : d.reason || "not found",
      d.found ? "ok" : "fail",
      d.at
    ),
  "hkps-result": (d) =>
    addEvent(
      "hkps keys.openpgp.org",
      d.found ? "key found" : d.reason || "not found",
      d.found ? "ok" : "fail",
      d.at
    ),
  "key-picked": (d) =>
    addEvent(
      "reply key chosen",
      `${d.source} · fp ${shortFp(d.fingerprint)}`,
      "ok",
      d.at
    ),
  "no-key-found": (d) =>
    addEvent("no reply key", "reply will be plaintext", "warn", d.at),
  "signature-verified": (d) =>
    addEvent("signature verified", `fp ${shortFp(d.fingerprint)}`, "ok", d.at),
  "signature-unverified": (d) =>
    addEvent(
      "signature not verified",
      d.reason || "unknown",
      "fail",
      d.at
    ),
  "reply-sent": (d) =>
    addEvent(
      "reply sent",
      d.encrypted ? "encrypted with your key, signed by me" : "plaintext",
      d.encrypted ? "ok" : "warn",
      d.at
    ),
  done: (d) => {
    addEvent("verification complete", "transmission ended", "done", d.at);
    setPill("complete", "complete");
  },
};

function attemptDescr(a) {
  if (a.ok) return "ok";
  if (a.status) return `http ${a.status}`;
  if (a.error) return a.error;
  return "fail";
}

function shortFp(fp) {
  if (!fp) return "?";
  const hex = String(fp).replace(/\s+/g, "");
  return hex.length > 16 ? `${hex.slice(0, 16)}…` : hex;
}

function formatTime(at) {
  const d = at ? new Date(at) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clearWaiting() {
  const waiting = timelineEl.querySelector(".row--waiting");
  if (waiting) waiting.remove();
}

function addEvent(title, detail, level, at) {
  clearWaiting();
  const li = document.createElement("li");
  li.className = `row row--${level}`;

  const timeEl = document.createElement("span");
  timeEl.className = "row__time";
  timeEl.textContent = formatTime(at);
  li.appendChild(timeEl);

  const tagEl = document.createElement("span");
  tagEl.className = "row__tag";
  tagEl.textContent = TAG[level] ?? "··";
  li.appendChild(tagEl);

  const titleEl = document.createElement("span");
  titleEl.className = "row__title";
  titleEl.textContent = String(title);
  li.appendChild(titleEl);

  if (detail) {
    const detailEl = document.createElement("span");
    detailEl.className = "row__detail";
    detailEl.textContent = String(detail);
    li.appendChild(detailEl);
  }

  timelineEl.appendChild(li);
  li.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setPill(state, label) {
  pillEl.dataset.state = state;
  pillLabelEl.textContent = label;
}

function paintAddress(address) {
  addressEl.textContent = "";
  const at = address.indexOf("@");
  const plus = address.indexOf("+");
  if (plus > 0 && plus < at) {
    addressEl.append(document.createTextNode(address.slice(0, plus)));
    const span = document.createElement("span");
    span.className = "addr-token";
    span.textContent = address.slice(plus, at);
    addressEl.appendChild(span);
    addressEl.append(document.createTextNode(address.slice(at)));
  } else {
    addressEl.textContent = address;
  }
}

function setBotKeyLinks(address) {
  const at = address.indexOf("@");
  const domain = at >= 0 ? address.slice(at + 1) : "";
  const href = `https://${domain}/bot-key.asc`;
  if (botKeyLink) botKeyLink.href = href;
  if (botKeyInline) botKeyInline.href = href;
}

function startTtlCountdown(expiresAt) {
  if (!ttlEl) return;
  const update = () => {
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      ttlEl.textContent = "expired · reload";
      return;
    }
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    ttlEl.textContent = `valid · ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };
  update();
  setInterval(update, 1000);
}

async function start() {
  setPill("connecting", "booting");
  let res;
  try {
    res = await fetch("/api/session", { method: "POST" });
  } catch (err) {
    setPill("error", "offline");
    addressEl.textContent = "could not reach worker";
    return;
  }
  if (!res.ok) {
    setPill("error", "session failed");
    addressEl.textContent = "could not create session";
    return;
  }
  const { token, address } = await res.json();
  paintAddress(address);
  setBotKeyLinks(address);
  startTtlCountdown(Date.now() + 60 * 60 * 1000);
  copyBtn.disabled = false;
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(address);
      copyBtn.dataset.copied = "true";
      copyText.textContent = "copied";
      setTimeout(() => {
        delete copyBtn.dataset.copied;
        copyText.textContent = "copy";
      }, 1400);
    } catch {
      copyText.textContent = "press ⌘C";
    }
  };
  openStream(token);
}

function openStream(token) {
  const sse = new EventSource(`/api/session/${token}/stream`);

  sse.addEventListener("open", () => setPill("live", "live · awaiting"));

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
        const data = JSON.parse(e.data);
        fn(data);
        if (name === "email-received") setPill("live", "live · verifying");
      } catch (err) {
        console.warn(name, "parse failed", err);
      }
      if (name === "done") sse.close();
    });
  }

  sse.onerror = () => {
    if (pillEl.dataset.state === "live") return;
    setPill("error", "reconnecting");
  };
}

start();
