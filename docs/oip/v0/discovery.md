# OIP v0 Discovery

## Well-Known Discovery
If enabled, Orbit resolves the remote send endpoint via:

`https://<domain>/.well-known/orbit-federation.json`

Expected document:

```json
{
  "send_endpoint": "https://<domain>/v1/federation/send"
}
```

## Fallback
If discovery is disabled or unavailable, Orbit falls back to:

`https://<domain>/v1/federation/send`

## Controls
- `ORBIT_FEDERATION_DISCOVER_WELL_KNOWN` (`1|0`)
- `ORBIT_FEDERATION_DISCOVERY_TIMEOUT_MS`
