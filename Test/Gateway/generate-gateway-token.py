#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import time


def b64url_nopad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def make_token(private_key: str, route: str, exp: int) -> str:
    payload = {"exp": int(exp), "route": route}
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload_b64 = b64url_nopad(payload_json)

    mac = hmac.new(private_key.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256)
    sig_b64 = b64url_nopad(mac.digest())
    return f"{payload_b64}.{sig_b64}"


def main() -> int:
    p = argparse.ArgumentParser(description="Generate a ChallengeGateway token (payloadB64.signatureB64).")
    p.add_argument("--private-key", required=True)
    p.add_argument("--route", required=True)
    p.add_argument("--expires-in-seconds", type=int, default=3600)
    p.add_argument("--expired", action="store_true")
    p.add_argument("--count", type=int, default=1, help="Generate N distinct tokens by varying exp.")
    p.add_argument("--format", choices=["lines", "csv"], default="lines")
    args = p.parse_args()

    now = int(time.time())
    base_exp = now + int(args.expires_in_seconds)
    if args.expired:
        base_exp = now - abs(int(args.expires_in_seconds))

    count = max(1, int(args.count))
    tokens = [make_token(args.private_key, args.route, base_exp + i) for i in range(count)]

    if args.format == "csv":
        print(",".join(tokens))
    else:
        for t in tokens:
            print(t)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
