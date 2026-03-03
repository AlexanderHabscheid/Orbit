# Orbit Python SDK

Python client and CLI for the Orbit external API (`orbit api`).

## Usage

```python
from orbit_sdk import OrbitClient

client = OrbitClient(base_url="http://127.0.0.1:8787")
print(
    client.call(
        "text.upper",
        {"text": "hello"},
        timeout_ms=3000,
        retries=1,
        pack_file="./blob.bin",
        task_id="task-1",
        thread_id="thread-1",
        parent_message_id="msg-0",
        capabilities=["search"],
        traceparent="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
        dedupe_key="call-1",
    )
)
```

CLI:

```bash
orbit-py call text.upper --json '{"text":"hello"}' --base-url http://127.0.0.1:8787 --timeout-ms 3000 --retries 1 --pack-file ./blob.bin --task-id task-1 --thread-id thread-1 --parent-message-id msg-0 --capabilities '["search"]' --traceparent '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00' --dedupe-key call-1
orbit-py --token "$ORBIT_API_TOKEN" call text.upper --json '{"text":"hello"}'
```
