import { Logger } from "../logger.js";
import { connectBus, decodeJson, encodeJson, publishSubject } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { defaultDurableConsumerName, defaultDurableStreamName, ensureDurableConsumer, ensureStreamSubjects } from "../jetstream_durable.js";
import { randomId } from "../util.js";

export async function cmdSubscribe(
  config: OrbitConfig,
  _logger: Logger,
  opts: {
    topic: string;
    durableName?: string;
    streamName?: string;
    dlqTopic?: string;
    ackWaitMs?: number;
    maxDeliver?: number;
    requireJson?: boolean;
  }
): Promise<void> {
  const nc = await connectBus(config.natsUrl);
  if (!opts.durableName) {
    const sub = nc.subscribe(opts.topic);
    process.stderr.write(`subscribed to ${opts.topic}\n`);
    for await (const msg of sub) {
      let data: unknown;
      try {
        data = decodeJson(msg.data);
      } catch {
        data = { raw: Buffer.from(msg.data).toString("utf-8") };
      }
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    }
    return;
  }

  const js: any = nc.jetstream();
  const jsm: any = await nc.jetstreamManager();
  const streamName = opts.streamName ?? defaultDurableStreamName(opts.topic);
  const durableName = opts.durableName || defaultDurableConsumerName(opts.topic);
  const ackWaitMs = opts.ackWaitMs ?? 30_000;
  const maxDeliver = opts.maxDeliver ?? 5;
  await ensureStreamSubjects(jsm, streamName, [opts.topic, opts.dlqTopic ?? ""]);
  await ensureDurableConsumer(jsm, streamName, durableName, opts.topic, ackWaitMs, maxDeliver);

  const consumer = await js.consumers.get(streamName, durableName);
  const messages = await consumer.consume();
  process.stderr.write(`durable subscribed to ${opts.topic} (stream=${streamName} consumer=${durableName})\n`);
  for await (const msg of messages as AsyncIterable<any>) {
    try {
      let data: unknown;
      try {
        data = decodeJson(msg.data);
      } catch (err) {
        if (opts.requireJson) throw err;
        data = { raw: Buffer.from(msg.data).toString("utf-8") };
      }
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      msg.ack?.();
    } catch (err) {
      const deliveryCount = Number(msg?.info?.deliveryCount ?? msg?.info?.delivered ?? 1);
      if (opts.dlqTopic && deliveryCount >= maxDeliver) {
        const dlqPayload = {
          version: "1",
          failed_at: new Date().toISOString(),
          source: {
            topic: opts.topic,
            stream: streamName,
            consumer: durableName,
            delivery_count: deliveryCount,
            error: (err as Error).message,
            error_code: (err as { code?: string }).code
          },
          original: {
            base64: Buffer.from(msg.data).toString("base64")
          }
        };
        await publishSubject(nc, opts.dlqTopic, encodeJson(dlqPayload), {
          durable: true,
          dedupeKey: `dlq-${streamName}-${durableName}-${Date.now()}-${randomId()}`,
          timeoutMs: config.runtime.publishDurableTimeoutMs
        });
        msg.term?.();
        if (!msg.term) msg.ack?.();
      } else {
        msg.nak?.();
      }
    }
  }
}
