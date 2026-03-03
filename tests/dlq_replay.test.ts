import test from "node:test";
import assert from "node:assert/strict";
import { replayBytesFromDlqPayload } from "../src/commands/dlq_replay.js";

test("replayBytesFromDlqPayload prefers original.base64", () => {
  const bytes = replayBytesFromDlqPayload(
    {
      original: {
        base64: Buffer.from('{"ok":true}', "utf-8").toString("base64")
      }
    },
    Buffer.from("fallback", "utf-8")
  );
  assert.equal(Buffer.from(bytes).toString("utf-8"), '{"ok":true}');
});

test("replayBytesFromDlqPayload falls back to payload object", () => {
  const bytes = replayBytesFromDlqPayload({ payload: { k: "v" } }, Buffer.from("fallback", "utf-8"));
  assert.equal(Buffer.from(bytes).toString("utf-8"), '{"k":"v"}');
});

test("replayBytesFromDlqPayload uses fallback for unknown format", () => {
  const fallback = Buffer.from("fallback", "utf-8");
  const bytes = replayBytesFromDlqPayload({ x: 1 }, fallback);
  assert.equal(Buffer.from(bytes).toString("utf-8"), "fallback");
});
