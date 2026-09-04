## 背景与问题（Why）

vuln_agent 安全扫描在 `.vuln_agent_output/` 下产生 25 条 VULN 前缀发现。经逐条对照当前源码验证，其中 7 条为真实漏洞（本次已修复），4 条为误报（引用的代码已过期，当前已有防护），4 条为本地开发信任模式的设计预期行为，其余为需后续架构设计的资源管理类发现。本 change 记录 7 条真实漏洞的安全边界修复，涉及五类攻击面：

1. **P0 路径穿越 — locale 参数注入**：locale 查询/请求体参数只有 `minLength`/`maxLength` 约束，无 `pattern`。恶意 locale（如 `/../../secret`）经 `path.join(resourceDir, 'category-question-${locale}.jsonl')` 解析后可读取 resource 目录外文件。影响 web 通道 6 处 locale 入口和 task 通道 2 处 locale 入口。
2. **P0 limit DoS**：session list 非搜索路径、conversation 路径的 `limit` 参数缺少上限校验；favorites `limit` 检查 `limit > 100` 但不拒绝负数，`limit=-1` 经 SQLite `LIMIT -1` 等价于无限制。攻击者可发送极大或负数 limit 触发无界查询。
3. **P1 SSE 订阅者泄漏**：`deliverWebStream` 的 `finally` 块只调用 `runtimeAbortController.abort()`，不调用 `iterator.return?.()`。当 generator 停在 `yield` 时其内部 `finally`（调用 `removeStreamSubscriber`）不执行，subscriber 永久留在 Map 中，`publishTimelineEvent` 持续向其 queue push 事件导致内存无限增长。
4. **P1 WebSocket 帧大小无限制 + pong 无背压**：WebSocket 帧解析 64 位长度路径只检查 `> 2^53-1`（9 PB），16 位路径允许 65535 字节，无实际帧大小上限；控制帧无 RFC 6455 的 125 字节限制；`sendWebSocketPong` 丢弃 `writeWebSocketFrame` 返回的背压信号。
5. **P1 SkillHub 下载无完整性校验**：`fetchContent` 解码 base64 下载字节并读取 `packageHash`，但不计算下载字节的哈希进行比对。MITM 或被入侵的 SKILL_HUB 服务器可投递与声明 hash 不匹配的恶意 skill 包。

## 变更范围（What Changes）

### locale 参数安全模式

- `agent-channel-web/src/schemas/validation-limits.ts` 新增 `WEB_LOCALE_PATTERN = "^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$"` 常量。
- 所有 locale 输入 schema 添加 `pattern: WEB_LOCALE_PATTERN`（同形同策，覆盖 web 通道和 task 通道全部 locale 入口）：`category-question-query.ts`、`frequent-question-query.ts`、`question-association-query.ts`、`request-dto.ts`（submitBody、convenienceSubmitBody、editLatestBody）、`session-dto.ts`（createSessionBody）、`agent-channel-task/src/routes.ts`（createTaskBody、editTaskBody，使用等价 `TASK_LOCALE_PATTERN` 常量）。
- `agent-session/src/services/category-question-catalog.ts` 的 `normalizeLocale` 添加深度防御：locale 包含 `/`、`\` 或 `..` 时直接返回 fallback 语言。

### limit DoS 上限

- `agent-channel-web/src/routes/requests.ts` 新增 `SESSION_LIST_MAX_LIMIT = 200` 和 `MAX_CONVERSATION_LIMIT = 500` 固定常量。
- session list 非搜索路径添加 `limit > SESSION_LIST_MAX_LIMIT` 校验；conversation 路径添加 `limit > MAX_CONVERSATION_LIMIT` 校验。
- favorites 路径修复负数绕过：`limit > 100` 改为 `limit < 1 || limit > 100`。

### SSE 订阅者清理

- `agent-channel-common/src/transports/web-stream-delivery.ts` 将 `iterator` 声明提升到 `try` 块之前，`finally` 块添加 `void iterator?.return?.()`，确保 generator 的内部 `finally`（`removeStreamSubscriber`）在 disconnect/abort/normal completion 时执行。

### WebSocket 帧大小限制与 pong 背压

- `agent-channel-task/src/websocket.ts` 新增 `maxWebSocketFramePayloadBytes = 1 MiB` 和 `maxWebSocketControlFramePayloadBytes = 125` 固定常量。
- `consumeClientFrames` 在解析 `payloadLength` 后检查帧大小，超限关闭连接（1009 Message Too Big）；控制帧 payload 超过 125 字节关闭连接（1002 Protocol Error）。
- `sendWebSocketPong` 返回 `boolean` 背压信号，pong 写入失败时关闭连接（1011 Internal Error）。

### SkillHub 下载完整性校验

- `agent-platform-gateway-remote/src/skillhub-http-v1-gateway.ts` 在下载后、解压前用 `createHash("sha256").update(packageBytes).digest("hex")` 与声明的 `packageHash` 比对，不匹配返回 `{ status: "failed", reasonCode: "invalid-response" }`。

## Capability 影响（Capabilities）

### 新增 Capability

- `web-channel-input-security`：跨 web/task 通道的 locale 参数安全模式和列表查询 limit DoS 上限约束。

### 修改的 Capability

- `ts-web-sse-ws-transports`：新增 SSE 流交付订阅者清理和 WebSocket 帧大小限制行为契约。
- `skillhub-source`：新增 SkillHub 远程下载包完整性校验行为契约。

## 影响范围（Impact）

- 代码：`agent-channel-web`（schema pattern + limit 上限）、`agent-channel-task`（locale pattern + WebSocket 帧限制）、`agent-channel-common`（SSE 订阅者清理）、`agent-platform-gateway-remote`（下载完整性校验）、`agent-session`（normalizeLocale 深度防御）。
- API：locale 参数新增 `pattern` 约束，非法 locale 返回 400 校验错误；session list / conversation / favorites `limit` 新增上限校验；无 schema 字段增删。
- 测试：`agent-platform-gateway-remote` SkillHub 下载完整性校验测试已更新为提供真实 SHA-256 hash。
- 配置/运维：无新增配置；所有上限和 pattern 为固定常量，不可由客户端覆盖。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/web-channel-input-security/spec.md`：新增 capability，合并 locale 参数安全模式和 limit DoS 上限 requirement。
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并 SSE 订阅者清理和 WebSocket 帧大小限制 requirement。
- `openspec/specs/skillhub-source/spec.md`：合并下载完整性校验 requirement。

**长期背景：**
- `openspec/overview.md`：在安全边界描述中补充 channel input 安全加固一句。

**设计视图：**
- `openspec/designs/modules/agent-channel-web.md`：补充 locale pattern 常量和 limit 上限常量。
- `openspec/designs/modules/agent-channel-task.md`：补充 WebSocket 帧大小限制常量。
- `openspec/designs/modules/agent-channel-common.md`：补充 SSE 订阅者清理语义。
- `openspec/designs/modules/agent-platform-gateway-remote.md`：补充下载完整性校验语义。
- `openspec/designs/spec-to-design-map.md`：新增 `web-channel-input-security` 导航条目。

**验证入口：**
- `agent-channel-web` schema 校验测试：locale pattern 拒绝路径穿越输入、limit 上限拒绝超限请求。
- `agent-channel-task` WebSocket 测试：帧大小超限关闭连接、控制帧超限关闭连接、pong 背压处理。
- `agent-channel-common` 流交付测试：disconnect/abort 时 iterator.return() 被调用。
- `agent-platform-gateway-remote` SkillHub 测试：hash 不匹配时返回失败。