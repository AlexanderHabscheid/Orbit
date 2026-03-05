import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBridgeMessage } from "../src/bridge/protocols.js";

test("normalizeBridgeMessage maps a2a fields", () => {
  const out = normalizeBridgeMessage({
    protocol: "a2a",
    message: {
      target: "svc.method",
      payload: { x: 1 },
      task_id: "t1",
      dedupe_key: "d1"
    }
  });
  assert.equal(out.targetHint, "svc.method");
  assert.deepEqual(out.body, { x: 1 });
  assert.equal(out.a2a?.task_id, "t1");
});

test("normalizeBridgeMessage maps mcp fields", () => {
  const out = normalizeBridgeMessage({
    protocol: "mcp",
    message: {
      method: "tool.call",
      params: { q: "x" },
      id: "1"
    }
  });
  assert.equal(out.targetHint, "mcp.tool.call");
  assert.deepEqual(out.body, { method: "tool.call", params: { q: "x" }, id: "1" });
});
