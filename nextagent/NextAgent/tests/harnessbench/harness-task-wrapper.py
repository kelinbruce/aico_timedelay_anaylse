from __future__ import annotations

import json
import subprocess

from harnessbench.cli import main


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.TimeoutExpired:
        print(
            json.dumps(
                {
                    "ok": False,
                    "failurePhase": "harness_process",
                    "failureReasonCode": "PROCESS_TIMEOUT",
                }
            ),
            flush=True,
        )
        raise SystemExit(1)
