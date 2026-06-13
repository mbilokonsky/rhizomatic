// The streamable-HTTP transport: the same protocol brain as stdio, served to remote
// surfaces. One Mcp-Session-Id = one chorus session = one author.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startHttpServer, type HttpServerHandle } from "../src/mcp-http.js";

const MASTER = "0f".repeat(32);
const dir = mkdtempSync(join(tmpdir(), "chorus-http-"));
const handles: HttpServerHandle[] = [];
afterAll(() => {
  for (const h of handles) h.close();
  rmSync(dir, { recursive: true, force: true });
});

async function serve(file: string): Promise<HttpServerHandle> {
  const handle = await startHttpServer({
    masterSeedHex: MASTER,
    storePath: join(dir, file),
    token: "s3cret",
    port: 0,
  });
  handles.push(handle);
  return handle;
}

interface Rpc {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function client(base: string) {
  let sessionId: string | undefined;
  const post = async (body: unknown): Promise<{ status: number; rpc?: Rpc }> => {
    const res = await fetch(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
      },
      body: JSON.stringify(body),
    });
    sessionId = res.headers.get("mcp-session-id") ?? sessionId;
    if (res.status === 202) return { status: res.status };
    return { status: res.status, rpc: (await res.json()) as Rpc };
  };
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const { rpc } = await post({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e9),
      method: "tools/call",
      params: { name, arguments: args },
    });
    const content = (rpc!.result as { content: Array<{ text: string }> }).content;
    return JSON.parse(content[0]!.text) as unknown;
  };
  return { post, call, sessionId: () => sessionId };
}

describe("chorus over streamable HTTP", () => {
  it("handshake → session header → tools → a working remote session", async () => {
    const h = await serve("remote.jsonl");
    const c = client(h.url);

    const init = await c.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", clientInfo: { name: "test", version: "0" } },
    });
    expect(init.status).toBe(200);
    expect(init.rpc!.result!["protocolVersion"]).toBe("2025-03-26"); // echoed, not pinned
    expect(c.sessionId()).toBeDefined();

    const note = await c.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202); // notification: accepted, no body

    const intro = (await c.call("begin-session", {
      model: "claude-fable-5",
      surface: "claude-web",
      topics: ["proj:chorus"],
    })) as { sessionAuthor: string };
    await c.call("remember", { about: "t:remote", attribute: "works", value: true });
    expect(await c.call("recall", { entity: "t:remote" })).toEqual({ works: true });
    expect(intro.sessionAuthor).toMatch(/^ed25519:/);
  });

  it("two MCP sessions are two authors; DELETE ends a session", async () => {
    const h = await serve("authors.jsonl");
    const a = client(h.url);
    const b = client(h.url);
    await a.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await b.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const ia = (await a.call("whoami", {})) as { sessionAuthor: string };
    const ib = (await b.call("whoami", {})) as { sessionAuthor: string };
    expect(ia.sessionAuthor).not.toBe(ib.sessionAuthor);

    // DELETE terminates: subsequent calls 404 until re-initialize.
    await fetch(h.url, {
      method: "DELETE",
      headers: { "mcp-session-id": a.sessionId()! },
    });
    const dead = await a.post({ jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(dead.status).toBe(404);
  });

  it("auth: wrong path 404s without a body; bearer on /mcp works; HEAD discovers", async () => {
    const h = await serve("auth.jsonl");
    const root = h.url.slice(0, h.url.indexOf("/mcp"));
    expect((await fetch(`${root}/mcp/wrong`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(h.url, { method: "HEAD" })).status).toBe(200);
    const bearer = await fetch(`${root}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer s3cret", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(bearer.status).toBe(200);
    // A call without a session 404s with the re-initialize hint.
    const stray = await fetch(h.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(stray.status).toBe(404);
    expect(((await stray.json()) as Rpc).error!.message).toMatch(/re-initialize/);
  });

  it("remote sessions share the world with everything else through the store", async () => {
    const h = await serve("shared.jsonl");
    const writer = client(h.url);
    await writer.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await writer.call("begin-session", { model: "claude-fable-5", surface: "claude-web" });
    await writer.call("remember", {
      about: "user:mike",
      attribute: "tone",
      value: "direct",
      kind: "preference",
      speaker: "user",
    });

    const reader = client(h.url);
    await reader.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const view = await reader.call("recall", { entity: "user:mike" });
    expect(view).toEqual({ tone: "direct" });
  });
});
