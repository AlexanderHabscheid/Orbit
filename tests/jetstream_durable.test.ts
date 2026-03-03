import test from "node:test";
import assert from "node:assert/strict";
import { defaultDurableConsumerName, defaultDurableStreamName } from "../src/jetstream_durable.js";

test("default durable names are deterministic and sanitized", () => {
  const subject = "orbit.cell.channels.agent.loop";
  assert.equal(defaultDurableStreamName(subject), "orbit_orbit_cell_channels_agent_loop_stream");
  assert.equal(defaultDurableConsumerName(subject), "orbit_orbit_cell_channels_agent_loop_consumer");
});

test("default durable names remove unsafe characters", () => {
  const subject = "a2a/events.tenant-1@prod";
  assert.equal(defaultDurableStreamName(subject), "orbit_a2a_events_tenant_1_prod_stream");
});
