import { Logger } from "../logger.js";
import { closeBus, connectBus, decodeJson } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { defaultDurableStreamName } from "../jetstream_durable.js";
import { DlqFilter, extractDlqMeta, matchesDlqFilter, parseOptionalIsoTs } from "../dlq.js";

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

export async function cmdDlqPurge(
  config: OrbitConfig,
  _logger: Logger,
  opts: {
    dlqTopic: string;
    streamName?: string;
    limit?: number;
    dryRun?: boolean;
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
    process.stdout.write(`${JSON.stringify({ ok: true, stream: streamName, scanned: 0, matched: 0, purged: 0, dry_run: Boolean(opts.dryRun) }, null, 2)}\n`);
    return;
  }

  const firstSeq = Number(info?.state?.first_seq ?? 0);
  const lastSeq = Number(info?.state?.last_seq ?? 0);
  let scanned = 0;
  let matched = 0;
  let purged = 0;

  for (let seq = firstSeq; seq <= lastSeq; seq += 1) {
    if (limit > 0 && purged >= limit) break;
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
    if (opts.dryRun) continue;
    try {
      await jsm.streams.deleteMessage(streamName, seq);
      purged += 1;
    } catch {
      // best effort purge
    }
  }

  await closeBus(config.natsUrl);
  process.stdout.write(`${JSON.stringify({ ok: true, stream: streamName, scanned, matched, purged, dry_run: Boolean(opts.dryRun) }, null, 2)}\n`);
}
