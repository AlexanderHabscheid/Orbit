import crypto from "node:crypto";
import { Logger } from "../logger.js";
import { OrbitError } from "../errors.js";
import { OrbitConfig } from "../types.js";
import { generateFederationKeyPair, writeFederationKeyPair } from "../identity/keys.js";
import { localJwks } from "../identity/jwks.js";
import { readUserConfigRaw, writeUserConfigRaw } from "../config.js";

function randomSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function cmdFederation(
  config: OrbitConfig,
  logger: Logger,
  opts: { subcommand?: string; domain?: string; clientId?: string; keyId?: string }
): void {
  const sub = opts.subcommand ?? "help";
  if (sub === "bootstrap") {
    const domain = opts.domain ?? config.federation.localDomain;
    const clientId = opts.clientId ?? "orbit-agent";

    const pair = generateFederationKeyPair();
    const files = writeFederationKeyPair(config, pair);
    const clientSecret = randomSecret();

    const raw = readUserConfigRaw();
    const federationRaw = (raw.federation && typeof raw.federation === "object"
      ? raw.federation
      : {}) as Record<string, unknown>;
    const signingRaw = (federationRaw.signing && typeof federationRaw.signing === "object"
      ? federationRaw.signing
      : {}) as Record<string, unknown>;
    const oauthRaw = (federationRaw.oauth && typeof federationRaw.oauth === "object"
      ? federationRaw.oauth
      : {}) as Record<string, unknown>;
    const clientsRaw = (oauthRaw.clients && typeof oauthRaw.clients === "object"
      ? oauthRaw.clients
      : {}) as Record<string, unknown>;

    const next = {
      ...raw,
      federation: {
        ...federationRaw,
        enabled: true,
        localDomain: domain,
        signing: {
          ...signingRaw,
          algorithm: "ed25519",
          keyId: pair.kid,
          privateKeyFile: files.privateKeyFile,
          publicKeyFile: files.publicKeyFile,
          discoverJwks: true,
          requireSignedInbound: true
        },
        oauth: {
          ...oauthRaw,
          enabled: true,
          issuer: oauthRaw.issuer ?? "http://127.0.0.1:8787",
          audience: oauthRaw.audience ?? "orbit-federation",
          tokenTtlSec: oauthRaw.tokenTtlSec ?? 3600,
          clients: {
            ...clientsRaw,
            [clientId]: clientSecret
          }
        },
        reputation: {
          enabled: true,
          defaultScore: 50,
          minScore: 20,
          trustOnFirstSeen: false
        },
        challenge: {
          enabled: true,
          difficulty: 3,
          ttlSec: 120,
          graceSec: 900
        },
        e2ee: {
          enabled: false,
          keys: {}
        }
      }
    };
    writeUserConfigRaw(next);

    const out = {
      ok: true,
      localDomain: domain,
      keyId: pair.kid,
      privateKeyFile: files.privateKeyFile,
      publicKeyFile: files.publicKeyFile,
      oauthClientId: clientId,
      oauthClientSecret: clientSecret,
      next: [
        "Start API: orbit api --host 0.0.0.0 --port 8787",
        "Share domain/.well-known/jwks.json endpoint",
        "Use oauth token from /oauth/token for federation ingress auth"
      ]
    };
    logger.info("federation bootstrap complete", out as Record<string, unknown>);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }

  if (sub === "jwks") {
    const out = localJwks(config);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }

  if (sub === "gen-e2ee-key") {
    const keyId = opts.keyId ?? "default";
    const raw = readUserConfigRaw();
    const federationRaw = (raw.federation && typeof raw.federation === "object"
      ? raw.federation
      : {}) as Record<string, unknown>;
    const e2eeRaw = (federationRaw.e2ee && typeof federationRaw.e2ee === "object"
      ? federationRaw.e2ee
      : {}) as Record<string, unknown>;
    const keysRaw = (e2eeRaw.keys && typeof e2eeRaw.keys === "object"
      ? e2eeRaw.keys
      : {}) as Record<string, unknown>;
    const generated = crypto.randomBytes(32).toString("base64");
    writeUserConfigRaw({
      ...raw,
      federation: {
        ...federationRaw,
        e2ee: {
          ...e2eeRaw,
          enabled: true,
          keys: {
            ...keysRaw,
            [keyId]: generated
          }
        }
      }
    });
    process.stdout.write(`${JSON.stringify({ ok: true, keyId, key: generated })}\n`);
    return;
  }

  if (sub === "help") {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        usage: [
          "orbit federation bootstrap [--domain <domain>] [--client-id <id>]",
          "orbit federation jwks",
          "orbit federation gen-e2ee-key [--key-id <id>]"
        ]
      })}\n`
    );
    return;
  }

  throw new OrbitError("BAD_ARGS", `unknown federation subcommand: ${sub}`);
}
