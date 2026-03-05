import test from "node:test";
import assert from "node:assert/strict";
import { decryptJsonPayload, encryptJsonPayload, isEncryptedPayload } from "../src/security/e2ee.js";

test("e2ee encrypt/decrypt roundtrip", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const enc = encryptJsonPayload({ hello: "world" }, "k1", key);
  assert.equal(isEncryptedPayload(enc), true);
  const out = decryptJsonPayload(enc, key);
  assert.deepEqual(out, { hello: "world" });
});
