# OIP v0 Message

## Envelope
The OIP envelope extends Orbit's canonical envelope with federation security fields.

```json
{
  "id": "uuid",
  "run_id": "uuid",
  "ts": "2026-03-05T00:00:00.000Z",
  "kind": "request",
  "schema_version": "1.0",
  "payload": {},
  "a2a": {},
  "nonce": "uuid",
  "exp": "2026-03-05T00:00:05.000Z",
  "ack_id": "uuid",
  "trace_id": "uuid",
  "kid": "key-id",
  "sig": "base64url-signature",
  "hash": "sha256-canonical"
}
```

## Required Validation
- `hash` must match canonical fields.
- If `exp` is present, the envelope must be within allowed skew.
- If signatures are required by policy, `kid` and `sig` must validate.
- If `nonce` is present, replay protection must reject duplicates.

## Federation Send Body
`POST /v1/federation/send`

```json
{
  "from": "agent@source-domain",
  "to": "agent@dest-domain",
  "target": "service.method",
  "delivery_class": "durable",
  "envelope": {"...": "..."}
}
```
