import test from "node:test";
import assert from "node:assert/strict";
import { actionFromApiPath, parseObjectPayload, validateActionPayload } from "../src/api_contract.js";

test("actionFromApiPath resolves valid routes", () => {
  assert.equal(actionFromApiPath("/v1/call"), "call");
  assert.equal(actionFromApiPath("/v1/publish"), "publish");
  assert.equal(actionFromApiPath("/v1/inspect"), "inspect");
  assert.equal(actionFromApiPath("/v1/ping"), "ping");
  assert.equal(actionFromApiPath("/v1/federate"), "federate");
  assert.equal(actionFromApiPath("/v1/bridge"), "bridge");
  assert.equal(actionFromApiPath("/v1/abuse_report"), "abuse_report");
});

test("actionFromApiPath rejects invalid routes", () => {
  assert.equal(actionFromApiPath("/v2/call"), null);
  assert.equal(actionFromApiPath("/v1"), null);
  assert.equal(actionFromApiPath("/foo/bar"), null);
});

test("parseObjectPayload accepts objects and rejects arrays/scalars", () => {
  assert.deepEqual(parseObjectPayload({ a: 1 }), { a: 1 });
  assert.throws(() => parseObjectPayload([]));
  assert.throws(() => parseObjectPayload("x"));
});

test("validateActionPayload enforces strict call/publish/inspect payloads", () => {
  assert.doesNotThrow(() =>
    validateActionPayload("call", {
      target: "svc.method",
      body: { ok: true },
      retries: 1,
      taskId: "task-1",
      threadId: "thread-1",
      parentMessageId: "msg-0",
      capabilities: ["search"],
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
      dedupeKey: "call-dedupe"
    })
  );
  assert.doesNotThrow(() =>
    validateActionPayload("publish", {
      topic: "events.x",
      body: { ok: true },
      durable: true,
      dedupeKey: "event-1"
    })
  );
  assert.throws(() => validateActionPayload("call", { target: "svc.method" }));
  assert.throws(() => validateActionPayload("publish", { topic: "events.x" }));
  assert.throws(() => validateActionPayload("inspect", { service: "", timeoutMs: 0 }));
  assert.doesNotThrow(() =>
    validateActionPayload("federate", {
      to: "worker@example.org",
      target: "svc.method",
      body: { ok: true },
      deliveryClass: "durable"
    })
  );
  assert.throws(() => validateActionPayload("federate", { to: "bad", target: "x", body: {} }));
  assert.doesNotThrow(() =>
    validateActionPayload("bridge", {
      protocol: "a2a",
      message: { payload: { x: 1 } }
    })
  );
  assert.doesNotThrow(() =>
    validateActionPayload("abuse_report", {
      reporter: "ops@example.org",
      subject: "bot@evil.org",
      reason: "spam"
    })
  );
});
