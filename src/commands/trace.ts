import { Logger } from "../logger.js";
import { readTraceTimeline } from "../trace.js";
import { OrbitConfig } from "../types.js";

function fmtLatency(ms?: number): string {
  return ms === undefined ? "-" : `${ms}ms`;
}

export function cmdTrace(config: OrbitConfig, _logger: Logger, opts: { runId: string }): void {
  const events = readTraceTimeline(config, opts.runId);
  if (events.length === 0) {
    process.stdout.write(`No trace events found for run ${opts.runId}\n`);
    return;
  }
  for (const e of events) {
    const line = [
      e.ts,
      e.actor,
      e.event,
      e.svc ? `${e.svc}.${e.method ?? ""}` : "-",
      `latency=${fmtLatency(e.latency_ms)}`,
      e.retry !== undefined ? `retry=${e.retry}` : "",
      e.error_code ? `error=${e.error_code}` : "",
      e.detail ? `detail=${e.detail}` : ""
    ]
      .filter(Boolean)
      .join(" | ");
    process.stdout.write(`${line}\n`);
  }
}

