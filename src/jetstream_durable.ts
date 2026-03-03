import { AckPolicy, DeliverPolicy } from "nats";

function sanitizeToken(input: string): string {
  return input.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "subject";
}

export function defaultDurableStreamName(subject: string): string {
  return `orbit_${sanitizeToken(subject)}_stream`;
}

export function defaultDurableConsumerName(subject: string): string {
  return `orbit_${sanitizeToken(subject)}_consumer`;
}

export async function ensureStreamSubjects(jsm: any, streamName: string, subjects: string[]): Promise<void> {
  const unique = Array.from(new Set(subjects.filter(Boolean)));
  if (unique.length === 0) return;
  try {
    const info = await jsm.streams.info(streamName);
    const existing = Array.isArray(info?.config?.subjects) ? info.config.subjects : [];
    const merged = Array.from(new Set([...existing, ...unique]));
    if (merged.length !== existing.length) {
      await jsm.streams.update(streamName, {
        ...info.config,
        subjects: merged
      });
    }
    return;
  } catch {
    // stream missing; create
  }
  await jsm.streams.add({
    name: streamName,
    subjects: unique
  });
}

export async function ensureDurableConsumer(
  jsm: any,
  streamName: string,
  durableName: string,
  filterSubject: string,
  ackWaitMs: number,
  maxDeliver: number
): Promise<void> {
  try {
    await jsm.consumers.info(streamName, durableName);
    return;
  } catch {
    // consumer missing; create
  }
  await jsm.consumers.add(streamName, {
    durable_name: durableName,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    filter_subject: filterSubject,
    ack_wait: Math.max(1, Math.floor(ackWaitMs)) * 1_000_000,
    max_deliver: Math.max(1, Math.floor(maxDeliver))
  });
}
