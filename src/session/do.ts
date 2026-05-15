import * as openpgp from "openpgp";

import type { SessionEvent, SessionState, SessionStatus } from "./events.js";

const TTL_MS = 60 * 60 * 1000;
const STORAGE_KEY = "state";
const MAX_EVENTS = 128;

async function generateSessionKey(address: string): Promise<{
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "mailenc session", email: address }],
    format: "armored",
  });
  const parsed = await openpgp.readKey({ armoredKey: publicKey });
  return {
    privateKey,
    publicKey,
    fingerprint: parsed.getFingerprint().toUpperCase(),
  };
}

function publicView(state: SessionState) {
  const { privateKey: _priv, ...rest } = state;
  return rest;
}

type Env = {
  EMAIL_DOMAIN: string;
  BOT_LOCALPART: string;
};

export class SessionDO {
  private state: DurableObjectState;
  private env: Env;
  private loaded = false;
  private data: SessionState | null = null;
  private clients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private encoder = new TextEncoder();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async load() {
    if (this.loaded) return;
    const stored = await this.state.storage.get<SessionState>(STORAGE_KEY);
    if (stored) this.data = stored;
    this.loaded = true;
  }

  private async save() {
    if (!this.data) return;
    await this.state.storage.put(STORAGE_KEY, this.data);
  }

  async fetch(req: Request): Promise<Response> {
    await this.load();
    const url = new URL(req.url);
    try {
      if (req.method === "POST" && url.pathname === "/init") {
        return await this.handleInit(req);
      }
      if (req.method === "POST" && url.pathname === "/event") {
        return await this.handleEvent(req);
      }
      if (req.method === "POST" && url.pathname === "/status") {
        return await this.handleStatus(req);
      }
      if (req.method === "GET" && url.pathname === "/state") {
        return this.handleStateRead();
      }
      if (req.method === "GET" && url.pathname === "/stream") {
        return this.handleStream();
      }
      if (req.method === "GET" && url.pathname === "/public-key") {
        return this.handlePublicKey();
      }
      if (req.method === "GET" && url.pathname === "/private-key") {
        return this.handlePrivateKey();
      }
      return new Response("not found", { status: 404 });
    } catch (err) {
      return new Response(
        err instanceof Error ? err.message : String(err),
        { status: 500 }
      );
    }
  }

  private async handleInit(req: Request): Promise<Response> {
    const { token } = (await req.json()) as { token: string };
    const now = Date.now();
    if (this.data) {
      return Response.json({ already: true, state: publicView(this.data) });
    }
    const address = `${this.env.BOT_LOCALPART}+${token}@${this.env.EMAIL_DOMAIN}`;
    const keys = await generateSessionKey(address);
    this.data = {
      token,
      address,
      status: "awaiting",
      createdAt: now,
      expiresAt: now + TTL_MS,
      events: [{ kind: "session-created", at: now, address }],
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      fingerprint: keys.fingerprint,
    };
    await this.save();
    await this.state.storage.setAlarm(now + TTL_MS);
    return Response.json({ already: false, state: publicView(this.data) });
  }

  private async handleEvent(req: Request): Promise<Response> {
    const ev = (await req.json()) as SessionEvent;
    if (!this.data) return new Response("no session", { status: 404 });
    if (this.data.events.length >= MAX_EVENTS) {
      return Response.json({ ok: false, dropped: "event cap reached" });
    }
    this.data.events.push(ev);
    if (ev.kind === "email-received" && this.data.status === "awaiting") {
      this.data.status = "processing";
    }
    if (ev.kind === "done") {
      this.data.status = "done";
    }
    await this.save();
    await this.broadcast(ev);
    return Response.json({ ok: true });
  }

  private async handleStatus(req: Request): Promise<Response> {
    const { status } = (await req.json()) as { status: SessionStatus };
    if (!this.data) return new Response("no session", { status: 404 });
    this.data.status = status;
    await this.save();
    return Response.json({ ok: true });
  }

  private handleStateRead(): Response {
    if (!this.data) return new Response("not found", { status: 404 });
    return Response.json(publicView(this.data));
  }

  private handlePublicKey(): Response {
    if (!this.data) return new Response("not found", { status: 404 });
    return new Response(this.data.publicKey, {
      status: 200,
      headers: { "Content-Type": "application/pgp-keys; charset=utf-8" },
    });
  }

  private handlePrivateKey(): Response {
    if (!this.data) return new Response("not found", { status: 404 });
    return new Response(this.data.privateKey, {
      status: 200,
      headers: { "Content-Type": "application/pgp-keys; charset=utf-8" },
    });
  }

  private handleStream(): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.clients.add(writer);
    const replay = async () => {
      try {
        await writer.write(this.encoder.encode(": connected\n\n"));
        if (this.data) {
          const safe = publicView(this.data);
          await this.writeEvent(
            writer,
            "snapshot",
            { state: { ...safe, events: [] }, events: safe.events }
          );
        }
      } catch {
        this.clients.delete(writer);
      }
    };
    replay();
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  private async writeEvent(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    name: string,
    payload: unknown
  ) {
    const chunk = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
    await writer.write(this.encoder.encode(chunk));
  }

  private async broadcast(ev: SessionEvent) {
    const dead: WritableStreamDefaultWriter<Uint8Array>[] = [];
    for (const w of this.clients) {
      try {
        await this.writeEvent(w, ev.kind, ev);
      } catch {
        dead.push(w);
      }
    }
    for (const w of dead) {
      this.clients.delete(w);
      try {
        await w.close();
      } catch {}
    }
  }

  async alarm(): Promise<void> {
    if (this.data) {
      this.data.status = "expired";
      await this.save();
    }
    for (const w of this.clients) {
      try {
        await w.close();
      } catch {}
    }
    this.clients.clear();
    await this.state.storage.deleteAll();
  }
}
