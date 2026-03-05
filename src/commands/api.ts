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
import { handleFederationIngress } from "../federation/ingress.js";
import { localJwks } from "../identity/jwks.js";
import { issueClientCredentialsToken, oauthMetadata, verifyBearerToken } from "../identity/oauth.js";
import { adjustDomainReputation, getDomainReputation, hasSeenDomain, isInChallengeGrace, markChallengeGrace } from "../reputation/store.js";
import { assertChallengeSolved, issueChallenge } from "../federation/challenge.js";

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

function readBasicClientCredentials(req: http.IncomingMessage): { clientId: string; clientSecret: string } | null {
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    if (idx <= 0) return null;
    return { clientId: decoded.slice(0, idx), clientSecret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
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

function ensureFederationAuthorized(req: http.IncomingMessage, config: OrbitConfig): void {
  const requiredToken = config.federation.inboundAuthToken;
  const bearer = extractBearerToken(req);
  if (requiredToken && bearer === requiredToken) return;
  if (config.federation.oauth.enabled && bearer) {
    verifyBearerToken(config, bearer);
    return;
  }
  if (requiredToken) {
    throw new ApiHttpError(401, "UNAUTHORIZED", "missing or invalid federation token");
  }
  if (config.federation.oauth.enabled) {
    throw new ApiHttpError(401, "UNAUTHORIZED", "missing bearer token");
  }
}

function parseDomain(agentRef: string): string {
  const at = agentRef.lastIndexOf("@");
  if (at <= 0 || at >= agentRef.length - 1) {
    throw new ApiHttpError(400, "BAD_ARGS", "federation sender must be in the form agent@domain");
  }
  return agentRef.slice(at + 1).toLowerCase();
}

function enforceAdmissionPolicy(
  req: http.IncomingMessage,
  config: OrbitConfig,
  senderDomain: string
): void {
  if (!config.federation.reputation.enabled || !config.federation.challenge.enabled) return;
  if (config.federation.allowlist.includes(senderDomain)) return;
  if (isInChallengeGrace(config, senderDomain)) return;

  const seen = hasSeenDomain(config, senderDomain);
  if (!seen && config.federation.reputation.trustOnFirstSeen) return;

  const rep = getDomainReputation(config, senderDomain);
  if (rep.score >= config.federation.reputation.minScore) return;

  const challengeId = req.headers["x-orbit-challenge-id"]?.toString();
  const challengeSolution = req.headers["x-orbit-challenge-solution"]?.toString();
  if (challengeId && challengeSolution) {
    try {
      assertChallengeSolved(senderDomain, challengeId, challengeSolution);
      markChallengeGrace(config, senderDomain, config.federation.challenge.graceSec);
      adjustDomainReputation(config, senderDomain, 5);
      return;
    } catch {
      adjustDomainReputation(config, senderDomain, -8);
      throw new ApiHttpError(403, "CHALLENGE_FAILED", "challenge solution was invalid");
    }
  }
  const challenge = issueChallenge(
    senderDomain,
    config.federation.challenge.difficulty,
    config.federation.challenge.ttlSec
  );
  adjustDomainReputation(config, senderDomain, -3);
  throw new ApiHttpError(403, "CHALLENGE_REQUIRED", "challenge required for sender domain", {
    challenge
  });
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

async function readBodyText(req: http.IncomingMessage, maxBytes: number): Promise<string> {
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
  return Buffer.concat(chunks).toString("utf-8").trim();
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

        if (req.method === "GET" && req.url === "/.well-known/jwks.json") {
          status = 200;
          writeJson(res, 200, localJwks(config) as unknown as AnyResponse);
          return;
        }

        if (req.method === "GET" && req.url === "/.well-known/oauth-authorization-server") {
          status = 200;
          writeJson(res, 200, oauthMetadata(config) as unknown as AnyResponse);
          return;
        }

        if (req.method === "POST" && req.url === "/oauth/token") {
          const basic = readBasicClientCredentials(req);
          const contentType = String(req.headers["content-type"] ?? "");
          const parsed = contentType.includes("application/x-www-form-urlencoded")
            ? Object.fromEntries(new URLSearchParams(await readBodyText(req, config.runtime.apiMaxBodyBytes)).entries())
            : parseObjectPayload(await readJsonBody(req, config.runtime.apiMaxBodyBytes));
          const grantType = String(parsed.grant_type ?? "");
          if (grantType !== "client_credentials") {
            throw new ApiHttpError(400, "BAD_ARGS", "oauth grant_type must be client_credentials");
          }
          const clientId = basic?.clientId ?? String(parsed.client_id ?? "");
          const clientSecret = basic?.clientSecret ?? String(parsed.client_secret ?? "");
          if (!clientId || !clientSecret) {
            throw new ApiHttpError(401, "UNAUTHORIZED", "missing oauth client credentials");
          }
          status = 200;
          writeJson(
            res,
            200,
            issueClientCredentialsToken(config, {
              clientId,
              clientSecret,
              scope: typeof parsed.scope === "string" ? parsed.scope : undefined
            }) as unknown as AnyResponse
          );
          return;
        }

        if (req.method === "POST" && req.url === "/v1/federation/challenge") {
          const payload = parseObjectPayload(await readJsonBody(req, config.runtime.apiMaxBodyBytes));
          const from = String(payload.from ?? "");
          const domain = parseDomain(from);
          const out = issueChallenge(domain, config.federation.challenge.difficulty, config.federation.challenge.ttlSec);
          status = 200;
          writeJson(res, 200, out as unknown as AnyResponse);
          return;
        }

        if (req.method !== "POST" || !req.url) {
          throw new ApiHttpError(405, "METHOD_NOT_ALLOWED", "use POST /v1/<action>");
        }

        if (req.method === "POST" && req.url.split("?")[0] === "/v1/federation/send") {
          if (!config.federation.enabled) {
            throw new ApiHttpError(403, "FORBIDDEN", "federation is disabled");
          }
          ensureFederationAuthorized(req, config);
          if (inFlight >= config.runtime.apiMaxConcurrent) {
            throw new ApiHttpError(429, "API_OVERLOADED", "api concurrency limit reached");
          }
          inFlight += 1;
          entered = true;
          actionLabel = "federation_send";
          setGauge("orbit_api_inflight", inFlight);
          const payload = parseObjectPayload(await readJsonBody(req, config.runtime.apiMaxBodyBytes));
          const from = String(payload.from ?? "");
          const senderDomain = parseDomain(from);
          enforceAdmissionPolicy(req, config, senderDomain);
          const out = await withTimeout(
            handleFederationIngress(config, nc, payload),
            config.runtime.apiRequestTimeoutMs
          );
          status = 200;
          writeJson(res, 200, { id: requestId, ok: true, payload: out });
          return;
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
