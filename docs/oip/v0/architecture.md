# OIP v0 Architecture

OIP (Orbit Interop Protocol) defines internet-facing agent federation for Orbit.

## Goals
- Domain-scoped addressing for agents.
- Authenticated cross-domain delivery.
- Replay-resistant, signed envelopes.
- Transport split: WAN federation edge vs local high-throughput runtime.

## Layering
1. OIP Core: canonical envelopes, message lifecycle, IDs, ack semantics.
2. OIP Discovery: remote federation endpoint lookup.
3. OIP Auth: sender identity and key binding.
4. OIP Transport: HTTPS federation ingress/egress.
5. OIP Policy: trust, allow/block, abuse controls.
6. OIP Interop: A2A/MCP bridge normalization and dispatch.

## Reference Runtime Mapping
- WAN edge: `POST /v1/federation/send`.
- Internal fabric: NATS subjects (`orbit.federation.inbound.*`).
- Envelope builder/validator: `src/envelope.ts`.
- Federation transport: `src/federation/transport.ts`.
- Federation ingress: `src/federation/ingress.ts`.

## Delivery Classes
- `best_effort`: low overhead, no durable broker requirement.
- `durable`: persisted delivery path and retry semantics.
- `auditable`: durable plus stronger trace/accounting expectations.

## Security Baseline
- Envelope hash verification is mandatory.
- Signature verification is configurable and recommended for federation.
- Nonce + expiration + replay window checks are required on ingress.
- Graylisted domains can be challenge-gated before ingress admission.
- Optional E2EE payload mode (AES-256-GCM shared-key profile) is available for direct federation links.

## Migration Phases
- v0: signed envelope support, discovery bootstrap, ingress/egress paths.
- v1: asymmetric signatures + JWKS rotation + trust policy automation.
- v2: optional E2EE/MLS channels and cross-protocol conformance profiles.
