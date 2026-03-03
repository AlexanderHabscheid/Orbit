#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from typing import Any
from orbit_sdk import OrbitClient, OrbitApiError


def parse_json_input(value: str) -> Any:
    if value.startswith("@"):
        with open(value[1:], "r", encoding="utf-8") as f:
            return json.load(f)
    return json.loads(value)


def main() -> None:
    parser = argparse.ArgumentParser(prog="orbit-py")
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    parser.add_argument("--timeout-s", type=float, default=5.0)
    parser.add_argument("--token")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("ping")

    call = sub.add_parser("call")
    call.add_argument("target")
    call.add_argument("--json", required=True)
    call.add_argument("--timeout-ms", type=int)
    call.add_argument("--retries", type=int)
    call.add_argument("--run-id")
    call.add_argument("--pack-file")
    call.add_argument("--task-id")
    call.add_argument("--thread-id")
    call.add_argument("--parent-message-id")
    call.add_argument("--capabilities")
    call.add_argument("--traceparent")
    call.add_argument("--dedupe-key")

    pub = sub.add_parser("publish")
    pub.add_argument("topic")
    pub.add_argument("--json", required=True)
    pub.add_argument("--run-id")
    pub.add_argument("--pack-file")
    pub.add_argument("--durable", action="store_true")
    pub.add_argument("--dedupe-key")
    pub.add_argument("--task-id")
    pub.add_argument("--thread-id")
    pub.add_argument("--parent-message-id")
    pub.add_argument("--capabilities")
    pub.add_argument("--traceparent")

    ins = sub.add_parser("inspect")
    ins.add_argument("service")
    ins.add_argument("--timeout-ms", type=int)

    args = parser.parse_args()
    headers = {"authorization": f"Bearer {args.token}"} if args.token else None
    client = OrbitClient(base_url=args.base_url, timeout_s=args.timeout_s, headers=headers)
    try:
        if args.command == "ping":
            out = client.ping()
        elif args.command == "call":
            out = client.call(
                args.target,
                parse_json_input(args.json),
                timeout_ms=args.timeout_ms,
                retries=args.retries,
                run_id=args.run_id,
                pack_file=args.pack_file,
                task_id=args.task_id,
                thread_id=args.thread_id,
                parent_message_id=args.parent_message_id,
                capabilities=parse_json_input(args.capabilities) if args.capabilities else None,
                traceparent=args.traceparent,
                dedupe_key=args.dedupe_key,
            )
        elif args.command == "publish":
            out = client.publish(
                args.topic,
                parse_json_input(args.json),
                run_id=args.run_id,
                pack_file=args.pack_file,
                durable=True if args.durable else None,
                dedupe_key=args.dedupe_key,
                task_id=args.task_id,
                thread_id=args.thread_id,
                parent_message_id=args.parent_message_id,
                capabilities=parse_json_input(args.capabilities) if args.capabilities else None,
                traceparent=args.traceparent,
            )
        elif args.command == "inspect":
            out = client.inspect(args.service, timeout_ms=args.timeout_ms)
        else:
            raise ValueError(f"unknown command: {args.command}")
        print(json.dumps(out, indent=2))
    except OrbitApiError as e:
        print(json.dumps({"ok": False, "code": e.code, "message": str(e)}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
