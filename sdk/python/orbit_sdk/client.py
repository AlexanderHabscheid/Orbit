from __future__ import annotations

import json
import socket
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib import request, error


class OrbitApiError(Exception):
    def __init__(self, code: str, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class OrbitClient:
    base_url: str = "http://127.0.0.1:8787"
    timeout_s: float = 5.0
    headers: Optional[Dict[str, str]] = None

    def ping(self) -> Any:
        return self._request("ping", {})

    def call(
        self,
        target: str,
        body: Any,
        timeout_ms: Optional[int] = None,
        retries: Optional[int] = None,
        run_id: Optional[str] = None,
        pack_file: Optional[str] = None,
        task_id: Optional[str] = None,
        thread_id: Optional[str] = None,
        parent_message_id: Optional[str] = None,
        capabilities: Optional[list[str]] = None,
        traceparent: Optional[str] = None,
        dedupe_key: Optional[str] = None,
    ) -> Any:
        payload: Dict[str, Any] = {"target": target, "body": body}
        if timeout_ms is not None:
            payload["timeoutMs"] = timeout_ms
        if retries is not None:
            payload["retries"] = retries
        if run_id is not None:
            payload["runId"] = run_id
        if pack_file is not None:
            payload["packFile"] = pack_file
        if task_id is not None:
            payload["taskId"] = task_id
        if thread_id is not None:
            payload["threadId"] = thread_id
        if parent_message_id is not None:
            payload["parentMessageId"] = parent_message_id
        if capabilities is not None:
            payload["capabilities"] = capabilities
        if traceparent is not None:
            payload["traceparent"] = traceparent
        if dedupe_key is not None:
            payload["dedupeKey"] = dedupe_key
        return self._request("call", payload)

    def publish(
        self,
        topic: str,
        body: Any,
        run_id: Optional[str] = None,
        pack_file: Optional[str] = None,
        durable: Optional[bool] = None,
        dedupe_key: Optional[str] = None,
        task_id: Optional[str] = None,
        thread_id: Optional[str] = None,
        parent_message_id: Optional[str] = None,
        capabilities: Optional[list[str]] = None,
        traceparent: Optional[str] = None,
    ) -> Any:
        payload: Dict[str, Any] = {"topic": topic, "body": body}
        if run_id is not None:
            payload["runId"] = run_id
        if pack_file is not None:
            payload["packFile"] = pack_file
        if durable is not None:
            payload["durable"] = durable
        if dedupe_key is not None:
            payload["dedupeKey"] = dedupe_key
        if task_id is not None:
            payload["taskId"] = task_id
        if thread_id is not None:
            payload["threadId"] = thread_id
        if parent_message_id is not None:
            payload["parentMessageId"] = parent_message_id
        if capabilities is not None:
            payload["capabilities"] = capabilities
        if traceparent is not None:
            payload["traceparent"] = traceparent
        return self._request("publish", payload)

    def inspect(self, service: str, timeout_ms: Optional[int] = None) -> Any:
        payload: Dict[str, Any] = {"service": service}
        if timeout_ms is not None:
            payload["timeoutMs"] = timeout_ms
        return self._request("inspect", payload)

    def federate(
        self,
        to: str,
        target: str,
        body: Any,
        endpoint: Optional[str] = None,
        timeout_ms: Optional[int] = None,
        delivery_class: Optional[str] = None,
        e2ee_key_id: Optional[str] = None,
    ) -> Any:
        payload: Dict[str, Any] = {"to": to, "target": target, "body": body}
        if endpoint is not None:
            payload["endpoint"] = endpoint
        if timeout_ms is not None:
            payload["timeoutMs"] = timeout_ms
        if delivery_class is not None:
            payload["deliveryClass"] = delivery_class
        if e2ee_key_id is not None:
            payload["e2eeKeyId"] = e2ee_key_id
        return self._request("federate", payload)

    def bridge(
        self,
        protocol: str,
        message: Dict[str, Any],
        dispatch: Optional[bool] = None,
        to: Optional[str] = None,
        target: Optional[str] = None,
    ) -> Any:
        payload: Dict[str, Any] = {"protocol": protocol, "message": message}
        if dispatch is not None:
            payload["dispatch"] = dispatch
        if to is not None:
            payload["to"] = to
        if target is not None:
            payload["target"] = target
        return self._request("bridge", payload)

    def abuse_report(
        self,
        reporter: str,
        subject: str,
        reason: str,
        severity: Optional[str] = None,
        evidence: Optional[Dict[str, Any]] = None,
    ) -> Any:
        payload: Dict[str, Any] = {
            "reporter": reporter,
            "subject": subject,
            "reason": reason,
        }
        if severity is not None:
            payload["severity"] = severity
        if evidence is not None:
            payload["evidence"] = evidence
        return self._request("abuse_report", payload)

    def _request(self, action: str, payload: Dict[str, Any]) -> Any:
        data = json.dumps(payload).encode("utf-8")
        url = f"{self.base_url.rstrip('/')}/v1/{action}"
        req = request.Request(url=url, method="POST", data=data)
        req.add_header("content-type", "application/json")
        req.add_header("x-request-id", str(uuid.uuid4()))
        for k, v in (self.headers or {}).items():
            req.add_header(k, v)
        try:
            with request.urlopen(req, timeout=self.timeout_s) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as e:
            try:
                body = json.loads(e.read().decode("utf-8"))
            except Exception:
                raise OrbitApiError("ORBIT_API_HTTP_ERROR", str(e), e.code) from e
            raise OrbitApiError(body.get("error", {}).get("code", "ORBIT_API_HTTP_ERROR"), body.get("error", {}).get("message", str(e)), e.code) from e
        except error.URLError as e:
            raise OrbitApiError("ORBIT_API_IO_ERROR", str(e)) from e
        except (TimeoutError, socket.timeout) as e:
            raise OrbitApiError("TIMEOUT", f"request timed out after {self.timeout_s}s") from e
        if not body.get("ok", False):
            err = body.get("error", {})
            raise OrbitApiError(err.get("code", "ORBIT_API_ERROR"), err.get("message", "request failed"))
        return body.get("payload")
