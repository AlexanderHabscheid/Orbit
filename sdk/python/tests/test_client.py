import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from orbit_sdk.client import OrbitApiError, OrbitClient


class _Handler(BaseHTTPRequestHandler):
    behavior = {"status": 200, "body": {"id": "1", "ok": True, "payload": {"ok": True}}, "delay_s": 0.0}
    captured = {"path": "", "json": None}

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        _Handler.captured = {"path": self.path, "json": json.loads(raw)}
        delay_s = float(_Handler.behavior.get("delay_s", 0.0))
        if delay_s > 0:
            time.sleep(delay_s)
        body = _Handler.behavior["body"]
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(int(_Handler.behavior["status"]))
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):  # noqa: A003
        return


class OrbitClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=1)

    def setUp(self):
        _Handler.behavior = {"status": 200, "body": {"id": "1", "ok": True, "payload": {"ok": True}}, "delay_s": 0.0}
        _Handler.captured = {"path": "", "json": None}

    def test_maps_unauthorized_api_errors(self):
        _Handler.behavior = {
            "status": 401,
            "body": {"id": "1", "ok": False, "error": {"code": "UNAUTHORIZED", "message": "missing token"}},
            "delay_s": 0.0,
        }
        client = OrbitClient(base_url=self.base_url, timeout_s=1.0)
        with self.assertRaises(OrbitApiError) as ctx:
            client.ping()
        self.assertEqual(ctx.exception.code, "UNAUTHORIZED")
        self.assertEqual(ctx.exception.status, 401)

    def test_honors_client_timeout(self):
        _Handler.behavior["delay_s"] = 0.15
        client = OrbitClient(base_url=self.base_url, timeout_s=0.02)
        with self.assertRaises(OrbitApiError) as ctx:
            client.call("svc.echo", {"text": "x"})
        self.assertEqual(ctx.exception.code, "TIMEOUT")

    def test_call_payload_parity(self):
        client = OrbitClient(base_url=self.base_url, timeout_s=1.0)
        client.call(
            "svc.upper",
            {"text": "hello"},
            timeout_ms=1234,
            retries=2,
            run_id="run-123",
            pack_file="/tmp/blob.bin",
            task_id="task-1",
            thread_id="thread-9",
            parent_message_id="msg-0",
            capabilities=["search", "retrieve"],
            traceparent="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
            dedupe_key="call-dedupe-1",
        )
        self.assertEqual(_Handler.captured["path"], "/v1/call")
        self.assertEqual(
            _Handler.captured["json"],
            {
                "target": "svc.upper",
                "body": {"text": "hello"},
                "timeoutMs": 1234,
                "retries": 2,
                "runId": "run-123",
                "packFile": "/tmp/blob.bin",
                "taskId": "task-1",
                "threadId": "thread-9",
                "parentMessageId": "msg-0",
                "capabilities": ["search", "retrieve"],
                "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
                "dedupeKey": "call-dedupe-1",
            },
        )


if __name__ == "__main__":
    unittest.main()
