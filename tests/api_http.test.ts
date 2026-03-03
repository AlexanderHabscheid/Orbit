import test from "node:test";
import assert from "node:assert/strict";
import { ApiHttpError, normalizeApiError } from "../src/api_http.js";
import { OrbitError } from "../src/errors.js";

test("normalizeApiError maps OrbitError codes to HTTP statuses", () => {
  const bad = normalizeApiError(new OrbitError("BAD_ARGS", "bad"));
  assert.equal(bad.status, 400);
  const rate = normalizeApiError(new OrbitError("RATE_LIMITED", "slow down"));
  assert.equal(rate.status, 429);
  const notFound = normalizeApiError(new OrbitError("NOT_FOUND", "missing"));
  assert.equal(notFound.status, 404);
});

test("normalizeApiError preserves ApiHttpError", () => {
  const err = new ApiHttpError(401, "UNAUTHORIZED", "nope");
  const out = normalizeApiError(err);
  assert.equal(out.status, 401);
  assert.equal(out.code, "UNAUTHORIZED");
});
