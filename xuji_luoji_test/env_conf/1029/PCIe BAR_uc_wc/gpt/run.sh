#!/usr/bin/env bash
set -euo pipefail

BAR_WC_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${BAR_WC_SCRIPT_DIR}/check_host_bar_wc.py" "$@"
