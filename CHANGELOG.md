# Changelog

All notable changes to Orbit are documented here.

This project follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [Unreleased]

## [0.1.5] - 2026-03-03

### Changed
- `npm-publish` now upgrades to npm v11 in CI before publish to ensure trusted publishing OIDC support.
- Root and Python package versions bumped to `0.1.5` for another release validation tag.

## [0.1.4] - 2026-03-03

### Changed
- `npm-publish` release step now clears `NODE_AUTH_TOKEN` to force npm trusted publishing via OIDC.
- Root and Python package versions bumped to `0.1.4` for a fresh release validation tag.

## [0.1.3] - 2026-03-03

### Changed
- Release workflow now publishes a single npm package (`orbit-bus`); TypeScript SDK remains in-repo and is no longer published as a separate npm release artifact by CI.
- Release policy/runbook updated to reflect single npm package publishing and Python trusted publishing flow.
- Python package metadata renamed from `orbit-sdk` to `Orbitai-CLI` to match trusted publisher configuration.
- Root and Python package versions bumped to `0.1.3` for trusted publish verification.

## [0.1.2] - 2026-03-03

### Changed
- Published TypeScript SDK under unscoped package name `orbit-sdk-typescript` to remove blocked `@orbit` scope dependency.
- Updated release runbook package naming to match published npm package.
- Version alignment refresh across root package, TypeScript SDK, and Python SDK.

## [0.1.1] - 2026-03-03

### Added
- API hardening: token auth, host allowlist, optional TLS/mTLS, metrics endpoint.
- `GET /readyz` dependency readiness endpoint (NATS flush check) for probe-safe deployments.
- Strict JSON schema validation for API payloads and service method request/response contracts.
- Stable HTTP error envelope + explicit status-code mapping.
- Docker-backed integration test path for `up/serve/call/api/agent`.
- GitHub CI and release workflows with artifact checks and provenance attestation.
- Agent socket startup hardening and permission enforcement.
- Production hardening guide and secure NATS template configs, including 3-node cluster examples.
- Dependency review and CodeQL workflows plus Dependabot config.
- Production bootstrap script (`npm run bootstrap:prod`) to generate hardened API config scaffold.
- TypeScript SDK test suite for auth error mapping, timeout behavior, and call payload parity.
- Python SDK test suite for auth error mapping, timeout behavior, and call payload parity.
- CI smoke-install job that validates packaged `orbit`, `echocore`, `orbit-ts`, and `orbit-py` CLIs.
- API contract and SDK/CLI parity for A2A metadata fields (`taskId`, `threadId`, `parentMessageId`, `capabilities`, `traceparent`, `dedupeKey`) and publish durability.

### Changed
- OTLP trace exporter now retries transient failures with backoff/jitter and requeues unsent events.
- npm package publishing flow migrated to trusted publishing (OIDC) with provenance.
- npm/SDK package manifests now use publish allowlists to prevent shipping tests/docs/local artifacts.
- Python SDK packaging metadata now includes README/license and correctly packages `orbit_cli` entrypoint module.
- License metadata aligned for public distribution (`MIT`) across root, TypeScript SDK, and Python SDK.
- CI/release SDK install and pack steps now use deterministic and directory-scoped commands (`npm ci`, `cd sdk/typescript && ...`).
- Root test runtime moved from deprecated `--loader ts-node/esm` to `--import tsx`.
- Python SDK timeout errors now normalize to `OrbitApiError(code=\"TIMEOUT\")` instead of leaking raw timeout exceptions.
- Docker integration test command arguments were corrected and hardened for local Docker credential/path and Unix socket-path constraints.
