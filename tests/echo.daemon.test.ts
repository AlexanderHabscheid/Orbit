import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { startEchoDaemon } from "../src/echo/daemon.js";
import { connectEchoClient } from "../src/echo/client.js";

test("daemon publish/subscribe roundtrip", async (t) => {
  const socketPath = path.join(os.tmpdir(), `echocore-test-${Date.now()}.sock`);
  let daemon: Awaited<ReturnType<typeof startEchoDaemon>> | undefined;
  try {
    daemon = await startEchoDaemon({ socketPath, channelSlots: 16, slotBytes: 2048 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("sandbox does not allow unix domain socket listeners");
      return;
    }
    throw err;
  }

  try {
    const sub = await connectEchoClient({ socketPath });
    const pub = await connectEchoClient({ socketPath });

    const event = await new Promise<{ seq: number; payloadBase64: string }>((resolve) => {
      sub.onLine((line) => {
        const msg = JSON.parse(line) as { type: string; seq?: number; payloadBase64?: string };
        if (msg.type !== "event" || msg.seq === undefined || !msg.payloadBase64) return;
        resolve({ seq: msg.seq, payloadBase64: msg.payloadBase64 });
      });
      sub.send({ type: "subscribe", channel: "agent.loop" });
      pub.send({ type: "publish", channel: "agent.loop", payloadBase64: Buffer.from('{"ok":true}').toString("base64") });
    });

    assert.equal(event.seq, 1);
    assert.deepEqual(JSON.parse(Buffer.from(event.payloadBase64, "base64").toString("utf-8")), { ok: true });
    sub.close();
    pub.close();
  } finally {
    if (daemon) await daemon.close();
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  }
});
