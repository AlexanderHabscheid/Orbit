import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { OrbitError } from "../errors.js";
import { OrbitConfig } from "../types.js";
import { ensureDir, sha256 } from "../util.js";

export type OrbitJwk = crypto.JsonWebKey & { kid?: string; use?: string; alg?: string };

export interface GeneratedKeyPair {
  kid: string;
  privateKeyPem: string;
  publicKeyPem: string;
  publicJwk: OrbitJwk;
}

function toKid(jwk: OrbitJwk): string {
  const keyMaterial = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x });
  return `ed25519-${sha256(keyMaterial).slice(0, 16)}`;
}

export function generateFederationKeyPair(): GeneratedKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" }) as OrbitJwk;
  const kid = toKid(publicJwk);
  return {
    kid,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    publicJwk
  };
}

export function writeFederationKeyPair(config: OrbitConfig, pair: GeneratedKeyPair): { privateKeyFile: string; publicKeyFile: string } {
  const dir = path.join(config.dataDir, "identity", "keys");
  ensureDir(dir);
  const privateKeyFile = path.join(dir, `${pair.kid}.private.pem`);
  const publicKeyFile = path.join(dir, `${pair.kid}.public.pem`);
  fs.writeFileSync(privateKeyFile, pair.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(publicKeyFile, pair.publicKeyPem, { mode: 0o644 });
  return { privateKeyFile, publicKeyFile };
}

export function loadPrivateKeyPem(config: OrbitConfig): string {
  if (!config.federation.signing.privateKeyFile) {
    throw new OrbitError("BAD_ARGS", "federation signing privateKeyFile is not configured");
  }
  return fs.readFileSync(config.federation.signing.privateKeyFile, "utf-8");
}

export function loadPublicJwk(config: OrbitConfig): OrbitJwk {
  if (!config.federation.signing.publicKeyFile) {
    throw new OrbitError("BAD_ARGS", "federation signing publicKeyFile is not configured");
  }
  const pem = fs.readFileSync(config.federation.signing.publicKeyFile, "utf-8");
  const key = crypto.createPublicKey(pem);
  return key.export({ format: "jwk" }) as OrbitJwk;
}
