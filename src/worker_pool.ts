import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { OrbitError } from "./errors.js";
import { randomId } from "./util.js";

interface WorkerResponse {
  id: string;
  ok?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string } | string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface WorkerExecutionOptions {
  poolSize: number;
  maxPendingPerWorker: number;
}

class PersistentWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: readline.Interface | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly stderrTail: string[] = [];
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly command: string,
    private readonly args: string[]
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;

    const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    this.clearIdleTimer();
    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on("line", (line) => {
      if (!line.trim()) return;
      let parsed: WorkerResponse;
      try {
        parsed = JSON.parse(line) as WorkerResponse;
      } catch {
        return;
      }
      if (!parsed.id) return;
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      this.pending.delete(parsed.id);
      clearTimeout(pending.timer);
      if (parsed.ok === false) {
        const msg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? "worker returned error";
        pending.reject(
          new OrbitError(typeof parsed.error === "string" ? "WORKER_ERROR" : (parsed.error?.code ?? "WORKER_ERROR"), msg)
        );
        return;
      }
      pending.resolve(parsed.result);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      this.stderrTail.push(text);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });

    child.on("exit", () => {
      this.child = null;
      this.lines?.close();
      this.lines = null;
      this.clearIdleTimer();
      const err = new OrbitError("WORKER_EXITED", `worker exited unexpectedly: ${this.command}`, {
        command: this.command,
        args: this.args,
        stderr: this.stderrTail.join("\n")
      });
      for (const [id, pending] of this.pending.entries()) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(err);
      }
    });

    child.on("error", (err) => {
      const wrapped = new OrbitError("WORKER_SPAWN_ERROR", "failed to spawn persistent worker", {
        command: this.command,
        args: this.args,
        err
      });
      for (const [id, pending] of this.pending.entries()) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(wrapped);
      }
    });
    return child;
  }

  async request(payload: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.ensureStarted();
    const requestId = randomId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.scheduleIdleShutdown();
        reject(new OrbitError("WORKER_TIMEOUT", `worker request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });

      const row = JSON.stringify({ id: requestId, payload });
      child.stdin.write(`${row}\n`, "utf-8", (err) => {
        if (!err) return;
        this.pending.delete(requestId);
        clearTimeout(timer);
        this.scheduleIdleShutdown();
        reject(new OrbitError("WORKER_WRITE_ERROR", "failed to write request to worker stdin", { err }));
      });
    });
  }

  onSettledRequest(): void {
    if (this.pending.size > 0) return;
    this.scheduleIdleShutdown();
  }

  private scheduleIdleShutdown(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.pending.size > 0) return;
      if (!this.child || this.child.killed) return;
      this.child.kill("SIGTERM");
    }, 1000);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

interface WorkerGroup {
  workers: PersistentWorker[];
  maxPendingPerWorker: number;
}

export class WorkerPool {
  private readonly groups = new Map<string, WorkerGroup>();

  async execute(
    command: string,
    args: string[],
    payload: unknown,
    timeoutMs: number,
    options: WorkerExecutionOptions
  ): Promise<unknown> {
    const key = JSON.stringify({ command, args });
    let group = this.groups.get(key);
    if (!group) {
      group = {
        workers: Array.from({ length: options.poolSize }, () => new PersistentWorker(command, args)),
        maxPendingPerWorker: options.maxPendingPerWorker
      };
      this.groups.set(key, group);
    }

    const sorted = [...group.workers].sort((a, b) => a.pendingCount - b.pendingCount);
    const selected = sorted.find((w) => w.pendingCount < group.maxPendingPerWorker);
    if (!selected) {
      throw new OrbitError("WORKER_OVERLOADED", "all workers at max pending capacity", {
        command,
        args,
        pool_size: group.workers.length,
        max_pending_per_worker: group.maxPendingPerWorker
      });
    }

    try {
      return await selected.request(payload, timeoutMs);
    } finally {
      selected.onSettledRequest();
    }
  }
}
