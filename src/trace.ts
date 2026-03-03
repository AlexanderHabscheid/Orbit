import fs from "node:fs";
import path from "node:path";
import { OrbitConfig, TraceEvent } from "./types.js";
import { ensureDir } from "./util.js";
import { exportTraceEvent } from "./otel.js";

const pendingWrites = new Map<string, string[]>();
let flushScheduled = false;
let exitHooksInstalled = false;
let traceDirEnsured = false;
let pendingEventCount = 0;

function flushPendingAsync(): void {
  flushScheduled = false;
  for (const [filePath, lines] of pendingWrites.entries()) {
    if (lines.length === 0) continue;
    pendingEventCount -= lines.length;
    if (pendingEventCount < 0) pendingEventCount = 0;
    pendingWrites.set(filePath, []);
    const chunk = lines.join("");
    fs.promises.appendFile(filePath, chunk, "utf-8").catch(() => {
      // best effort trace write; tracing should never break request flow
    });
  }
}

export function flushTraceWritesSync(): void {
  flushScheduled = false;
  for (const [filePath, lines] of pendingWrites.entries()) {
    if (lines.length === 0) continue;
    pendingEventCount -= lines.length;
    if (pendingEventCount < 0) pendingEventCount = 0;
    pendingWrites.set(filePath, []);
    fs.appendFileSync(filePath, lines.join(""), "utf-8");
  }
}

function scheduleFlush(delayMs: number): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const timer = setTimeout(flushPendingAsync, delayMs);
  timer.unref?.();
}

function installExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.once("beforeExit", flushTraceWritesSync);
  process.once("exit", flushTraceWritesSync);
}

export function appendTraceEvent(config: OrbitConfig, event: TraceEvent): void {
  if (config.performance.traceSampleRate <= 0) return;
  if (config.performance.traceSampleRate < 1 && Math.random() > config.performance.traceSampleRate) return;
  installExitHooks();
  if (!traceDirEnsured) {
    ensureDir(config.traceDir);
    traceDirEnsured = true;
  }
  if (pendingEventCount >= config.performance.traceBufferMaxEvents) {
    return;
  }
  const filePath = path.join(config.traceDir, `${event.run_id}.jsonl`);
  const existing = pendingWrites.get(filePath) ?? [];
  existing.push(`${JSON.stringify(event)}\n`);
  pendingEventCount += 1;
  pendingWrites.set(filePath, existing);
  if (existing.length >= 32) {
    flushPendingAsync();
  } else {
    scheduleFlush(config.performance.traceFlushIntervalMs);
  }
  void exportTraceEvent(config, event);
}

export function readTraceTimeline(config: OrbitConfig, runId: string): TraceEvent[] {
  flushTraceWritesSync();
  const filePath = path.join(config.traceDir, `${runId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  return lines
    .map((line) => JSON.parse(line) as TraceEvent)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}
