const seen = new Map<string, number>();

function cleanup(nowMs: number): void {
  for (const [nonce, expMs] of seen.entries()) {
    if (expMs <= nowMs) seen.delete(nonce);
  }
}

export function checkAndRememberNonce(nonce: string, ttlSec: number, nowMs = Date.now()): boolean {
  cleanup(nowMs);
  if (seen.has(nonce)) return false;
  seen.set(nonce, nowMs + ttlSec * 1000);
  return true;
}
