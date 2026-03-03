# Orbit Production Hardening

This checklist is for deploying Orbit for external users and multi-host workloads.

## Runtime Safety Baseline

- Keep `ORBIT_API_TOKEN` enabled for non-local usage.
- Prefer API TLS (`ORBIT_API_TLS_ENABLED=1`) with mTLS for service-to-service traffic.
- Use `GET /readyz` for readiness probes and `GET /healthz` only for liveness.
- Keep strict `api.allowedHosts`; avoid `*` unless behind a trusted ingress.
- Set explicit concurrency/body/request limits using `ORBIT_API_MAX_*` and `ORBIT_API_REQUEST_TIMEOUT_MS`.

Bootstrap helper:

- Run `npm run bootstrap:prod` to generate `./.orbit/config.production.json` with token auth, TLS/mTLS enabled, and explicit API runtime limits.
- Merge into your active `./.orbit/config.json` (project) or `~/.orbit/config.json` (user/global) before launching `orbit api`.

## NATS Security Baseline

- Enable TLS for all client and cluster links.
- Use account/user-based auth; never run production with anonymous access.
- Keep monitoring/admin ports private (localhost or private network only).
- Use JetStream storage on durable volumes with backup/snapshot policy.

Reference templates:

- `examples/nats/nats.production.conf`
- `examples/nats/nats-cluster-node1.conf`
- `examples/nats/nats-cluster-node2.conf`
- `examples/nats/nats-cluster-node3.conf`

## High Availability Baseline

- Run a 3-node NATS cluster for production cells that require availability.
- Spread nodes across failure domains (host/zone/rack).
- Configure client URL lists/failover in Orbit contexts.

## Supply Chain Baseline

- Publish npm packages with trusted publishing (OIDC), no long-lived npm tokens.
- Enable dependency updates and dependency-review checks in CI.
- Keep release builds reproducible and provenance-attested.

## SDK Packaging Baseline

- Keep package allowlists (`files`) so only runtime artifacts are published.
- Ensure Python metadata includes README/license and that CLI module is packaged.
