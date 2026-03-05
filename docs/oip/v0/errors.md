# OIP v0 Error Semantics

Standard Orbit error envelope applies (`ok=false`, `error.code`, `error.message`).

## Federation Error Codes
- `FEDERATION_SEND_FAILED`: outbound delivery/IO failure.
- `DISCOVERY_FAILED`: remote discovery request failed.
- `UNKNOWN_SIGNER`: `kid` not trusted by receiver.
- `INVALID_ENVELOPE_SIGNATURE`: signature mismatch.
- `ENVELOPE_SIGNATURE_REQUIRED`: policy requires signatures.
- `REPLAY_DETECTED`: nonce already seen in replay window.
- `ENVELOPE_EXPIRED`: `exp` outside acceptance window.
- `FORBIDDEN`: federation blocked by policy or disabled.
- `CHALLENGE_REQUIRED`: sender domain must solve proof-of-work challenge.
- `CHALLENGE_FAILED`: submitted challenge proof was invalid.

## HTTP Mapping
Orbit API normalization maps policy/auth/validation errors to standard status classes.
