import crypto from "node:crypto";
import { OrbitError } from "../errors.js";
import { OrbitConfig } from "../types.js";

interface IssuedToken {
  clientId: string;
  expMs: number;
  scope?: string;
}

const issued = new Map<string, IssuedToken>();

function cleanup(nowMs: number): void {
  for (const [token, meta] of issued.entries()) {
    if (meta.expMs <= nowMs) issued.delete(token);
  }
}

export function oauthMetadata(config: OrbitConfig): Record<string, unknown> {
  return {
    issuer: config.federation.oauth.issuer,
    token_endpoint: `${config.federation.oauth.issuer}/oauth/token`,
    jwks_uri: `${config.federation.oauth.issuer}/.well-known/jwks.json`,
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"]
  };
}

export function issueClientCredentialsToken(
  config: OrbitConfig,
  payload: { clientId: string; clientSecret: string; scope?: string }
): Record<string, unknown> {
  if (!config.federation.oauth.enabled) {
    throw new OrbitError("FORBIDDEN", "oauth is disabled");
  }
  const expected = config.federation.oauth.clients[payload.clientId];
  if (!expected || expected !== payload.clientSecret) {
    throw new OrbitError("UNAUTHORIZED", "invalid client credentials");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const nowMs = Date.now();
  const ttlSec = config.federation.oauth.tokenTtlSec;
  issued.set(token, {
    clientId: payload.clientId,
    expMs: nowMs + ttlSec * 1000,
    scope: payload.scope
  });
  cleanup(nowMs);
  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: ttlSec,
    scope: payload.scope
  };
}

export function verifyBearerToken(config: OrbitConfig, token: string): { clientId: string; scope?: string } {
  if (!config.federation.oauth.enabled) {
    throw new OrbitError("FORBIDDEN", "oauth is disabled");
  }
  const nowMs = Date.now();
  cleanup(nowMs);
  const meta = issued.get(token);
  if (!meta || meta.expMs <= nowMs) {
    throw new OrbitError("UNAUTHORIZED", "invalid or expired token");
  }
  return {
    clientId: meta.clientId,
    scope: meta.scope
  };
}
