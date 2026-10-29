#!/usr/bin/env bash
# ==============================================================================
# 宿主机 Stage-2 与 BAR WC 映射安全核验启动脚本 (100% 只读)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/check_host_bar_wc.py" "$@"
