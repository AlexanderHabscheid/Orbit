import crypto from "node:crypto";
import { OrbitError } from "../errors.js";

interface Challenge {
  domain: string;
  nonce: string;
  difficulty: number;
  expiresAtMs: number;
}

const challenges = new Map<string, Challenge>();

function cleanup(nowMs: number): void {
  for (const [id, c] of challenges.entries()) {
    if (c.expiresAtMs <= nowMs) challenges.delete(id);
  }
}

export function issueChallenge(domain: string, difficulty: number, ttlSec: number): { challengeId: string; nonce: string; difficulty: number; expiresAt: string } {
  const nowMs = Date.now();
  cleanup(nowMs);
  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAtMs = nowMs + ttlSec * 1000;
  challenges.set(challengeId, {
    domain: domain.toLowerCase(),
    nonce,
    difficulty,
    expiresAtMs
  });
  return {
    challengeId,
    nonce,
    difficulty,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export function verifyChallenge(domain: string, challengeId: string, solution: string): boolean {
  const nowMs = Date.now();
  cleanup(nowMs);
  const c = challenges.get(challengeId);
  if (!c) return false;
  if (c.domain !== domain.toLowerCase()) return false;

  const digest = crypto.createHash("sha256").update(`${c.nonce}:${solution}`).digest("hex");
  const targetPrefix = "0".repeat(c.difficulty);
  const ok = digest.startsWith(targetPrefix);
  if (ok) challenges.delete(challengeId);
  return ok;
}

export function assertChallengeSolved(domain: string, challengeId?: string, solution?: string): void {
  if (!challengeId || !solution) {
    throw new OrbitError("CHALLENGE_REQUIRED", "challenge required for this domain");
  }
  if (!verifyChallenge(domain, challengeId, solution)) {
    throw new OrbitError("CHALLENGE_FAILED", "invalid challenge solution");
  }
}
