import fs from "node:fs";
import { createEnvelope } from "../envelope.js";
import { closeBus, connectBus, encodeJson, osPut, publishSubject } from "../nats.js";
import { appendTraceEvent } from "../trace.js";
import { Logger } from "../logger.js";
import { OrbitConfig } from "../types.js";
import { randomId } from "../util.js";
import { canUseAgent, requestAgent } from "../agent_ipc.js";

export async function cmdPublish(
  config: OrbitConfig,
  _logger: Logger,
  opts: { topic: string; body: unknown; runId?: string; packFile?: string; durable?: boolean; dedupeKey?: string }
): Promise<void> {
  if (canUseAgent(config)) {
    try {
      const payload = await requestAgent(
        config,
        "publish",
        {
          topic: opts.topic,
          body: opts.body,
          runId: opts.runId,
          packFile: opts.packFile,
          durable: opts.durable,
          dedupeKey: opts.dedupeKey
        },
        config.requestTimeoutMs
      );
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    } catch {
      // fall through to direct publish path
    }
  }
  const runId = opts.runId ?? randomId();
  const nc = await connectBus(config.natsUrl);
  const dataPackRef = opts.packFile
    ? {
        bucket: config.objectStoreBucket,
        key: `${runId}/pub/${Date.now()}-${randomId()}.bin`,
        bytes: fs.statSync(opts.packFile).size
      }
    : undefined;
  if (opts.packFile && dataPackRef) {
    await osPut(nc, dataPackRef.bucket, dataPackRef.key, fs.readFileSync(opts.packFile), {
      description: `orbit event data pack for ${opts.topic}`
    });
  }
  const env = createEnvelope({
    kind: "event",
    runId,
    payload: opts.body,
    dataPack: dataPackRef,
    provenance: { publisher: "orbit-cli", topic: opts.topic },
    a2a: opts.dedupeKey ? { dedupe_key: opts.dedupeKey } : undefined
  });
  const durable = typeof opts.durable === "boolean" ? opts.durable : config.runtime.publishDurableEnabled;
  await publishSubject(nc, opts.topic, encodeJson(env), {
    durable,
    dedupeKey: opts.dedupeKey ?? env.a2a?.dedupe_key,
    timeoutMs: config.runtime.publishDurableTimeoutMs
  });
  appendTraceEvent(config, {
    span_id: env.id,
    run_id: runId,
    ts: new Date().toISOString(),
    actor: "cli",
    event: "publish",
    detail: opts.topic
  });
  await nc.flush();
  await closeBus(config.natsUrl);
  process.stdout.write(`${JSON.stringify({ ok: true, topic: opts.topic, run_id: runId, durable }, null, 2)}\n`);
}
