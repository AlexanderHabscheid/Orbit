import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { issueChallenge, verifyChallenge } from "../src/federation/challenge.js";

function solve(nonce: string, difficulty: number): string {
  let n = 0;
  while (true) {
    const candidate = String(n++);
    const digest = crypto.createHash("sha256").update(`${nonce}:${candidate}`).digest("hex");
    if (digest.startsWith("0".repeat(difficulty))) return candidate;
  }
}

test("challenge issue + solve", () => {
  const c = issueChallenge("example.org", 2, 60);
  const solution = solve(c.nonce, c.difficulty);
  assert.equal(verifyChallenge("example.org", c.challengeId, solution), true);
  assert.equal(verifyChallenge("example.org", c.challengeId, solution), false);
});
