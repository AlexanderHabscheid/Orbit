import { OrbitError } from "../errors.js";
import { OrbitConfig } from "../types.js";

interface FederationWellKnown {
  send_endpoint?: string;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(url, { method: "GET", signal: ac.signal, headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new OrbitError("NOT_FOUND", `discovery request failed with status ${res.status}`);
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof OrbitError) throw err;
    throw new OrbitError("DISCOVERY_FAILED", `federation discovery failed for ${url}`, { err });
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverSendEndpoint(config: OrbitConfig, domain: string): Promise<string> {
  const fallback = `https://${domain}/v1/federation/send`;
  if (!config.federation.discoverWellKnown) return fallback;

  const url = `https://${domain}/.well-known/orbit-federation.json`;
  const raw = (await fetchJson(url, config.federation.discoveryTimeoutMs)) as FederationWellKnown;
  if (typeof raw.send_endpoint !== "string" || raw.send_endpoint.length < 8) {
    return fallback;
  }
  return raw.send_endpoint;
}
