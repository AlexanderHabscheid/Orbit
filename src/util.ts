import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { OrbitError } from "./errors.js";

export function randomId(): string {
  return crypto.randomUUID();
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function readJsonFile<T>(filePath: string): T {
  const text = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new OrbitError("BAD_JSON", `Invalid JSON in ${filePath}`, { err });
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function parseJsonInput(arg: string): unknown {
  try {
    if (arg.startsWith("@")) {
      return readJsonFile(arg.slice(1));
    }
    return JSON.parse(arg);
  } catch (err) {
    throw new OrbitError("BAD_JSON_INPUT", `Failed to parse JSON from ${arg}`, { err });
  }
}

export function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return undefined;
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
