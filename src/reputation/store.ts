import fs from "node:fs";
import path from "node:path";
import { OrbitConfig } from "../types.js";
import { ensureDir } from "../util.js";

interface DomainReputation {
  score: number;
  lastSeenTs: string;
  challengedUntilTs?: string;
}

interface ReputationState {
  domains: Record<string, DomainReputation>;
}

let cache: ReputationState | null = null;

function filePath(config: OrbitConfig): string {
  return path.join(config.dataDir, "federation", "reputation.json");
}

function load(config: OrbitConfig): ReputationState {
  if (cache) return cache;
  const p = filePath(config);
  if (!fs.existsSync(p)) {
    cache = { domains: {} };
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(p, "utf-8")) as ReputationState;
  } catch {
    cache = { domains: {} };
  }
  cache.domains ??= {};
  return cache;
}

function save(config: OrbitConfig, state: ReputationState): void {
  const p = filePath(config);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function getDomainReputation(config: OrbitConfig, domain: string): DomainReputation {
  const state = load(config);
  const normalized = domain.toLowerCase();
  const current = state.domains[normalized];
  if (current) return current;
  const created: DomainReputation = {
    score: config.federation.reputation.defaultScore,
    lastSeenTs: new Date(0).toISOString()
  };
  state.domains[normalized] = created;
  save(config, state);
  return created;
}

export function adjustDomainReputation(config: OrbitConfig, domain: string, delta: number): DomainReputation {
  const state = load(config);
  const normalized = domain.toLowerCase();
  const existing = getDomainReputation(config, normalized);
  const next: DomainReputation = {
    ...existing,
    score: Math.max(0, Math.min(100, existing.score + delta)),
    lastSeenTs: new Date().toISOString()
  };
  state.domains[normalized] = next;
  save(config, state);
  return next;
}

export function markChallengeGrace(config: OrbitConfig, domain: string, graceSec: number): void {
  const state = load(config);
  const normalized = domain.toLowerCase();
  const existing = getDomainReputation(config, normalized);
  state.domains[normalized] = {
    ...existing,
    challengedUntilTs: new Date(Date.now() + graceSec * 1000).toISOString(),
    lastSeenTs: new Date().toISOString()
  };
  save(config, state);
}

export function isInChallengeGrace(config: OrbitConfig, domain: string): boolean {
  const rep = getDomainReputation(config, domain);
  if (!rep.challengedUntilTs) return false;
  return Date.parse(rep.challengedUntilTs) > Date.now();
}

export function hasSeenDomain(config: OrbitConfig, domain: string): boolean {
  const rep = getDomainReputation(config, domain);
  return rep.lastSeenTs !== new Date(0).toISOString();
}
