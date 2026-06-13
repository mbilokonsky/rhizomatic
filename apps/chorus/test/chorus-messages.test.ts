// Cross-session messages: ephemeral salience over a permanent record. Correspondence
// addresses declared identity, lands only in the addressed inboxes, leaves on ack, and
// never touches the knowledge surfaces.

import { describe, expect, it } from "vitest";
import { inbox, type MessageView } from "../src/messages.js";
import { callTool, createSession, type SessionContext } from "../src/mcp-server.js";
import type { Briefing } from "../src/briefing.js";
import type { Topic } from "../src/discovery.js";

const clockFrom = (start: number) => {
  let t = start;
  return () => (t += 10);
};

const MASTER = "0f".repeat(32);
const mk = (sessionId: string, t0: number): SessionContext =>
  createSession({ masterSeedHex: MASTER, sessionId, clock: clockFrom(t0) });

// Two sessions, one world: B imports A's snapshot after A posts.
const share = (from: SessionContext, to: SessionContext) =>
  to.agent.importSet(from.agent.snapshot());

describe("chorus messages: post → inbox → ack", () => {
  it("addresses declared identity: surface, model, topic (incl. prefix), session, broadcast", () => {
    const sender = mk("sender", 1000);
    callTool(sender, "begin-session", { model: "claude-fable-5", surface: "claude-desktop" });
    callTool(sender, "post", { body: "for code sessions", to: { surface: "claude-code" } });
    callTool(sender, "post", { body: "for haiku", to: { model: "claude-haiku-4-5" } });
    callTool(sender, "post", { body: "for the tracker", to: { topics: ["synchronicity:"] } });
    callTool(sender, "post", { body: "for everyone" });

    const code = mk("code", 5000);
    callTool(code, "begin-session", {
      model: "claude-fable-5",
      surface: "claude-code",
      topics: ["synchronicity:mirror"],
    });
    share(sender, code);
    const mail = callTool(code, "inbox", {}) as MessageView[];
    // Surface match, topic prefix match (mirror ∈ synchronicity:), and the broadcast —
    // but not the haiku-addressed one.
    expect(mail.map((m) => m.body).sort()).toEqual([
      "for code sessions",
      "for everyone",
      "for the tracker",
    ]);
    // Sender receipts resolve through identity.
    expect(mail[0]!.from.model).toBe("claude-fable-5");
    expect(mail[0]!.from.sessionId).toBe("sender");
    // The sender's own inbox holds none of its mail.
    expect((callTool(sender, "inbox", {}) as MessageView[]).map((m) => m.body)).not.toContain(
      "for everyone",
    );
  });

  it("ack is per-recipient; retract withdraws globally", () => {
    const sender = mk("sender", 1000);
    callTool(sender, "begin-session", { model: "claude-fable-5" });
    const posted = callTool(sender, "post", { body: "handle this" }) as { messageId: string };
    const withdrawn = callTool(sender, "post", { body: "never mind" }) as { messageId: string };

    const a = mk("a", 5000);
    callTool(a, "begin-session", { model: "claude-fable-5" });
    const b = mk("b", 9000);
    callTool(b, "begin-session", { model: "claude-fable-5" });
    share(sender, a);
    share(sender, b);

    // A acks; the message leaves A's inbox but stays in B's.
    callTool(a, "ack", { messageId: posted.messageId, note: "done" });
    expect((callTool(a, "inbox", {}) as MessageView[]).map((m) => m.body)).not.toContain(
      "handle this",
    );
    expect((callTool(b, "inbox", {}) as MessageView[]).map((m) => m.body)).toContain("handle this");
    // includeAcked shows handled mail, marked.
    const acked = (callTool(a, "inbox", { includeAcked: true }) as MessageView[]).find(
      (m) => m.body === "handle this",
    )!;
    expect(acked.acked).toBe(true);
    // The sender retracts the second message — gone for everyone.
    callTool(sender, "retract", { deltaId: withdrawn.messageId, reason: "obsolete" });
    share(sender, b);
    expect((callTool(b, "inbox", {}) as MessageView[]).map((m) => m.body)).not.toContain(
      "never mind",
    );
  });

  it("threads via re; concerns entities without filing at them", () => {
    const asker = mk("asker", 1000);
    callTool(asker, "begin-session", { model: "claude-fable-5" });
    const q = callTool(asker, "post", {
      body: "should composed-of migrate?",
      about: ["proj:chorus"],
    }) as { messageId: string };

    const answerer = mk("answerer", 5000);
    callTool(answerer, "begin-session", { model: "claude-fable-5" });
    share(asker, answerer);
    callTool(answerer, "post", { body: "yes — recast it", re: q.messageId });
    share(answerer, asker);

    const reply = (callTool(asker, "inbox", {}) as MessageView[]).find(
      (m) => m.body === "yes — recast it",
    )!;
    expect(reply.re).toBe(q.messageId);
    // The about-reference does not file at the entity: recall stays clean.
    expect(callTool(asker, "recall", { entity: "proj:chorus" })).toEqual({});
  });

  it("messages never enter the knowledge surfaces; the briefing carries the inbox", () => {
    const sender = mk("sender", 1000);
    callTool(sender, "begin-session", { model: "claude-fable-5" });
    callTool(sender, "remember", { about: "proj:x", attribute: "status", value: "green" });
    callTool(sender, "post", { body: "secret handshake about proj:x", about: ["proj:x"] });

    const reader = mk("reader", 5000);
    callTool(reader, "begin-session", { model: "claude-fable-5" });
    share(sender, reader);
    // Invisible to discovery: topics shows only the belief entity, search misses the body.
    const tops = callTool(reader, "topics", {}) as Topic[];
    expect(tops.map((t) => t.entity)).toEqual(["proj:x"]);
    expect(callTool(reader, "search", { query: "secret handshake" })).toEqual([]);
    // The briefing delivers it as mail, not knowledge.
    const briefed = callTool(reader, "briefing", {}) as Briefing & { inbox: MessageView[] };
    expect(briefed.inbox.map((m) => m.body)).toContain("secret handshake about proj:x");
    expect(briefed.contested).toEqual([]);
  });

  it("author mail: authorOf addresses whoever signed a delta — the exact keypair", () => {
    // The canonical gesture: one process notices something another process wrote.
    const writer = mk("writer", 1000);
    callTool(writer, "begin-session", { model: "claude-fable-5" });
    const claim = callTool(writer, "remember", {
      about: "svc:api",
      attribute: "owner",
      value: "team-a",
    }) as { deltaId: string };

    const noticer = mk("noticer", 5000);
    callTool(noticer, "begin-session", { model: "claude-fable-5" });
    share(writer, noticer);
    callTool(noticer, "post", {
      body: "is owner=team-a still true?",
      to: { authorOf: claim.deltaId },
      about: ["svc:api"],
    });

    const bystander = mk("bystander", 9000);
    callTool(bystander, "begin-session", { model: "claude-fable-5" });
    share(noticer, writer);
    share(noticer, bystander);
    // Only the claim's author receives it — not a same-model bystander.
    expect((callTool(writer, "inbox", {}) as MessageView[]).map((m) => m.body)).toContain(
      "is owner=team-a still true?",
    );
    expect((callTool(bystander, "inbox", {}) as MessageView[]).map((m) => m.body)).not.toContain(
      "is owner=team-a still true?",
    );
    // Addressing an unknown delta fails loudly.
    expect(() => callTool(noticer, "post", { body: "?", to: { authorOf: "ffff" } })).toThrow(
      /unknown delta/,
    );
  });

  it("an ack can point at its disposition's artifacts", () => {
    const sender = mk("sender", 1000);
    callTool(sender, "begin-session", { model: "claude-fable-5" });
    const posted = callTool(sender, "post", { body: "please clarify proj:x status" }) as {
      messageId: string;
    };
    const handler = mk("handler", 5000);
    callTool(handler, "begin-session", { model: "claude-fable-5" });
    share(sender, handler);
    // The response is an EFFECT (a clarifying belief), the ack points at it.
    callTool(handler, "remember", {
      about: "proj:x",
      attribute: "status",
      value: "green, as of Q3",
    });
    const a = callTool(handler, "ack", {
      messageId: posted.messageId,
      note: "clarified in the knowledge graph",
      about: ["proj:x"],
    }) as { ackId: string };
    const ackDelta = handler.agent.peer.reactor.get(a.ackId)!;
    const refs = ackDelta.claims.pointers
      .filter((p) => p.role === "chorus.message.about" && p.target.kind === "entity")
      .map((p) => (p.target.kind === "entity" ? p.target.entity.id : ""));
    expect(refs).toEqual(["proj:x"]);
    // And the artifact reference does not file at the entity.
    expect(callTool(handler, "recall", { entity: "proj:x" })).toEqual({
      status: "green, as of Q3",
    });
  });

  it("the human's mail: toUser lands in the console's inbox, signed acks clear it", () => {
    const sender = mk("sender", 1000);
    callTool(sender, "begin-session", { model: "claude-fable-5" });
    callTool(sender, "post", {
      body: "Myk: the mirror photo is still unuploaded",
      to: { user: true },
    });
    // A session inbox does NOT receive user-addressed mail…
    const other = mk("other", 5000);
    callTool(other, "begin-session", { model: "claude-fable-5" });
    share(sender, other);
    expect((callTool(other, "inbox", {}) as MessageView[]).map((m) => m.body)).not.toContain(
      "Myk: the mirror photo is still unuploaded",
    );
    // …the user's does (the console reads with user: true).
    const mail = inbox(other.agent, {
      author: other.userAuthor,
      user: true,
      userAuthor: other.userAuthor,
    });
    expect(mail.map((m) => m.body)).toContain("Myk: the mirror photo is still unuploaded");
  });
});
