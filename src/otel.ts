import { OrbitConfig, TraceEvent } from "./types.js";

function toNanoTime(ts: string): string {
  const ms = Date.parse(ts);
  return String(ms * 1_000_000);
}

const pendingByEndpoint = new Map<string, TraceEvent[]>();
const flushTimers = new Map<string, NodeJS.Timeout>();

function scheduleFlush(config: OrbitConfig): void {
  const endpoint = config.otel.endpoint;
  if (!endpoint || flushTimers.has(endpoint)) return;
  const timer = setTimeout(() => {
    flushTimers.delete(endpoint);
    void flushNow(config, endpoint);
  }, config.performance.traceFlushIntervalMs);
  timer.unref?.();
  flushTimers.set(endpoint, timer);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function calculateBackoffMs(attempt: number): number {
  const base = 100 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 50);
  return base + jitter;
}

async function flushNow(config: OrbitConfig, endpoint: string): Promise<void> {
  const events = pendingByEndpoint.get(endpoint) ?? [];
  if (events.length === 0) return;
  pendingByEndpoint.set(endpoint, []);
  const spans = events.map((event) => ({
    traceId: (event.run_id.replace(/-/g, "").padEnd(32, "0")).slice(0, 32),
    spanId: (event.span_id.replace(/-/g, "").padEnd(16, "0")).slice(0, 16),
    name: event.event,
    kind: 1,
    startTimeUnixNano: toNanoTime(event.ts),
    endTimeUnixNano: toNanoTime(event.ts),
    attributes: [
      { key: "orbit.run_id", value: { stringValue: event.run_id } },
      { key: "orbit.actor", value: { stringValue: event.actor } },
      ...(event.svc ? [{ key: "orbit.service", value: { stringValue: event.svc } }] : []),
      ...(event.method ? [{ key: "orbit.method", value: { stringValue: event.method } }] : []),
      ...(event.retry !== undefined ? [{ key: "orbit.retry", value: { intValue: event.retry } }] : []),
      ...(event.error_code ? [{ key: "orbit.error_code", value: { stringValue: event.error_code } }] : [])
    ]
  }));
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: config.otel.serviceName } }] },
        scopeSpans: [{ scope: { name: "orbit" }, spans }]
      }
    ]
  };
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) return;
      if (!isRetryableStatus(response.status)) return;
    } catch {
      // network failure; retry with backoff
    }
    if (attempt < maxAttempts - 1) {
      await sleep(calculateBackoffMs(attempt));
    }
  }

  // Preserve recent unsent trace events so transient OTLP outages don't silently drop data.
  const queue = pendingByEndpoint.get(endpoint) ?? [];
  const merged = [...events, ...queue];
  pendingByEndpoint.set(endpoint, merged.slice(-config.performance.traceBufferMaxEvents));
  scheduleFlush(config);
}

export async function exportTraceEvent(config: OrbitConfig, event: TraceEvent): Promise<void> {
  const endpoint = config.otel.endpoint;
  if (!endpoint) return;
  const queue = pendingByEndpoint.get(endpoint) ?? [];
  queue.push(event);
  pendingByEndpoint.set(endpoint, queue);
  if (queue.length >= 64) {
    await flushNow(config, endpoint);
    return;
  }
  scheduleFlush(config);
}
