import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { Logger } from "../logger.js";
import { closeBus, connectBus } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { actionFromApiPath, parseObjectPayload } from "../api_contract.js";
import { executeOrbitAction } from "../orbit_actions.js";
import { randomId } from "../util.js";
import { ApiErrorResponse, ApiHttpError, ApiSuccessResponse, normalizeApiError } from "../api_http.js";
import { OrbitError } from "../errors.js";
import { incCounter, observeHistogram, renderPrometheusMetrics, setGauge } from "../metrics.js";

interface HealthResponse {
  ok: true;
  status: "up";
}

interface ReadyResponse {
  ok: boolean;
  status: "ready" | "degraded";
  dependencies: {
    nats: "up" | "down";
  };
}

type AnyResponse = ApiErrorResponse | ApiSuccessResponse | HealthResponse | ReadyResponse;

function writeJson(res: http.ServerResponse, status: number, body: AnyResponse): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(`${JSON.stringify(body)}\n`);
}

function writeError(res: http.ServerResponse, id: string, error: ApiHttpError): void {
  writeJson(res, error.status, {
    id,
    ok: false,
    error: {
      type: "orbit_error",
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    }
  });
}

function extractBearerToken(req: http.IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const header = req.headers["x-orbit-token"];
  if (typeof header === "string") return header.trim();
  return undefined;
}

function ensureAuthorized(req: http.IncomingMessage, config: OrbitConfig): void {
  const requiredToken = config.api.authToken;
  if (requiredToken && extractBearerToken(req) !== requiredToken) {
    throw new ApiHttpError(401, "UNAUTHORIZED", "missing or invalid API token");
  }
  if (config.api.tls.enabled && config.api.tls.requestClientCert && config.api.tls.requireClientCert) {
    const maybeTls = req.socket as { authorized?: boolean };
    if (!maybeTls.authorized) {
      throw new ApiHttpError(401, "UNAUTHORIZED", "valid client TLS certificate is required");
    }
  }
}

async function readJsonBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw new ApiHttpError(413, "PAYLOAD_TOO_LARGE", `request exceeds max body size ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiHttpError(400, "BAD_JSON", "invalid JSON body");
  }
}

function ensureBindHostAllowed(config: OrbitConfig, host: string): void {
  const allow = config.api.allowedHosts;
  if (allow.includes("*") || allow.includes(host)) return;
  throw new OrbitError("FORBIDDEN_BIND_HOST", `host ${host} is not in api.allowedHosts`, { allowedHosts: allow });
}

async function isNatsReady(nc: { flush: () => Promise<void>; isClosed: () => boolean }): Promise<boolean> {
  if (nc.isClosed()) return false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("readiness timeout")), 1000);
    timer.unref?.();
  });
  try {
    await Promise.race([nc.flush(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withTimeout<T>(input: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ApiHttpError(408, "REQUEST_TIMEOUT", `request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([input, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createServer(config: OrbitConfig, handler: http.RequestListener): http.Server | https.Server {
  if (!config.api.tls.enabled) return http.createServer(handler);

  if (!config.api.tls.keyFile || !config.api.tls.certFile) {
    throw new OrbitError("BAD_ARGS", "api tls requires keyFile and certFile");
  }

  const key = fs.readFileSync(config.api.tls.keyFile, "utf-8");
  const cert = fs.readFileSync(config.api.tls.certFile, "utf-8");
  const ca = config.api.tls.caFile ? fs.readFileSync(config.api.tls.caFile, "utf-8") : undefined;
  return https.createServer(
    {
      key,
      cert,
      ca,
      requestCert: config.api.tls.requestClientCert,
      rejectUnauthorized: config.api.tls.requireClientCert
    },
    handler
  );
}

export async function cmdApi(
  config: OrbitConfig,
  logger: Logger,
  opts: { host: string; port: number }
): Promise<void> {
  ensureBindHostAllowed(config, opts.host);
  const nc = await connectBus(config.natsUrl);
  let inFlight = 0;
  setGauge("orbit_api_inflight", inFlight);

  const server = createServer(config, (req, res) => {
    void (async () => {
      const started = Date.now();
      const requestId = req.headers["x-request-id"]?.toString() || randomId();
      let actionLabel = "unknown";
      let entered = false;
      let status = 500;
      try {
        if (req.method === "GET" && req.url === "/healthz") {
          status = 200;
          writeJson(res, 200, { ok: true, status: "up" });
          return;
        }

        if (req.method === "GET" && req.url === "/readyz") {
          const ready = await isNatsReady(nc);
          status = ready ? 200 : 503;
          writeJson(res, status, {
            ok: ready,
            status: ready ? "ready" : "degraded",
            dependencies: { nats: ready ? "up" : "down" }
          });
          return;
        }

        if (req.method === "GET" && req.url === "/metrics") {
          ensureAuthorized(req, config);
          status = 200;
          res.statusCode = 200;
          res.setHeader("content-type", "text/plain; version=0.0.4");
          res.end(renderPrometheusMetrics());
          return;
        }

        if (req.method !== "POST" || !req.url) {
          throw new ApiHttpError(405, "METHOD_NOT_ALLOWED", "use POST /v1/<action>");
        }

        ensureAuthorized(req, config);

        if (inFlight >= config.runtime.apiMaxConcurrent) {
          throw new ApiHttpError(429, "API_OVERLOADED", "api concurrency limit reached");
        }

        inFlight += 1;
        entered = true;
        setGauge("orbit_api_inflight", inFlight);

        const parsedAction = actionFromApiPath(req.url.split("?")[0]);
        if (!parsedAction) {
          throw new ApiHttpError(404, "NOT_FOUND", "unknown endpoint");
        }
        actionLabel = parsedAction;

        const payload = parseObjectPayload(await readJsonBody(req, config.runtime.apiMaxBodyBytes));
        const out = await withTimeout(
          executeOrbitAction(config, nc, parsedAction, payload, "api"),
          config.runtime.apiRequestTimeoutMs
        );
        status = 200;
        writeJson(res, 200, { id: requestId, ok: true, payload: out });
      } catch (err) {
        const apiErr = normalizeApiError(err);
        status = apiErr.status;
        writeError(res, requestId, apiErr);
      } finally {
        const durationMs = Date.now() - started;
        incCounter("orbit_api_requests_total", 1, { action: actionLabel, method: req.method ?? "UNKNOWN", status });
        observeHistogram("orbit_api_request_duration_ms", durationMs, { action: actionLabel, status });
        if (entered) {
          inFlight -= 1;
          setGauge("orbit_api_inflight", inFlight);
        }
      }
    })();
  });

  server.requestTimeout = config.runtime.apiRequestTimeoutMs;
  server.keepAliveTimeout = 5000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });

  logger.info("api online", {
    host: opts.host,
    port: opts.port,
    nats_url: config.natsUrl,
    tls_enabled: config.api.tls.enabled,
    mtls_required: config.api.tls.requestClientCert && config.api.tls.requireClientCert,
    token_auth_enabled: Boolean(config.api.authToken)
  });

  const shutdown = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await closeBus(config.natsUrl);
    } catch {
      // ignore shutdown failures
    }
  };

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  await nc.closed();
}
