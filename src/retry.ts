import { OrbitError } from "./errors.js";

export interface RetryOptions {
  retries: number;
  timeoutMs: number;
  onRetry?: (attempt: number, err: unknown) => void;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OrbitError("TIMEOUT", `Timed out after ${ms}ms`));
    }, ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function withRetries<T>(
  work: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<{ value: T; attempts: number }> {
  const totalAttempts = Math.max(1, options.retries + 1);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const value = await withTimeout(work(attempt), options.timeoutMs);
      return { value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < totalAttempts) options.onRetry?.(attempt, err);
    }
  }
  throw lastErr ?? new OrbitError("UNKNOWN", "retry failed");
}
