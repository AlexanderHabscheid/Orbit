import process from "node:process";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export class Logger {
  constructor(private readonly level: keyof typeof LEVELS) {}

  private emit(level: keyof typeof LEVELS, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const row = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(ctx ?? {})
    };
    process.stderr.write(`${JSON.stringify(row)}\n`);
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("debug", msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("info", msg, ctx);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("warn", msg, ctx);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit("error", msg, ctx);
  }
}

