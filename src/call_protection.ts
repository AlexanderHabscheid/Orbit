import { OrbitError } from "./errors.js";
import { OrbitConfig } from "./types.js";

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

type CircuitMode = "closed" | "open" | "half_open";

interface CircuitState {
  mode: CircuitMode;
  failures: number;
  openedAtMs: number;
  halfOpenInFlight: number;
}

const rateBuckets = new Map<string, TokenBucket>();
const circuits = new Map<string, CircuitState>();

function nowMs(): number {
  return Date.now();
}

export function beforeCall(config: OrbitConfig, target: string): void {
  enforceRateLimit(config, target);
  enforceCircuit(config, target);
}

export function onCallSuccess(target: string): void {
  const state = circuits.get(target);
  if (!state) return;
  state.failures = 0;
  state.mode = "closed";
  state.halfOpenInFlight = 0;
}

export function onCallFailure(config: OrbitConfig, target: string): void {
  const state = circuits.get(target) ?? { mode: "closed", failures: 0, openedAtMs: 0, halfOpenInFlight: 0 };
  state.failures += 1;
  if (state.mode === "half_open") {
    state.mode = "open";
    state.openedAtMs = nowMs();
    state.halfOpenInFlight = 0;
    circuits.set(target, state);
    return;
  }
  if (state.failures >= config.runtime.circuitBreakerFailureThreshold) {
    state.mode = "open";
    state.openedAtMs = nowMs();
    state.halfOpenInFlight = 0;
  }
  circuits.set(target, state);
}

export function afterCallAttempt(target: string): void {
  const state = circuits.get(target);
  if (!state) return;
  if (state.mode === "half_open" && state.halfOpenInFlight > 0) {
    state.halfOpenInFlight -= 1;
  }
}

function enforceRateLimit(config: OrbitConfig, target: string): void {
  const rate = config.runtime.callRateLimitPerSec;
  if (rate <= 0) return;
  const now = nowMs();
  const bucket = rateBuckets.get(target) ?? { tokens: rate, lastRefillMs: now };
  const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
  bucket.tokens = Math.min(rate, bucket.tokens + elapsedSec * rate);
  bucket.lastRefillMs = now;
  if (bucket.tokens < 1) {
    rateBuckets.set(target, bucket);
    throw new OrbitError("RATE_LIMITED", `rate limited target ${target}`);
  }
  bucket.tokens -= 1;
  rateBuckets.set(target, bucket);
}

function enforceCircuit(config: OrbitConfig, target: string): void {
  const cooldownMs = config.runtime.circuitBreakerCooldownMs;
  const halfOpenMax = config.runtime.circuitBreakerHalfOpenMax;
  const now = nowMs();
  const state = circuits.get(target) ?? { mode: "closed", failures: 0, openedAtMs: 0, halfOpenInFlight: 0 };

  if (state.mode === "open") {
    if (now - state.openedAtMs >= cooldownMs) {
      state.mode = "half_open";
      state.halfOpenInFlight = 0;
    } else {
      circuits.set(target, state);
      throw new OrbitError("CIRCUIT_OPEN", `circuit open for target ${target}`);
    }
  }
  if (state.mode === "half_open") {
    if (state.halfOpenInFlight >= halfOpenMax) {
      circuits.set(target, state);
      throw new OrbitError("CIRCUIT_OPEN", `circuit half-open limit reached for ${target}`);
    }
    state.halfOpenInFlight += 1;
  }
  circuits.set(target, state);
}

