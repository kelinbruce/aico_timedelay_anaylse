# ==============================
# 1. 参数配置
# ==============================

export VA_PORT=8901
export RECORDER_PORT=8931

export RECORDER_SCRIPT=/dpc/hot/z00927893/7_workflow_timedelay/vllm_request_recorder.py
export RECORDER_LOG_DIR=/dpc/hot/z00927893/7_workflow_timedelay/18_env/204_test

mkdir -p "$RECORDER_LOG_DIR"

export RECORDER_LOG_FILE="$RECORDER_LOG_DIR/vllm_requests_$(date +%Y%m%d_%H%M%S).jsonl"

echo "vLLM 原服务地址 : http://127.0.0.1:${VA_PORT}"
echo "记录代理地址    : http://0.0.0.0:${RECORDER_PORT}"
echo "请求记录文件    : ${RECORDER_LOG_FILE}"

# ==============================
# 2. 检查原 vLLM 服务
# ==============================

echo
echo "===== 检查 vLLM 服务 ====="

curl -sf "http://127.0.0.1:${VA_PORT}/v1/models" \
  && echo \
  && echo "vLLM 服务检查通过" \
  || {
    echo "ERROR: 无法访问 http://127.0.0.1:${VA_PORT}"
    exit 1
  }

# ==============================
# 3. 检查 Python 依赖
# ==============================

echo
echo "===== 检查 Python 依赖 ====="

python3 -c '
import fastapi
import httpx
import uvicorn
print("依赖检查通过")
' || exit 1

# ==============================
# 4. 前台启动记录代理
# Ctrl+C 直接停止
# ==============================

echo
echo "===== 启动请求记录代理 ====="
echo "后续请求请发送到:"
echo "http://141.73.1.204:${RECORDER_PORT}/v1/chat/completions"
echo

PYTHONUNBUFFERED=1 python3 "$RECORDER_SCRIPT" \
  --upstream "http://127.0.0.1:${VA_PORT}" \
  --listen-host "0.0.0.0" \
  --listen-port "${RECORDER_PORT}" \
  --log-file "${RECORDER_LOG_FILE}" \