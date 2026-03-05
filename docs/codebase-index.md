# Orbit Codebase Index

This index maps the runtime wiring, SDK integrations, and module ownership.

## Entry Points

- `src/index.ts`: main `orbit` executable entrypoint.
- `src/cli.ts`: CLI argument routing and command dispatch.
- `src/echocore.ts`: `echocore` executable entrypoint.
- `sdk/typescript/src/cli.ts`: `orbit-ts` API client CLI.
- `sdk/python/orbit_cli.py`: `orbit-py` API client CLI.

## Runtime Core

- `src/config.ts`: config resolution (`defaults + ~/.orbit + ./.orbit + env`).
- `src/nats.ts`: NATS connection/cache helpers, KV/Object Store helpers, JSON codecs.
- `src/envelope.ts`: canonical envelope creation/validation.
- `src/retry.ts`: retry and timeout wrapper used by RPC call paths.
- `src/trace.ts`: trace event append/read functions.
- `src/logger.ts`: structured logger output.
- `src/errors.ts`: `OrbitError` typed error surface.

## EchoCore Module

- `src/echo/bus.ts`: in-process channel isolation + pub/sub routing.
- `src/echo/ring_buffer.ts`: shared-memory slot ring buffer implementation.
- `src/echo/daemon.ts`: local daemon for unix-socket (and optional TCP fallback) bridging.
- `src/echo/client.ts`: CLI/client transport helper for daemon commands.
- `src/echo/benchmark.ts`: local benchmark harness for in-process vs network-framed baseline.
- `src/echo/cli.ts`: `echocore` command routing (`start|publish|subscribe|stats|bench`).

## Cell Bridging

- `src/cell/routing.ts`: channel routing plan resolution (`local_only|replicate|global_only`).
- `src/cell/gateway.ts`: local EchoCore <-> Orbit network bridge runtime.
- `src/cell/template.ts`: production route template generator for `orbit cell init`.

## Bus Commands (`orbit`)

- `src/commands/up.ts`: boot local broker (`nats-server` or Docker fallback).
- `src/commands/serve.ts`: service adapter host, request handling, service discovery, `$SRV.*` compatibility.
- `src/commands/call.ts`: request/reply RPC client path (agent fallback supported).
- `src/commands/publish.ts`: pub/sub publish path (agent fallback supported).
- `src/commands/subscribe.ts`: pub/sub subscribe consumer.
- `src/commands/inspect.ts`: service inspect via Orbit + `$SRV.INFO` fallback.
- `src/commands/context.ts`: context set/use/list/current.
- `src/commands/trace.ts`: trace timeline rendering.
- `src/commands/bench.ts`: load benchmark.
- `src/commands/bench_overhead.ts`: agent-vs-direct overhead benchmark.
- `src/commands/monitor.ts`: health/stat polling and alert state machine.
- `src/commands/agent.ts`: local UNIX-socket control plane agent.
- `src/commands/api.ts`: external HTTP API service.
- `src/commands/federate.ts`: outbound federated message sender.
- `src/commands/federation.ts`: federation bootstrap (`keygen + oauth client`) and JWKS view.
- `src/commands/bridge.ts`: protocol bridge CLI (`a2a|mcp`) normalization/dispatch.
- `src/commands/abuse_report.ts`: abuse report submitter CLI.
- `src/commands/cell.ts`: cell lifecycle (`init|start|gateway|status`) and status persistence.
- `src/cli.ts` (`echo` and `cell` subcommands): forwards to EchoCore and cell runtime wiring.

## Adapter/Execution Layer

- `src/spec.ts`: service spec loader/validator.
- `src/service_adapter.ts`: transport executors (`spawn`, `worker`, `http`) and request templating.
- `src/worker_pool.ts`: persistent worker process pool for `worker` transport.
- `src/registry.ts`: distributed/local service registry access.

## External API + Action Routing

- `src/api_contract.ts`: action typing and API path parsing.
- `src/orbit_actions.ts`: action executor shared by `orbit api` and `orbit agent`.
- `src/api_http.ts`: API HTTP error normalization and status mapping.
- `src/json_schema.ts`: JSON-schema validator used for API and service contracts.
- `src/metrics.ts`: in-process counters/histograms and Prometheus rendering.

## Federation Layer

- `src/federation/transport.ts`: outbound federation transport (`orbit federate`, API `federate` action).
- `src/federation/discovery.ts`: `/.well-known/orbit-federation.json` resolution with fallback.
- `src/federation/policy.ts`: allowlist/blocklist policy checks + trusted key lookups.
- `src/federation/ingress.ts`: inbound federation validation/replay checks + NATS publish.
- `src/federation/replay_guard.ts`: in-memory replay nonce guard.
- `src/federation/challenge.ts`: proof-of-work challenge issue/verify for graylisted domains.

## Identity/OAuth

- `src/identity/keys.ts`: Ed25519 keypair generation and local key material loading.
- `src/identity/jwks.ts`: local JWKS publishing and remote JWKS key resolution cache.
- `src/identity/oauth.ts`: OAuth client-credentials token issue and bearer verification.

## Security + Policy

- `src/reputation/store.ts`: domain reputation persistence and challenge-grace tracking.
- `src/reputation/abuse.ts`: abuse report publish path and reputation penalty updates.
- `src/security/e2ee.ts`: AES-256-GCM payload encryption/decryption helpers.

## Interop Bridges

- `src/bridge/protocols.ts`: A2A/MCP message normalization to Orbit-compatible shape.

## SDKs

- TypeScript SDK:
  - `sdk/typescript/src/client.ts`: HTTP client and error mapping.
  - `sdk/typescript/src/types.ts`: API action and client parameter types.
  - `sdk/typescript/src/cli.ts`: CLI wrapper for API calls.
- Python SDK:
  - `sdk/python/orbit_sdk/client.py`: HTTP client and error mapping.
  - `sdk/python/orbit_cli.py`: CLI wrapper for API calls.

## Contracts + Docs

- `docs/orbit-api-contract.yaml`: OpenAPI contract for external API endpoints.
- `docs/production-hardening.md`: production deployment checklist and hardening controls.
- `README.md`: operator docs for broker, service, API, SDKs, monitor, bench flows.
- `scripts/bootstrap-production-config.ts`: generates hardened API production config scaffold.

## Tests

- `tests/api_contract.test.ts`: API path + payload object parsing checks.
- `tests/envelope.test.ts`: envelope integrity and pack reference behavior.
- `tests/retry.test.ts`: retry/timeout behavior.
- `tests/monitor_alerts.test.ts`: monitor alert lifecycle behavior.
- `tests/service_adapter.test.ts`: transport executor behavior.
- `tests/federation_policy.test.ts`: federation allow/block policy behavior.
- `tests/replay_guard.test.ts`: nonce replay window behavior.
- `tests/oauth.test.ts`: OAuth client-credentials token issue/verify behavior.
- `tests/challenge.test.ts`: proof-of-work challenge behavior.
- `tests/e2ee.test.ts`: encrypted payload roundtrip behavior.
- `tests/bridge.test.ts`: A2A/MCP normalization behavior.
- `tests/integration.orbit.e2e.test.ts`: Docker-backed NATS integration flow (`up/serve/call/api/agent`).

## Integration Wiring Notes

- Core runtime wiring is healthy: typecheck and tests pass.
- Primary restored integration parity:
  - External API `call` now has documented and SDK/CLI-exposed parity for `retries` and `packFile`.
  - TypeScript SDK request timeout now honors per-request `timeoutMs` for HTTP round-trip timeout handling (not only constructor default).
