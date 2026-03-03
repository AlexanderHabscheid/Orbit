import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts } from "../src/commands/monitor.js";

function newState() {
  return {
    active: new Set<string>(),
    streaks: new Map<string, number>(),
    lastEventMs: new Map<string, number>()
  };
}

test("evaluateAlerts enforces consecutive threshold", () => {
  const state = newState();
  const first = evaluateAlerts(state, ["HIGH_LATENCY"], 1000, { consecutive: 2, cooldownMs: 0 });
  assert.deepEqual(first.active, []);
  assert.deepEqual(first.emit, []);

  const second = evaluateAlerts(state, ["HIGH_LATENCY"], 2000, { consecutive: 2, cooldownMs: 0 });
  assert.deepEqual(second.active, ["HIGH_LATENCY"]);
  assert.deepEqual(second.emit, [{ event: "alert", code: "HIGH_LATENCY" }]);
});

test("evaluateAlerts emits resolved after condition clears", () => {
  const state = newState();
  evaluateAlerts(state, ["SERVICE_DOWN"], 1000, { consecutive: 1, cooldownMs: 0 });
  const cleared = evaluateAlerts(state, [], 2000, { consecutive: 1, cooldownMs: 0 });
  assert.deepEqual(cleared.active, []);
  assert.deepEqual(cleared.emit, [{ event: "alert_resolved", code: "SERVICE_DOWN" }]);
});

test("evaluateAlerts applies cooldown per event+code", () => {
  const state = newState();
  const a1 = evaluateAlerts(state, ["SERVICE_DOWN"], 1000, { consecutive: 1, cooldownMs: 5000 });
  assert.equal(a1.emit.length, 1);

  const r1 = evaluateAlerts(state, [], 1100, { consecutive: 1, cooldownMs: 5000 });
  assert.equal(r1.emit.length, 1);

  const a2 = evaluateAlerts(state, ["SERVICE_DOWN"], 1200, { consecutive: 1, cooldownMs: 5000 });
  assert.equal(a2.emit.length, 0);

  const r2 = evaluateAlerts(state, [], 7200, { consecutive: 1, cooldownMs: 5000 });
  assert.equal(r2.emit.length, 1);

  const a3 = evaluateAlerts(state, ["SERVICE_DOWN"], 7300, { consecutive: 1, cooldownMs: 5000 });
  assert.equal(a3.emit.length, 1);
});
