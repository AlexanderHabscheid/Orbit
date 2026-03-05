import crypto from "node:crypto";
import { OrbitError } from "../errors.js";

interface EncryptedPayload {
  key_id: string;
  iv: string;
  tag: string;
  ciphertext: string;
  alg: "aes-256-gcm";
}

function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new OrbitError("BAD_ARGS", "e2ee key must be 32-byte base64 value");
  }
  return key;
}

export function encryptJsonPayload(payload: unknown, keyId: string, base64Key: string): EncryptedPayload {
  const key = decodeKey(base64Key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    key_id: keyId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    alg: "aes-256-gcm"
  };
}

export function decryptJsonPayload(input: EncryptedPayload, base64Key: string): unknown {
  const key = decodeKey(base64Key);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(input.iv, "base64"));
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(input.ciphertext, "base64")), decipher.final()]);
  try {
    return JSON.parse(plaintext.toString("utf-8")) as unknown;
  } catch {
    throw new OrbitError("BAD_JSON", "failed to parse decrypted payload");
  }
}

export function isEncryptedPayload(input: unknown): input is EncryptedPayload {
  if (!input || typeof input !== "object") return false;
  const rec = input as Record<string, unknown>;
  return (
    rec.alg === "aes-256-gcm" &&
    typeof rec.key_id === "string" &&
    typeof rec.iv === "string" &&
    typeof rec.tag === "string" &&
    typeof rec.ciphertext === "string"
  );
}
