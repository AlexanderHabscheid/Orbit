import test from "node:test";
import assert from "node:assert/strict";
import { createEnvelope, validateEnvelope } from "../src/envelope.js";

test("createEnvelope + validateEnvelope roundtrip", () => {
  const env = createEnvelope({
    kind: "request",
    runId: "run-123",
    payload: { hello: "world" },
    provenance: { caller: "test" }
  });
  const validated = validateEnvelope(env);
  assert.equal(validated.run_id, "run-123");
  assert.deepEqual(validated.payload, { hello: "world" });
});

test("validateEnvelope rejects hash tampering", () => {
  const env = createEnvelope({
    kind: "event",
    runId: "run-123",
    payload: { a: 1 }
  });
  const tampered = { ...env, payload: { a: 2 } };
  assert.throws(() => validateEnvelope(tampered), /hash mismatch/i);
});

test("createEnvelope supports data_pack reference", () => {
  const env = createEnvelope({
    kind: "event",
    runId: "run-555",
    payload: { kind: "artifact" },
    dataPack: { bucket: "orbit_datapacks", key: "run-555/blob.bin", bytes: 10 }
  });
  const validated = validateEnvelope(env);
  assert.equal(validated.data_pack?.bucket, "orbit_datapacks");
  assert.equal(validated.data_pack?.key, "run-555/blob.bin");
});

test("createEnvelope supports a2a metadata", () => {
  const env = createEnvelope({
    kind: "request",
    runId: "run-a2a",
    payload: { text: "hello" },
    a2a: {
      task_id: "task-1",
      thread_id: "thread-1",
      parent_message_id: "msg-0",
      capabilities: ["search", "summarize"],
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
      dedupe_key: "event-123"
    }
  });
  const validated = validateEnvelope(env);
  assert.equal(validated.a2a?.task_id, "task-1");
  assert.deepEqual(validated.a2a?.capabilities, ["search", "summarize"]);
});

test("validateEnvelope rejects invalid a2a metadata", () => {
  const env = createEnvelope({
    kind: "event",
    runId: "run-a2a-invalid",
    payload: { ok: true }
  });
  const tampered = {
    ...env,
    a2a: {
      task_id: "",
      capabilities: ["ok", 3]
    }
  };
  assert.throws(() => validateEnvelope(tampered), /a2a/i);
});
