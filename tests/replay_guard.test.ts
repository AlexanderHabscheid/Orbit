import test from "node:test";
import assert from "node:assert/strict";
import { checkAndRememberNonce } from "../src/federation/replay_guard.js";

test("checkAndRememberNonce rejects replay within ttl", () => {
  const now = Date.now();
  assert.equal(checkAndRememberNonce("n1", 60, now), true);
  assert.equal(checkAndRememberNonce("n1", 60, now + 1), false);
  assert.equal(checkAndRememberNonce("n1", 60, now + 61_000), true);
});
