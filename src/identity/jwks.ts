import crypto from "node:crypto";
import { OrbitError } from "../errors.js";
import { OrbitConfig } from "../types.js";
import { loadPublicJwk, OrbitJwk } from "./keys.js";

const cache = new Map<string, { expiresAt: number; keys: OrbitJwk[] }>();

export function localJwks(config: OrbitConfig): { keys: OrbitJwk[] } {
  if (config.federation.signing.algorithm !== "ed25519") {
    return { keys: [] };
  }
  if (!config.federation.signing.keyId || !config.federation.signing.publicKeyFile) {
    return { keys: [] };
  }
  const jwk = loadPublicJwk(config);
  return {
    keys: [
      {
        ...jwk,
        use: "sig",
        alg: "EdDSA",
        kid: config.federation.signing.keyId
      }
    ]
  };
}

async function fetchJwksForDomain(domain: string, timeoutMs: number): Promise<OrbitJwk[]> {
  const now = Date.now();
  const c = cache.get(domain);
  if (c && c.expiresAt > now) return c.keys;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(`https://${domain}/.well-known/jwks.json`, {
      method: "GET",
      signal: ac.signal,
      headers: { accept: "application/json" }
    });
    if (!res.ok) throw new OrbitError("DISCOVERY_FAILED", `JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys?: OrbitJwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    cache.set(domain, { keys, expiresAt: now + 5 * 60_000 });
    return keys;
  } catch (err) {
    if (err instanceof OrbitError) throw err;
    throw new OrbitError("DISCOVERY_FAILED", `failed to fetch JWKS for ${domain}`, { err });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePublicKeyPemByKid(config: OrbitConfig, kid: string, domain?: string): Promise<string | undefined> {
  if (config.federation.signing.trustedKeys[kid]) {
    return config.federation.signing.trustedKeys[kid];
  }
  if (!domain || !config.federation.signing.discoverJwks) return undefined;

  const keys = await fetchJwksForDomain(domain, config.federation.discoveryTimeoutMs);
  const match = keys.find((k) => k.kid === kid);
  if (!match) return undefined;
  try {
    const pk = crypto.createPublicKey({ key: match as crypto.JsonWebKey, format: "jwk" });
    return pk.export({ type: "spki", format: "pem" }).toString();
  } catch {
    return undefined;
  }
}
