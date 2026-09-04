from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 4:
        raise RuntimeError("usage: model-preflight.py <upstream-root> <provider-url> <model-id>")
    upstream_root = Path(sys.argv[1]).resolve()
    provider_url = sys.argv[2].rstrip("/")
    model_id = sys.argv[3]
    sys.path.insert(0, str(upstream_root / "src"))
    from harnessbench.usage_proxy import UsageProxy, register_routes

    with tempfile.TemporaryDirectory(prefix="nextagent-harnessbench-preflight-") as directory:
        root = Path(directory)
        routes = root / "routes.json"
        register_routes(routes, {
            "/nextagent/model": {
                "upstream": provider_url,
                "framework": "nextagent",
                "provider": "openai-compatible",
            }
        })
        with UsageProxy(routes, root / "requests.jsonl", root / "responses", "preflight", "preflight", model_id) as proxy:
            print(json.dumps({"proxyBaseUrl": proxy.base_url}), flush=True)
            sys.stdin.readline()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"model preflight failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1)
