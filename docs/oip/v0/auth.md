# OIP v0 Auth

## Sender Authentication
- Federation endpoints may require bearer auth for ingress.
- Orbit supports `ORBIT_FEDERATION_INBOUND_TOKEN` for shared-secret auth.

## Envelope Signature Model (v0)
- `kid` identifies the sending key.
- `sig` signs the envelope hash.
- Receiver maps `kid` to a trusted secret via policy.

## Runtime Configuration
- Outbound signing:
  - `ORBIT_FEDERATION_KEY_ID`
  - `ORBIT_FEDERATION_SIGNING_SECRET`
- Inbound verification:
  - `ORBIT_FEDERATION_REQUIRE_SIGNED_INBOUND=1`
  - `ORBIT_FEDERATION_TRUSTED_KEYS_JSON='{"kid":"secret"}'`

## Planned v1 Upgrade
- Move from symmetric shared secrets to asymmetric signatures with JWKS rotation.
