import { OrbitError } from "../errors.js";
import { OrbitConfig } from "../types.js";

export function extractDomain(agentRef: string): string {
  const at = agentRef.lastIndexOf("@");
  if (at <= 0 || at >= agentRef.length - 1) {
    throw new OrbitError("BAD_ARGS", "federation target must be in the form agent@domain");
  }
  return agentRef.slice(at + 1).toLowerCase();
}

export function isDomainAllowed(config: OrbitConfig, domain: string): { allowed: boolean; reason?: string } {
  const normalized = domain.toLowerCase();
  if (config.federation.blocklist.includes(normalized)) {
    return { allowed: false, reason: "domain is blocklisted" };
  }
  if (config.federation.allowlist.length > 0 && !config.federation.allowlist.includes(normalized)) {
    return { allowed: false, reason: "domain is not allowlisted" };
  }
  return { allowed: true };
}

export function assertDomainAllowed(config: OrbitConfig, domain: string): void {
  const decision = isDomainAllowed(config, domain);
  if (!decision.allowed) {
    throw new OrbitError("FORBIDDEN", `federation to ${domain} denied: ${decision.reason ?? "policy denied"}`);
  }
}

export function resolveTrustedSigningSecret(config: OrbitConfig, kid: string): string | undefined {
  return config.federation.signing.trustedKeys[kid];
}
