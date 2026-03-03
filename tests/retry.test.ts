import test from "node:test";
import assert from "node:assert/strict";
import { withRetries } from "../src/retry.js";
import { OrbitError } from "../src/errors.js";

test("withRetries retries and succeeds", async () => {
  let calls = 0;
  const out = await withRetries(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("not yet");
      return "ok";
    },
    { retries: 3, timeoutMs: 100 }
  );
  assert.equal(out.value, "ok");
  assert.equal(out.attempts, 3);
});

test("withRetries stops after max attempts", async () => {
  await assert.rejects(
    () =>
      withRetries(
        async () => {
          throw new Error("always fails");
        },
        { retries: 1, timeoutMs: 100 }
      ),
    /always fails/
  );
});

test("withRetries emits timeout", async () => {
  await assert.rejects(
    () =>
      withRetries(
        async () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve("late"), 100);
          }),
        { retries: 0, timeoutMs: 10 }
      ),
    (err: unknown) => err instanceof OrbitError && err.code === "TIMEOUT"
  );
});

