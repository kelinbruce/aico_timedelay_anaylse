"""
Agent DTB 透传代理 — 基于 qwen_transparent.py 扩展

新增能力（相对 qwen_transparent.py）：
1. 任务会话跟踪：按 n_messages 单调性自动识别 session 边界
2. 轮次分类：initial / tool_result / followup
3. DTB 参数注入：固定参数模式，启动时配置
4. Tool Calls 重建：从流式 delta 拼接重建为结构化对象
5. 人类可读交互记录：interaction_log.md
6. 结构化 session 输出：session_<id>.json + session_summary.jsonl
7. 请求 ID 生成：UUID 并记录到有界 full-log 分片

保留 token_usage.jsonl、chunks.jsonl 格式；完整日志升级为 schema 2 的
full_log/proxy_session_<id>/part-*.jsonl 分片布局。
"""

import json
import hashlib
import logging
import asyncio
import os
import re
import uuid
from datetime import datetime
from urllib.parse import urlparse, urlunparse
from dataclasses import dataclass, field, asdict
from typing import Optional
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
import httpx

try:
    from .full_log_writer import FullLogShardWriter
except ImportError:  # 支持从 proxy/ 目录直接执行本文件
    from full_log_writer import FullLogShardWriter

os.environ['NO_PROXY'] = 'api.openai.rnd.huawei.com'
os.environ['no_proxy'] = 'api.openai.rnd.huawei.com'


# ================= Tokenizer（延迟加载） =================
_tokenizer = None

def get_tokenizer():
    global _tokenizer
    if _tokenizer is None and os.path.exists(TOKENIZER_PATH):
        from transformers import AutoTokenizer
        _tokenizer = AutoTokenizer.from_pretrained(
            TOKENIZER_PATH, trust_remote_code=True
        )
        logger.info(f"Tokenizer loaded from {TOKENIZER_PATH}")
    return _tokenizer


def count_tokens(text: str) -> int:
    """计算字符串的 token 数量。"""
    if not text:
        return 0
    tokenizer = get_tokenizer()
    if tokenizer is not None:
        return len(tokenizer.encode(str(text), add_special_tokens=False))
    # fallback: 粗略估计中文 ~1.5 token/字符，英文 ~0.25 token/字符
    return 0


# ================= 配置区 =================
RESULTS_DIR = "results/qwen/local-task29/local-apiserver/dtb/run-04"

TARGET_BASE_URL = "http://10.44.160.79:9001"
LISTEN_PORT = 9000

# DTB 参数配置名称（用于日志标识，非功能用途）
DTB_CONFIG_NAME = "dtb"

# DTB 固定参数注入 — 修改此字典即可切换实验组
# Vanilla 基线：不注入任何 DTB 参数
# dtb_auto: {"model": "qwen3.6-27b", "enable_think_budget": True}
dtb_tight = {"model": "qwen3.6-27b", "enable_think_budget": True,
            "fixed_budget_tokens": 20000, "fixed_check_length": 500,
            "fixed_think_stride": 400, "fixed_num_thinking": 2,
            "fixed_min_think_tokens": 1, "fixed_prob_th": 0.93}
dtb_moderate = {"model": "qwen3.6-27b", "enable_think_budget": True,
               "fixed_budget_tokens": 20000, "fixed_check_length": 850,
               "fixed_think_stride": 500, "fixed_num_thinking": 5,
               "fixed_min_think_tokens": 1, "fixed_prob_th": 0.93}
# dtb_loose: {"model": "qwen3.6-27b", "enable_think_budget": True,
#             "fixed_budget_tokens": 1650, "fixed_check_length": 1000,
#             "fixed_think_stride": 250, "fixed_num_thinking": 3,
#             "fixed_min_think_tokens": 1000, "fixed_prob_th": 0.93}
# dtb_planning: {"model": "qwen3.6-27b", "enable_think_budget": True,
#                "fixed_budget_tokens": 3050, "fixed_check_length": 950,
#                "fixed_think_stride": 450, "fixed_num_thinking": 5,
#                "fixed_min_think_tokens": 950, "fixed_prob_th": 0.95}
# APPEND_BODY = {
#     "model": "qwen3.6-27b",
# }
APPEND_BODY = dtb_moderate
# 是否记录 chunks.jsonl（流式 chunk 粒度较大时可关闭以节省磁盘）
ENABLE_CHUNKS_LOG = True
# full-log 分片目标上限。单条记录不会被拆分；超限单条记录独占一个 part。
FULL_LOG_SHARD_MAX_BYTES = 16 * 1024 * 1024

# Tokenizer 路径（用于将 reasoning/content 字符长度转为 token 数）
# 当 API usage 中 reasoning_tokens 为 0 时，使用 tokenizer 本地计算
TOKENIZER_PATH = "/opt/w00618058/Qwen3.6-27B/"
# ==========================================

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger("agent_dtb_proxy")

app = FastAPI(title="Agent DTB Proxy Server")

timeout_config = httpx.Timeout(connect=30.0, read=None, write=30.0, pool=30.0)

EXCLUDED_REQ_HEADERS = {"host", "content-length", "connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"}
EXCLUDED_RESP_HEADERS = {"content-encoding", "content-length", "transfer-encoding", "connection"}

# ================= 日志文件路径 =================
os.makedirs(RESULTS_DIR, exist_ok=True)
TOKEN_RECORD_FILE = os.path.join(RESULTS_DIR, "token_usage.jsonl")
FULL_LOG_DIR = os.path.join(RESULTS_DIR, "full_log")
CHUNKS_LOG_FILE = os.path.join(RESULTS_DIR, "chunks.jsonl")
SESSION_SUMMARY_FILE = os.path.join(RESULTS_DIR, "session_summary.jsonl")
INTERACTION_LOG_FILE = os.path.join(RESULTS_DIR, "interaction_log.md")
full_log_writer = FullLogShardWriter(FULL_LOG_DIR, FULL_LOG_SHARD_MAX_BYTES)


# ================= 数据模型 =================
@dataclass
class Turn:
    turn_index: int = 0
    request_id: str = ""
    post_time: str = ""
    receive_time: str = ""
    e2e_ms: float = 0.0

    # 输入侧
    n_messages: int = 0
    n_tool_results: int = 0
    input_prompt_tokens: int = 0
    turn_type: str = "other"

    # DTB 参数
    injected_dtb_params: dict = field(default_factory=dict)

    # 输出侧
    output_completion_tokens: int = 0
    output_reasoning_tokens: int = 0
    output_tool_tokens: int = 0
    output_content_length: int = 0
    output_reasoning_length: int = 0
    has_tool_calls: bool = False
    stop_reason: str = ""

    # Token 计数（由 tokenizer 计算）
    reasoning_tokens_local: int = 0   # 本地 tokenizer 计算的 reasoning token 数
    content_tokens_local: int = 0     # 本地 tokenizer 计算的 content token 数

    # 思考比例
    thinking_ratio: float = 0.0

    # 流式累积（用于 interaction_log）
    accumulated_content: str = ""
    accumulated_reasoning: str = ""
    accumulated_tool_call_str: str = ""  # 原始拼接，用于 reconstruct_tool_calls

    # 工具返回输入（从 messages 中提取）
    tool_results_input: list = field(default_factory=list)

    def compute_thinking_ratio(self):
        """基于本地 tokenizer 的 token 数计算 thinking_ratio。"""
        if self.reasoning_tokens_local == 0 and self.accumulated_reasoning:
            self.reasoning_tokens_local = count_tokens(self.accumulated_reasoning)
        if self.content_tokens_local == 0 and self.accumulated_content:
            self.content_tokens_local = count_tokens(self.accumulated_content)
        total = self.reasoning_tokens_local + self.content_tokens_local
        if total > 0:
            self.thinking_ratio = self.reasoning_tokens_local / total
        else:
            self.thinking_ratio = 0.0


@dataclass
class Session:
    session_id: str = ""
    task_description: str = ""
    dtb_config_name: str = ""
    turns: list = field(default_factory=list)
    started_at: str = ""
    finished_at: str = ""
    last_n_messages: int = 0  # 用于 session 边界检测

    def add_turn(self, turn: Turn):
        self.turns.append(turn)
        self.last_n_messages = turn.n_messages
        if not self.started_at:
            self.started_at = turn.post_time
        self.finished_at = turn.receive_time


# ================= 会话管理器 =================
class SessionManager:
    """管理活跃 session，按 n_messages 单调性检测 session 边界。"""

    def __init__(self):
        self.active_session: Optional[Session] = None

    def process_request(self, messages: list, request_id: str, post_time: str) -> tuple[Session, Turn]:
        """处理一个新请求，返回 (目标 session, 新 turn)。

        如果检测到 session 边界，先关闭旧 session 并输出，再创建新 session。
        """
        n_messages = len(messages) if messages else 0
        n_tool_results = sum(1 for m in messages if m.get("role") == "tool") if messages else 0
        turn_type = classify_turn(messages)

        # 提取工具返回输入
        tool_results_input = []
        for m in messages:
            if m.get("role") == "tool":
                tool_results_input.append({
                    "tool_call_id": m.get("tool_call_id", ""),
                    "content": (m.get("content", "") or "")[:500],  # 截取前 500 字符避免日志过大
                })

        # Session 边界检测
        if self.active_session is not None and n_messages <= self.active_session.last_n_messages:
            # 新 session 开始，关闭旧 session
            self._finalize_session(self.active_session)
            self.active_session = None

        # 创建新 session（如果需要）
        if self.active_session is None:
            session_id = uuid.uuid4().hex[:12]
            task_desc = ""
            if messages:
                for m in messages:
                    if m.get("role") == "user" and m.get("content"):
                        content = m["content"]
                        if isinstance(content, list):
                            # 多模态消息：提取文本部分
                            text_parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
                            content = " ".join(text_parts)
                        if isinstance(content, str):
                            task_desc = content[:200]
                        break
            self.active_session = Session(
                session_id=session_id,
                task_description=task_desc,
                dtb_config_name=DTB_CONFIG_NAME,
            )
            logger.info(f"New session started: {session_id} (task: {task_desc[:60]}...)")

        turn_index = len(self.active_session.turns)
        turn = Turn(
            turn_index=turn_index,
            request_id=request_id,
            post_time=post_time,
            n_messages=n_messages,
            n_tool_results=n_tool_results,
            turn_type=turn_type,
            injected_dtb_params={k: v for k, v in APPEND_BODY.items() if k.startswith("fixed_") or k == "enable_think_budget"},
            tool_results_input=tool_results_input,
        )

        return self.active_session, turn

    def _finalize_session(self, session: Session):
        """Session 结束时输出所有产物。"""
        # 计算每轮 thinking_ratio
        for turn in session.turns:
            turn.compute_thinking_ratio()

        # 输出 session_<id>.json
        session_file = os.path.join(RESULTS_DIR, f"session_{session.session_id}.json")
        session_data = asdict(session)
        # 不在 session JSON 中保存原始 tool_call 拼接字符串
        for turn_data in session_data["turns"]:
            turn_data.pop("accumulated_tool_call_str", None)
            turn_data.pop("accumulated_content", None)
            turn_data.pop("accumulated_reasoning", None)
        save_json_sync(session_file, session_data)
        logger.info(f"Session {session.session_id} saved: {len(session.turns)} turns")

        # 输出 session_summary.jsonl
        summary = {
            "session_id": session.session_id,
            "dtb_config_name": session.dtb_config_name,
            "total_turns": len(session.turns),
            "total_e2e_ms": sum(t.e2e_ms for t in session.turns),
            "total_prompt_tokens": sum(t.input_prompt_tokens for t in session.turns),
            "total_completion_tokens": sum(t.output_completion_tokens for t in session.turns),
            "total_reasoning_tokens": sum(t.output_reasoning_tokens for t in session.turns),
            "total_reasoning_tokens_local": sum(t.reasoning_tokens_local for t in session.turns),
            "total_content_tokens_local": sum(t.content_tokens_local for t in session.turns),
            "total_tool_tokens": sum(t.output_tool_tokens for t in session.turns),
            "avg_thinking_ratio": (sum(t.thinking_ratio for t in session.turns) / len(session.turns)) if session.turns else 0,
            "tool_call_turns": sum(1 for t in session.turns if t.has_tool_calls),
            "tool_result_turns": sum(1 for t in session.turns if t.turn_type == "tool_result"),
            "started_at": session.started_at,
            "finished_at": session.finished_at,
        }
        append_jsonl_sync(SESSION_SUMMARY_FILE, summary)

        # 输出 interaction_log.md
        write_interaction_log(session)

    def finalize_all(self):
        """代理关闭时强制关闭所有活跃 session。"""
        if self.active_session is not None:
            logger.info(f"Finalizing active session {self.active_session.session_id} on shutdown")
            self._finalize_session(self.active_session)
            self.active_session = None


# 全局 session 管理器
session_manager = SessionManager()


# ================= 工具函数 =================
def classify_turn(messages: list) -> str:
    """判断当前请求的轮次类型。"""
    if not messages:
        return "other"
    if not any(m.get("role") == "tool" for m in messages):
        return "initial"
    if any(m.get("role") == "tool" for m in messages):
        return "tool_result"
    return "other"


_LIGHTCODE_BRANCH_RE = re.compile(r"(?m)^\s*-\s*branch:\s*([^\r\n]+?)\s*$")


def correlation_metadata(messages: list) -> dict:
    """Build a stable, non-invasive key for post-run LightCode correlation."""
    root_content = ""
    for message in messages or []:
        if message.get("role") != "user":
            continue
        content = message.get("content", "")
        if isinstance(content, str):
            root_content = content
        else:
            root_content = json.dumps(
                content,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
        break

    branch_match = _LIGHTCODE_BRANCH_RE.search(root_content)
    is_lightcode_main = (
        "code-production-evaluation" in root_content
        and "任务参数:" in root_content
        and branch_match is not None
    )
    return {
        "root_user_message_sha256": hashlib.sha256(
            root_content.encode("utf-8")
        ).hexdigest(),
        "root_user_message_preview": root_content[:240],
        "agent_role_hint": "main" if is_lightcode_main else "unknown",
        "case_branch_hint": branch_match.group(1).strip() if branch_match else "",
    }


def reconstruct_tool_calls(accumulated_str: str) -> list:
    """从流式 delta 拼接的 tool_calls 字符串重建结构化对象。

    输入格式: '[{"id":"call_...","function":{"name":"bash","arguments":""}}]'
              '[{"index":0,"function":{"arguments":"{"}}]'
              '[{"index":0,"function":{"arguments":"\"command\": ..."}}]'
              ...

    输出: [{"id": "call_...", "name": "bash",
            "arguments": {"command": "...", "timeout": 120000}}]
    """
    if not accumulated_str or not accumulated_str.strip():
        return []

    try:
        # 1. 在 ][ 边界插入逗号，外包数组，解析为 delta 列表
        fixed = accumulated_str.replace('][', '],[')
        raw_deltas = json.loads('[' + fixed + ']')

        # 每个 raw_delta 可能是 list（流式 delta.tool_calls 是数组），
        # 需要展平为单个 dict 列表
        deltas = []
        for rd in raw_deltas:
            if isinstance(rd, list):
                deltas.extend(rd)
            elif isinstance(rd, dict):
                deltas.append(rd)

        # 2. 按 index 分组合并
        tool_calls = {}
        for delta in deltas:
            idx = delta.get('index', 0)
            if idx not in tool_calls:
                tool_calls[idx] = {'id': '', 'name': '', 'arguments': ''}
            if delta.get('id'):
                tool_calls[idx]['id'] = delta['id']
            fn = delta.get('function', {})
            if fn.get('name'):
                tool_calls[idx]['name'] = fn['name']
            if fn.get('arguments'):
                tool_calls[idx]['arguments'] += fn['arguments']

        # 3. 尝试 JSON.parse 每个 arguments 字符串
        for tc in tool_calls.values():
            try:
                tc['arguments'] = json.loads(tc['arguments'])
            except json.JSONDecodeError:
                pass  # 保留原始字符串

        return [tc for _, tc in sorted(tool_calls.items())]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning(f"Failed to reconstruct tool_calls: {e}, raw: {accumulated_str[:200]}")
        return []


def save_json_sync(filepath: str, data):
    """同步保存 JSON 文件。"""
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.error(f"保存 JSON 文件失败 ({filepath}): {e}")


def append_jsonl_sync(filepath: str, record):
    """同步追加一行 JSONL。"""
    try:
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:
        logging.error(f"保存 JSONL 记录失败 ({filepath}): {e}")


def format_duration(ms: float) -> str:
    """将毫秒格式化为人类可读的时间字符串。"""
    if ms < 1000:
        return f"{ms:.0f}ms"
    seconds = ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}m {secs:.0f}s"


def format_tool_calls_md(tool_calls: list) -> str:
    """将重建的 tool_calls 格式化为 Markdown 列表。"""
    if not tool_calls:
        return ""
    lines = []
    for i, tc in enumerate(tool_calls, 1):
        name = tc.get("name", "unknown")
        args = tc.get("arguments", {})
        if isinstance(args, dict):
            args_str = json.dumps(args, ensure_ascii=False)
        else:
            args_str = str(args)
        # 截断过长的参数
        if len(args_str) > 500:
            args_str = args_str[:500] + "..."
        lines.append(f"{i}. **{name}**({args_str})")
    return "\n".join(lines)


def write_interaction_log(session: Session):
    """输出人类可读的交互记录 Markdown 文件。"""
    try:
        lines = []
        lines.append(f"# Session {session.session_id}")
        lines.append("")
        lines.append(f"- DTB Config: {session.dtb_config_name}")

        total_e2e = sum(t.e2e_ms for t in session.turns)
        lines.append(f"- Duration: {format_duration(total_e2e)}")
        lines.append(f"- Turns: {len(session.turns)}")

        if session.task_description:
            lines.append(f"- Task: {session.task_description}")

        lines.append("")
        lines.append("---")
        lines.append("")

        for turn in session.turns:
            # Turn header
            time_str = turn.post_time[11:19] if len(turn.post_time) > 19 else turn.post_time
            e2e_str = format_duration(turn.e2e_ms)
            header = (f"## Turn {turn.turn_index} | {time_str} | "
                      f"e2e={e2e_str} | type={turn.turn_type} | "
                      f"prompt={turn.input_prompt_tokens} tokens")
            lines.append(header)
            lines.append("")

            # Tool Result 输入（仅 tool_result 类型显示）
            if turn.turn_type == "tool_result" and turn.tool_results_input:
                lines.append("### Tool Results (input)")
                for tr in turn.tool_results_input:
                    content_preview = tr.get("content", "")
                    if len(content_preview) > 300:
                        content_preview = content_preview[:300] + "..."
                    lines.append(f"- `{tr.get('tool_call_id', '?')}`: {content_preview}")
                lines.append("")

            # Reasoning
            reasoning = turn.accumulated_reasoning.strip()
            lines.append(f"### Reasoning ({turn.reasoning_tokens_local} tokens)")
            if reasoning:
                lines.append(reasoning)
            else:
                lines.append("(empty)")
            lines.append("")

            # Content
            content = turn.accumulated_content.strip()
            lines.append(f"### Content ({turn.content_tokens_local} tokens)")
            if content:
                lines.append(content)
            else:
                lines.append("(empty)")
            lines.append("")

            # Tool Calls
            tool_calls = reconstruct_tool_calls(turn.accumulated_tool_call_str)
            if tool_calls:
                lines.append("### Tool Calls")
                lines.append(format_tool_calls_md(tool_calls))
                lines.append("")

            lines.append("---")
            lines.append("")

        # 追加到 interaction_log.md（多次 session 共存同一文件）
        with open(INTERACTION_LOG_FILE, "a", encoding="utf-8") as f:
            f.write("\n".join(lines))

        logger.info(f"Interaction log appended: {INTERACTION_LOG_FILE}")

    except Exception as e:
        logging.error(f"写入交互记录失败: {e}")


# ================= URL 智能拼接 =================
def build_upstream_url(base_url: str, request_path: str) -> str:
    parsed_base = urlparse(base_url)
    base_path = parsed_base.path.rstrip('/')
    req_path = '/' + request_path.lstrip('/')

    if base_path and req_path.startswith(base_path):
        req_path = req_path[len(base_path):]
        if not req_path.startswith('/'):
            req_path = '/' + req_path

    final_path = base_path + req_path
    return urlunparse((parsed_base.scheme, parsed_base.netloc, final_path, '', '', ''))


# ================= 日志保存 (Token) — 沿用原有格式 =================
def save_token_record_sync(post_time, receive_time, usage, model_name):
    reasoning_token = usage.get("reasoning_tokens", 0) or usage.get("reasoning_token", 0)
    tool_token = usage.get("tool_tokens", 0) or usage.get("tool_token", 0)

    record = {
        "post_time": post_time,
        "recive_time": receive_time,
        "model_name": model_name,
        "intput_token": usage.get("prompt_tokens", 0),
        "output_token": usage.get("completion_tokens", 0),
        "reasoning_token": reasoning_token,
        "tool_token": tool_token,
        "usage": usage
    }
    append_jsonl_sync(TOKEN_RECORD_FILE, record)


async def async_save_token_record(post_time, usage, model_name):
    receive_time = datetime.now().isoformat()
    await asyncio.to_thread(save_token_record_sync, post_time, receive_time, usage, model_name)


def full_log_metrics(turn: Turn, usage: dict) -> dict:
    """Keep task-level analysis independent of session finalization."""
    return {
        "e2e_ms": turn.e2e_ms,
        "prompt_tokens": turn.input_prompt_tokens,
        "completion_tokens": turn.output_completion_tokens,
        "reasoning_tokens": turn.output_reasoning_tokens,
        "tool_tokens": turn.output_tool_tokens,
        "reasoning_tokens_local": turn.reasoning_tokens_local,
        "content_tokens_local": turn.content_tokens_local,
        "has_tool_calls": turn.has_tool_calls,
        "stop_reason": turn.stop_reason,
        "usage": usage,
    }


# ===== 日志保存 (完整 Request/Response) — proxy session 有界分片 =====
def save_full_log_sync(timestamp, request_body, response_content, response_reasoning=None,
                       response_tool_calls=None, request_id="", proxy_session_id="",
                       proxy_turn_index=0, completed_at="", metrics=None):
    record = {
        "schema": 2,
        "timestamp": timestamp,
        "completed_at": completed_at,
        "request_id": request_id,
        "proxy_session_id": proxy_session_id,
        "proxy_turn_index": proxy_turn_index,
        "correlation": correlation_metadata(request_body.get("messages", [])),
        "request_body": request_body,
        "response_data": {
            "content": response_content,
            "reasoning": response_reasoning,
            "tool_calls": response_tool_calls
        },
        "metrics": metrics or {},
    }
    try:
        result = full_log_writer.append(record)
        if result.oversized:
            logger.warning(
                "Full-log record %s exceeds shard target (%d > %d bytes) and was "
                "stored alone in %s",
                request_id,
                result.byte_length,
                FULL_LOG_SHARD_MAX_BYTES,
                result.path,
            )
    except Exception as e:
        logging.error(f"保存 full-log 分片失败 ({request_id}): {e}")


async def async_save_full_log(timestamp, request_body, response_content, response_reasoning=None,
                              response_tool_calls=None, request_id="",
                              proxy_session_id="", proxy_turn_index=0,
                              completed_at="", metrics=None):
    await asyncio.to_thread(save_full_log_sync, timestamp, request_body, response_content,
                            response_reasoning, response_tool_calls, request_id,
                            proxy_session_id, proxy_turn_index, completed_at,
                            metrics)


# ================= 日志保存 (流式 Chunk) — 沿用原有格式 =================
def save_chunk_sync(timestamp, chunk):
    if not ENABLE_CHUNKS_LOG:
        return
    record = {
        "timestamp": timestamp,
        "chunk": chunk
    }
    append_jsonl_sync(CHUNKS_LOG_FILE, record)


async def async_save_chunk(timestamp, chunk):
    await asyncio.to_thread(save_chunk_sync, timestamp, chunk)


# ================= 路由与透传 =================
@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy_request(request: Request, path: str):
    post_time = datetime.now().isoformat()
    request_id = uuid.uuid4().hex[:16]
    body = await request.body()

    # 安全解析请求体
    request_body_to_log = {}
    try:
        if body:
            request_body_to_log = json.loads(body)
    except json.JSONDecodeError:
        request_body_to_log = {"raw_text": body.decode('utf-8', errors='ignore')[:500]}

    # 判断是否为 chat completion 请求（含 messages 字段）
    # 非 chat 请求（/metrics, /v1/models 等）纯透传，不参与 session 跟踪和日志记录
    is_chat_request = "messages" in request_body_to_log

    model_name = request_body_to_log.get("model", "")
    is_stream = request_body_to_log.get("stream", False)
    messages = request_body_to_log.get("messages", [])

    # Session 跟踪：仅对 chat 请求处理
    session = None
    turn = None
    if is_chat_request:
        session, turn = session_manager.process_request(messages, request_id, post_time)

    upstream_url = build_upstream_url(TARGET_BASE_URL, path)
    forward_headers = {k: v for k, v in request.headers.items() if k.lower() not in EXCLUDED_REQ_HEADERS}

    # 非 chat 请求：直接透传，不注入 APPEND_BODY，不做日志记录
    if not is_chat_request:
        client = httpx.AsyncClient(timeout=timeout_config)
        try:
            resp = await client.request(
                method=request.method, url=upstream_url, headers=forward_headers,
                params=request.query_params, content=body
            )
            resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in EXCLUDED_RESP_HEADERS}
            return Response(content=resp.content, status_code=resp.status_code, headers=resp_headers)
        finally:
            await client.aclose()

    if is_stream and "stream_options" not in request_body_to_log:
        request_body_to_log["stream_options"] = {"include_usage": True}

    # 将 APPEND_BODY 合并进请求体字典，再序列化为 bytes
    request_body_to_log = {**request_body_to_log, **APPEND_BODY}
    body = json.dumps(request_body_to_log).encode('utf-8')

    # 使用独立的 AsyncClient 实例
    client = httpx.AsyncClient(timeout=timeout_config)
    stream_ctx = client.stream(
        method=request.method, url=upstream_url, headers=forward_headers,
        params=request.query_params, content=body
    )
    upstream_resp_obj = await stream_ctx.__aenter__()

    resp_headers = {k: v for k, v in upstream_resp_obj.headers.items()
                    if k.lower() not in EXCLUDED_RESP_HEADERS}

    if is_stream and "text/event-stream" in upstream_resp_obj.headers.get("content-type", ""):
        return await handle_stream_response(upstream_resp_obj, client, stream_ctx, resp_headers,
                                            model_name, post_time, request_body_to_log,
                                            request_id, session, turn)
    else:
        try:
            content = await upstream_resp_obj.aread()
            status_code = upstream_resp_obj.status_code
        finally:
            await stream_ctx.__aexit__(None, None, None)
            await client.aclose()
        return await handle_normal_response(content, status_code, resp_headers, model_name,
                                            post_time, request_body_to_log, request_id,
                                            session, turn)


# ================= 非流式响应处理 =================
async def handle_normal_response(content: bytes, status_code: int, resp_headers, model_name,
                                 post_time, request_body, request_id, session: Session, turn: Turn):
    usage = {}
    response_content = ""
    response_reasoning = None
    response_tool_calls = None
    try:
        resp_json = json.loads(content)
        usage = resp_json.get("usage", {})
        choices = resp_json.get("choices", [])
        if choices:
            msg = choices[0].get("message", {})
            response_content = msg.get("content", "") or ""
            response_reasoning = msg.get("reasoning", "") or ""
            response_tool_calls = msg.get("tool_calls", "")
            stop_reason = choices[0].get("finish_reason", "")
            turn.stop_reason = stop_reason
            turn.has_tool_calls = bool(response_tool_calls)
    except json.JSONDecodeError:
        response_content = content.decode('utf-8', errors='ignore')

    # 更新 turn 数据
    receive_time = datetime.now().isoformat()
    turn.receive_time = receive_time
    post_dt = datetime.fromisoformat(post_time)
    receive_dt = datetime.fromisoformat(receive_time)
    turn.e2e_ms = (receive_dt - post_dt).total_seconds() * 1000
    turn.output_completion_tokens = usage.get("completion_tokens", 0)
    turn.output_reasoning_tokens = usage.get("reasoning_tokens", 0) or usage.get("reasoning_token", 0)
    turn.output_tool_tokens = usage.get("tool_tokens", 0) or usage.get("tool_token", 0)
    turn.input_prompt_tokens = usage.get("prompt_tokens", 0)
    turn.output_content_length = len(response_content)
    turn.output_reasoning_length = len(response_reasoning) if response_reasoning else 0
    turn.accumulated_content = response_content
    turn.accumulated_reasoning = response_reasoning or ""
    turn.accumulated_tool_call_str = json.dumps(response_tool_calls) if response_tool_calls else ""
    turn.compute_thinking_ratio()

    session.add_turn(turn)

    await async_save_full_log(post_time, request_body, response_content, response_reasoning,
                              response_tool_calls, request_id, session.session_id,
                              turn.turn_index, turn.receive_time,
                              full_log_metrics(turn, usage))
    await async_save_token_record(post_time, usage, model_name)

    return Response(content=content, status_code=status_code, headers=resp_headers)


# ================= 流式响应处理 =================
async def handle_stream_response(upstream_resp, client, stream_ctx, resp_headers, model_name,
                                 post_time, request_body, request_id, session: Session, turn: Turn):
    usage = {}
    accumulated_content = ""
    accumulated_reasoning = ""
    accumulated_tool_call = ""
    stop_reason = ""
    has_tool_calls = False

    async def stream_generator():
        nonlocal usage, accumulated_content, accumulated_reasoning, accumulated_tool_call
        nonlocal stop_reason, has_tool_calls

        # 流开始时写入分隔标记行
        await async_save_chunk(post_time, {"separator": True})

        stream_error = None
        try:
            async for chunk in upstream_resp.aiter_lines():
                yield f"{chunk}\n".encode('utf-8')

                if chunk.startswith("data: "):
                    data_str = chunk[6:].strip()
                    if data_str == "[DONE]":
                        continue
                    try:
                        data_json = json.loads(data_str)
                        # 保存每个流式 chunk
                        await async_save_chunk(post_time, data_json)

                        # 累积流式输出的 content
                        choices = data_json.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            if delta.get("content"):
                                accumulated_content += delta["content"]
                            if delta.get("reasoning"):
                                accumulated_reasoning += delta["reasoning"]
                            if delta.get("tool_calls"):
                                accumulated_tool_call += json.dumps(delta["tool_calls"], ensure_ascii=False)

                            # 提取 finish_reason
                            fr = choices[0].get("finish_reason")
                            if fr:
                                stop_reason = fr

                        # 提取 usage (通常在最后一个 chunk)
                        if "usage" in data_json and data_json["usage"]:
                            usage = data_json["usage"]
                    except json.JSONDecodeError:
                        continue
        except httpx.ReadTimeout:
            stream_error = "ReadTimeout"
            logger.warning(f"Stream ReadTimeout for request {request_id}, saving accumulated data "
                           f"(reasoning={len(accumulated_reasoning)}c, content={len(accumulated_content)}c)")
        except httpx.ConnectTimeout:
            stream_error = "ConnectTimeout"
            logger.warning(f"Stream ConnectTimeout for request {request_id}")
        except Exception as e:
            stream_error = type(e).__name__
            logger.warning(f"Stream error for request {request_id}: {e}")
        finally:
            try:
                await stream_ctx.__aexit__(None, None, None)
            except Exception:
                pass
            await client.aclose()

        # 流结束后，更新 turn 数据
        has_tool_calls = bool(accumulated_tool_call)

        receive_time = datetime.now().isoformat()
        if stream_error:
            stop_reason = stop_reason or f"error:{stream_error}"
        turn.receive_time = receive_time
        post_dt = datetime.fromisoformat(post_time)
        receive_dt = datetime.fromisoformat(receive_time)
        turn.e2e_ms = (receive_dt - post_dt).total_seconds() * 1000
        turn.output_completion_tokens = usage.get("completion_tokens", 0)
        turn.output_reasoning_tokens = usage.get("reasoning_tokens", 0) or usage.get("reasoning_token", 0)
        turn.output_tool_tokens = usage.get("tool_tokens", 0) or usage.get("tool_token", 0)
        turn.input_prompt_tokens = usage.get("prompt_tokens", 0)
        turn.output_content_length = len(accumulated_content)
        turn.output_reasoning_length = len(accumulated_reasoning)
        turn.has_tool_calls = has_tool_calls
        turn.stop_reason = stop_reason
        turn.accumulated_content = accumulated_content
        turn.accumulated_reasoning = accumulated_reasoning
        turn.accumulated_tool_call_str = accumulated_tool_call
        turn.compute_thinking_ratio()

        session.add_turn(turn)

        # 保存日志
        await async_save_full_log(post_time, request_body, accumulated_content,
                                  accumulated_reasoning, accumulated_tool_call, request_id,
                                  session.session_id, turn.turn_index,
                                  turn.receive_time, full_log_metrics(turn, usage))
        await async_save_token_record(post_time, usage, model_name)

    return StreamingResponse(stream_generator(), status_code=upstream_resp.status_code, headers=resp_headers)


# ================= 启动与关闭事件 =================
@app.on_event("shutdown")
async def shutdown_event():
    """代理关闭时强制关闭所有活跃 session。"""
    session_manager.finalize_all()


if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting Agent DTB Proxy on port {LISTEN_PORT}")
    logger.info(f"Target: {TARGET_BASE_URL}")
    logger.info(f"Results dir: {RESULTS_DIR}")
    logger.info(
        f"Full-log shards: {FULL_LOG_DIR} "
        f"(target <= {FULL_LOG_SHARD_MAX_BYTES} bytes each)"
    )
    logger.info(f"DTB config: {DTB_CONFIG_NAME}")
    logger.info(f"APPEND_BODY: {json.dumps(APPEND_BODY, ensure_ascii=False)}")
    uvicorn.run(app, host="0.0.0.0", port=LISTEN_PORT)
