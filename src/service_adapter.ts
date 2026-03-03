import { spawn } from "node:child_process";
import { OrbitError } from "./errors.js";
import { assertJsonSchema } from "./json_schema.js";
import { ServiceMethodSpec } from "./types.js";
import { WorkerPool } from "./worker_pool.js";

function readPath(obj: unknown, segments: string[]): unknown {
  if (segments.length === 0) return undefined;
  let curr: unknown = obj;
  for (const key of segments) {
    if (!curr || typeof curr !== "object" || !(key in (curr as Record<string, unknown>))) return undefined;
    curr = (curr as Record<string, unknown>)[key];
  }
  return curr;
}

interface CompiledPart {
  literal?: string;
  path?: string[];
}

const templateCache = new Map<string, CompiledPart[]>();

function compileTemplate(input: string): CompiledPart[] {
  const cached = templateCache.get(input);
  if (cached) return cached;
  const parts: CompiledPart[] = [];
  const regex = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input))) {
    if (match.index > lastIndex) parts.push({ literal: input.slice(lastIndex, match.index) });
    parts.push({ path: match[1].split(".") });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < input.length) parts.push({ literal: input.slice(lastIndex) });
  templateCache.set(input, parts);
  return parts;
}

function template(input: string, ctx: unknown): string {
  const parts = compileTemplate(input);
  let out = "";
  for (const part of parts) {
    if (part.literal !== undefined) {
      out += part.literal;
      continue;
    }
    const val = readPath(ctx, part.path ?? []);
    if (val === undefined || val === null) continue;
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      out += String(val);
      continue;
    }
    out += JSON.stringify(val);
  }
  return out;
}

const workerPool = new WorkerPool();

interface WorkerExecutionPolicy {
  poolSize: number;
  maxPendingPerWorker: number;
}

async function executeHttpMethod(
  methodSpec: ServiceMethodSpec,
  requestPayload: unknown,
  timeoutMs: number
): Promise<unknown> {
  const endpoint = methodSpec.http_endpoint ? template(methodSpec.http_endpoint, requestPayload) : "";
  if (!endpoint) throw new OrbitError("METHOD_BAD_HTTP_SPEC", "http transport requires http_endpoint");
  const method = methodSpec.http_method ?? "POST";
  const templatedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(methodSpec.headers ?? {})) {
    templatedHeaders[k] = template(v, requestPayload);
  }
  const headers = {
    "content-type": "application/json",
    ...templatedHeaders
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(endpoint, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(requestPayload ?? {}),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) {
      throw new OrbitError("METHOD_HTTP_ERROR", `http method failed with status ${res.status}`, {
        status: res.status,
        body: text
      });
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { body: text };
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new OrbitError("METHOD_TIMEOUT", `http method timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeMethod(
  methodSpec: ServiceMethodSpec,
  requestPayload: unknown,
  defaultTimeoutMs: number,
  workerPolicy?: WorkerExecutionPolicy
): Promise<unknown> {
  const timeoutMs = methodSpec.timeout_ms ?? defaultTimeoutMs;
  const transport = methodSpec.transport ?? "worker";
  assertJsonSchema(requestPayload, methodSpec.request_schema, "method request");
  let result: unknown;

  if (transport === "http") {
    result = await executeHttpMethod(methodSpec, requestPayload, timeoutMs);
    assertJsonSchema(result, methodSpec.response_schema, "method response");
    return result;
  }
  if (!methodSpec.command) {
    throw new OrbitError("METHOD_BAD_SPEC", `transport ${transport} requires command`);
  }
  const cmd = template(methodSpec.command, requestPayload);
  const args = (methodSpec.args ?? []).map((v) => template(v, requestPayload));
  if (transport === "worker") {
    result = await workerPool.execute(cmd, args, requestPayload, timeoutMs, {
      poolSize: Math.max(1, workerPolicy?.poolSize ?? 1),
      maxPendingPerWorker: Math.max(1, workerPolicy?.maxPendingPerWorker ?? 64)
    });
    assertJsonSchema(result, methodSpec.response_schema, "method response");
    return result;
  }

  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new OrbitError("METHOD_TIMEOUT", `method command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.on("error", (err) => reject(new OrbitError("METHOD_SPAWN_ERROR", "failed to spawn method command", { err })));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });

  if (exitCode !== 0) {
    throw new OrbitError("METHOD_EXIT_NONZERO", `method exited with code ${exitCode}`, { stderr, stdout, exitCode });
  }
  const text = stdout.trim();
  if (!text) return {};
  try {
    result = JSON.parse(text);
  } catch {
    result = { stdout: text, stderr: stderr.trim(), exit_code: exitCode };
  }
  assertJsonSchema(result, methodSpec.response_schema, "method response");
  return result;
}
