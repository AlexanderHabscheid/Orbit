import test from "node:test";
import assert from "node:assert/strict";
import { buildCellRoutesTemplate } from "../src/cell/template.js";

test("buildCellRoutesTemplate production profile", () => {
  const template = buildCellRoutesTemplate("production", "orbit");
  assert.equal(template["agent.loop"].mode, "replicate");
  assert.equal(template["agent.audit"].mode, "global_only");
  assert.equal(template["agent.debug"].mode, "local_only");
  assert.equal(template["agent.loop"].subject, "orbit.cell.channels.agent.loop");
});

test("buildCellRoutesTemplate high_throughput adds trace channel", () => {
  const template = buildCellRoutesTemplate("high_throughput", "acme");
  assert.equal(template["agent.trace"].mode, "global_only");
  assert.equal(template["agent.trace"].subject, "acme.cell.trace.events");
});
