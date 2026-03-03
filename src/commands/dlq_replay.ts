import { Logger } from "../logger.js";
import { closeBus, connectBus, decodeJson, encodeJson, publishSubject } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { defaultDurableStreamName } from "../jetstream_durable.js";
import { DlqFilter, extractDlqMeta, matchesDlqFilter, parseOptionalIsoTs } from "../dlq.js";
import { randomId } from "../util.js";

function asStoredMessage(raw: any): { seq: number; subject: string; time?: string; data: Uint8Array } | null {
  const msg = raw?.message ?? raw;
  if (!msg) return null;
  const seq = typeof msg.seq === "number" ? msg.seq : undefined;
  const subject = typeof msg.subject === "string" ? msg.subject : undefined;
  const data = msg.data as Uint8Array | undefined;
  if (seq === undefined || !subject || !data) return null;
  return {
    seq,
    subject,
    time: typeof msg.time === "string" ? msg.time : undefined,
    data
  };
}

export function replayBytesFromDlqPayload(input: unknown, fallback: Uint8Array): Uint8Array {
  if (!input || typeof input !== "object") return fallback;
  const raw = input as Record<string, unknown>;
  const original = raw.original as Record<string, unknown> | undefined;
  if (original && typeof original.base64 === "string") {
    return Buffer.from(original.base64, "base64");
  }
  if (typeof raw.raw_base64 === "string") {
    return Buffer.from(raw.raw_base64, "base64");
  }
  if ("payload" in raw) {
    return encodeJson(raw.payload);
  }
  return fallback;
}

export async function cmdDlqReplay(
  config: OrbitConfig,
  _logger: Logger,
  opts: {
    dlqTopic: string;
    targetTopic: string;
    limit?: number;
    streamName?: string;
    durablePublish?: boolean;
    purgeReplayed?: boolean;
    fromTs?: string;
    toTs?: string;
    errorCode?: string;
    sourceConsumer?: string;
  }
): Promise<void> {
  const nc = await connectBus(config.natsUrl);
  const jsm: any = await nc.jetstreamManager();
  const streamName = opts.streamName ?? defaultDurableStreamName(opts.dlqTopic);
  const limit = Math.max(0, opts.limit ?? 0);
  const durablePublish = opts.durablePublish ?? true;
  const filter: DlqFilter = {
    fromTsMs: parseOptionalIsoTs(opts.fromTs, "--from-ts"),
    toTsMs: parseOptionalIsoTs(opts.toTs, "--to-ts"),
    errorCode: opts.errorCode,
    sourceConsumer: opts.sourceConsumer
  };

  let info: any;
  try {
    info = await jsm.streams.info(streamName);
  } catch {
    await closeBus(config.natsUrl);
    process.stdout.write(`${JSON.stringify({ ok: true, replayed: 0, scanned: 0, matched: 0, stream: streamName }, null, 2)}\n`);
    return;
  }

  const firstSeq = Number(info?.state?.first_seq ?? 0);
  const lastSeq = Number(info?.state?.last_seq ?? 0);
  let scanned = 0;
  let matched = 0;
  let replayed = 0;
  let failed = 0;
  let purged = 0;

  for (let seq = firstSeq; seq <= lastSeq; seq += 1) {
    if (limit > 0 && replayed >= limit) break;
    let storedRaw: any;
    try {
      storedRaw = await jsm.streams.getMessage(streamName, { seq });
    } catch {
      continue;
    }
    const stored = asStoredMessage(storedRaw);
    if (!stored) continue;
    if (stored.subject !== opts.dlqTopic) continue;
    scanned += 1;

    let decoded: unknown = null;
    try {
      decoded = decodeJson(stored.data);
    } catch {
      decoded = null;
    }
    const meta = extractDlqMeta(decoded, stored.time);
    if (!matchesDlqFilter(meta, filter)) continue;
    matched += 1;

    try {
      const payloadBytes = replayBytesFromDlqPayload(decoded, stored.data);
      await publishSubject(nc, opts.targetTopic, payloadBytes, {
        durable: durablePublish,
        dedupeKey: `replay-${opts.targetTopic}-${seq}-${Date.now()}-${randomId()}`,
        timeoutMs: config.runtime.publishDurableTimeoutMs
      });
      replayed += 1;
      if (opts.purgeReplayed) {
        try {
          await jsm.streams.deleteMessage(streamName, seq);
          purged += 1;
        } catch {
          // best effort purge
        }
      }
    } catch (err) {
      failed += 1;
      process.stderr.write(`dlq replay failed (seq=${seq}): ${(err as Error).message}\n`);
    }
  }

  await closeBus(config.natsUrl);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        replayed,
        failed,
        purged,
        scanned,
        matched,
        dlq_topic: opts.dlqTopic,
        target_topic: opts.targetTopic,
        stream: streamName
      },
      null,
      2
    )}\n`
  );
}
