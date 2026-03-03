import test from "node:test";
import assert from "node:assert/strict";
import { EchoCore } from "../src/echo/bus.js";

test("EchoCore isolates channels", () => {
  const bus = new EchoCore({ channelSlots: 8, slotBytes: 1024 });
  const seenA: string[] = [];
  const seenB: string[] = [];

  const stopA = bus.subscribe("a", (msg) => seenA.push(Buffer.from(msg.payload).toString("utf-8")));
  const stopB = bus.subscribe("b", (msg) => seenB.push(Buffer.from(msg.payload).toString("utf-8")));

  bus.publish("a", Buffer.from("one"));
  bus.publish("b", Buffer.from("two"));
  bus.publish("a", Buffer.from("three"));

  stopA();
  stopB();

  assert.deepEqual(seenA, ["one", "three"]);
  assert.deepEqual(seenB, ["two"]);
});

test("EchoCore drop_newest applies backpressure", () => {
  const bus = new EchoCore({ channelSlots: 2, slotBytes: 1024, backpressure: "drop_newest" });

  const r1 = bus.publish("load", Buffer.from("1"));
  const r2 = bus.publish("load", Buffer.from("2"));
  const r3 = bus.publish("load", Buffer.from("3"));

  assert.equal(r1.accepted, true);
  assert.equal(r2.accepted, true);
  assert.equal(r3.accepted, false);

  const stats = bus.stats("load")[0];
  assert.equal(stats.published, 3);
  assert.equal(stats.dropped, 1);
  assert.equal(stats.ringSize, 2);
});
