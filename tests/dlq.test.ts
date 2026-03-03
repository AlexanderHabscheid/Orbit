import test from "node:test";
import assert from "node:assert/strict";
import { extractDlqMeta, matchesDlqFilter, normalizeErrorCode, parseOptionalIsoTs } from "../src/dlq.js";

test("parseOptionalIsoTs parses ISO values", () => {
  const ms = parseOptionalIsoTs("2026-02-26T12:00:00.000Z", "--from-ts");
  assert.equal(typeof ms, "number");
});

test("normalizeErrorCode uppercases and trims", () => {
  assert.equal(normalizeErrorCode(" bad_target "), "BAD_TARGET");
});

test("extractDlqMeta resolves explicit code and source fields", () => {
  const meta = extractDlqMeta({
    failed_at: "2026-02-26T12:00:00.000Z",
    source: {
      topic: "agents.events",
      stream: "orbit_agents_stream",
      consumer: "agents-consumer",
      delivery_count: 5,
      error: "BAD_TARGET: target must be <svc>.<method>",
      error_code: "BAD_TARGET"
    }
  });
  assert.equal(meta.errorCode, "BAD_TARGET");
  assert.equal(meta.sourceConsumer, "agents-consumer");
});

test("matchesDlqFilter applies timestamp/code/consumer filters", () => {
  const meta = extractDlqMeta({
    failed_at: "2026-02-26T12:00:00.000Z",
    source: { consumer: "agents-consumer", error_code: "AGENT_OVERLOADED" }
  });
  assert.equal(
    matchesDlqFilter(meta, {
      fromTsMs: Date.parse("2026-02-26T11:59:00.000Z"),
      toTsMs: Date.parse("2026-02-26T12:01:00.000Z"),
      errorCode: "agent_overloaded",
      sourceConsumer: "agents-consumer"
    }),
    true
  );
  assert.equal(matchesDlqFilter(meta, { errorCode: "BAD_TARGET" }), false);
});
