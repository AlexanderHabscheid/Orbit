import { NatsConnection } from "nats";
import { OrbitConfig } from "../types.js";
import { randomId } from "../util.js";
import { encodeJson, publishSubject } from "../nats.js";
import { prefixedSubject } from "../subjects.js";
import { adjustDomainReputation } from "./store.js";

export async function fileAbuseReport(
  config: OrbitConfig,
  nc: NatsConnection,
  payload: {
    reporter: string;
    subject: string;
    reason: string;
    evidence?: Record<string, unknown>;
    severity?: "low" | "medium" | "high" | "critical";
  }
): Promise<unknown> {
  const id = randomId();
  const createdAt = new Date().toISOString();
  const severity = payload.severity ?? "medium";
  const report = {
    id,
    created_at: createdAt,
    reporter: payload.reporter,
    subject: payload.subject,
    reason: payload.reason,
    severity,
    evidence: payload.evidence ?? {}
  };

  const domainAt = payload.subject.lastIndexOf("@");
  if (domainAt > 0 && domainAt < payload.subject.length - 1) {
    const domain = payload.subject.slice(domainAt + 1).toLowerCase();
    const penalty = severity === "critical" ? -25 : severity === "high" ? -15 : severity === "low" ? -5 : -10;
    adjustDomainReputation(config, domain, penalty);
  }

  const subject = prefixedSubject(config, "federation", "abuse", "reports");
  await publishSubject(nc, subject, encodeJson(report), {
    durable: true,
    dedupeKey: id,
    timeoutMs: config.runtime.publishDurableTimeoutMs
  });
  await nc.flush();
  return { ok: true, id, subject };
}
