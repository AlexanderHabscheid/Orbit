import { randomUUID } from "node:crypto";
import {
  OrbitApiAction,
  OrbitApiResponseEnvelope,
  OrbitCallParams,
  OrbitClientOptions,
  OrbitInspectParams,
  OrbitPublishParams
} from "./types.js";

export class OrbitApiError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class OrbitClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(options: OrbitClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.headers = { ...(options.headers ?? {}) };
  }

  async ping(): Promise<unknown> {
    return this.request("ping", {});
  }

  async call(params: OrbitCallParams): Promise<unknown> {
    return this.request("call", params, params.timeoutMs);
  }

  async publish(params: OrbitPublishParams): Promise<unknown> {
    return this.request("publish", params);
  }

  async inspect(params: OrbitInspectParams): Promise<unknown> {
    return this.request("inspect", params, params.timeoutMs);
  }

  private async request(
    action: OrbitApiAction,
    payload: object,
    timeoutOverrideMs?: number
  ): Promise<unknown> {
    const timeoutMs = timeoutOverrideMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const res = await fetch(`${this.baseUrl}/v1/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": randomUUID(),
          ...this.headers
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = (await res.json()) as OrbitApiResponseEnvelope<unknown>;
      if (!res.ok || !body.ok) {
        throw new OrbitApiError(body.error?.code ?? "ORBIT_API_ERROR", body.error?.message ?? "request failed", res.status);
      }
      return body.payload;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new OrbitApiError("TIMEOUT", `request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
