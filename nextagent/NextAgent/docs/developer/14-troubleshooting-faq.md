# 常见问题排查

这一篇收集 NextAgent 开发中常踩的坑和解决办法。默认端口 3000；开发者配置入口是 YAML `application.yaml`，它覆盖框架内置 `default-system.yaml`。

## 启动与配置

### Q: 后端启动后 Agent 未加载

**检查步骤**：

1. 确认 `default-system.yaml` 中 `hostedAgent.activeAgentId` 与 `agent.yaml` 的 `agentId` 一致。
2. 确认 Agent package 文件存在且 JSON/YAML 解析无误。
3. 查看启动日志中 AgentAssembly 编译输出（`logs/` 下的 `nextagent-operational.log.<sequence>.jsonl` 系列，滚动分片）。
4. 检查 `agent.yaml` 的 `modelIds` 是否引用 system config 中存在的 canonical `modelId`；省略 `modelIds` 时确认系统至少有一个已校验模型。

### Q: 启动报告 "App configuration is blocked before ready"

**原因**：配置校验失败。常见根因是 `credentialRef` 写入明文 key，或必填配置缺失。

**解决**：

```jsonc
// default-system.yaml — credentialRef 必须用 env: 或 file: 引用
"credentialRef": "env:OPENAI_API_KEY"     // 推荐
"credentialRef": "file:config/api-key.txt" // 推荐
// 明文 key 会触发此错误
```

确认环境变量已设置：`echo $OPENAI_API_KEY`（Bash）或 `echo $env:OPENAI_API_KEY`（PowerShell）。

### Q: 启动报告没有可用模型

**原因**：`modelProfiles[].models[]` 为空、模型配置未通过校验，或当前 Agent 的 `modelIds` 没有引用有效 canonical model ID。

**解决**：在开发者 `application.yaml` 中配置至少一个合法模型，确保 provider access 的 `credentialRef` 可解析，并检查 Agent `modelIds/defaultModelId`。

### Q: 模型调用返回 401/403

**原因**：API Key 未配置或 `credentialRef` 格式错误。

**检查**：

- 环境变量是否已设置。
- `credentialRef` 格式是否正确：`env:VAR_NAME` / `file:/absolute/path`（不支持 `direct:` 形式，配置校验会拒绝）。
- `baseUrl` 是否指向正确的 provider 端点。

### Q: 模型响应中途被切断 / 请求超时

**高频原因**：模型 `timeoutMs` 省略时默认只有 **30 秒**（`maxRetries` 默认 2）。长推理模型（尤其开启 thinking 的）30 秒内经常无法完成首轮输出。

**解决**：在 `application.yaml` 的 `modelProfiles[].models[]` 为该模型显式配置足够大的 `timeoutMs`（如 300000），再按需调整 `maxRetries`。注意这与 Agent 级 `runtimeSettings.requestTimeoutMs`（请求整体超时，内置 Agent 为 30 分钟）是两层不同超时。默认值清单见[部署说明](./12-deployment.md)的"推理字段与超时的代码默认值"。

### Q: 端口 3000 被占用

**解决**：调整 `default-system.yaml` 的 `channel.port`，或释放占用进程。NextAgent 默认端口是 3000，不是 8080。

```bash
# 查看占用
# Windows: netstat -ano | findstr :3000
# Linux:   lsof -i :3000
```

## 认证

### Q: 启用 localAuth 后接口返回 401

**原因**：`auth.localAuth.enabled = true` 时需本地登录态 Cookie。

**解决**：

1. 先调用本地登录接口获取 Cookie（`ts-local-configured-auth` spec）。
2. 后续请求携带该 Cookie。
3. Cookie 失效需重新登录。

## 能力开发

### Q: Skill 未被模型调用

**可能原因与解决**：

1. **未绑定**：检查 `agent.yaml` 的 `capabilityBindings` 是否包含该 Skill。
2. **未加载**：检查 capability source（builtin / local / skillhub / agent-owned）是否正确加载。
3. **描述不清**：`SKILL.md` 的 `description` 与 `when_to_use` 需足够清晰，明确触发条件。
4. **工具限制**：`allowed-tools` 中的工具需在 `capabilityBindings` 中绑定。
5. **routing 约束**：检查 routing constraint validation 是否排除了该 Skill。

**诊断**：查看 Context Engine 日志，确认 Skill descriptor 是否进入本轮模型请求的 `tools`；检查 capability catalog 搜索结果。

### Q: Tool 执行返回 SANDBOX_DENIED

**原因**：动态执行（shell/python/脚本/模型生成代码）命中 sandbox gateway 的 deny-by-default 策略。

**解决**：

1. 检查 `sandbox.deniedExecutables` 是否包含该可执行文件。
2. 确认 executable 是否在 sandbox gateway policy 的 allow 列表。
3. Bash 只做 tokenization + sandbox 路由，不直接执行；executable allow/deny 由 sandbox gateway policy 决定。
4. `clipc` 由 sandbox trusted locator 解析（`sandbox.clipcExecutableDirectoryEnv`，默认 `CLIP_HOME`）。

### Q: Tool 执行超时

**原因**：执行时间超过 request lifecycle、Capability 或 sandbox gateway 的受控时限。

**解决**：

1. 优化命令（添加限制参数、缩小操作范围）。
2. 检查 `runtimeSettings.requestTimeoutMs` 与具体 Capability/Gateway 的 timeout policy。
3. 检查 `runtimeSettings.maxTurns` / `maxToolCallsPerTurn` 是否合理。

### Q: 自定义 Tool 注册后无法被 Agent 发现

**检查清单**：

1. Tool 是否通过 capability source 注册到 catalog。
2. Tool 是否在 `agent.yaml` 的 `capabilityBindings` 中绑定。
3. Tool 的 `inputSchema` 是否返回有效 JSON Schema。
4. capability input schema validation 是否通过。

### Q: CapabilityInvocationResult.structuredPayload 未传递给模型

**原因**：`structuredPayload` 需通过 `SessionMessage(role=CAPABILITY_RESULT)` 序列化为模型可读消息。

**确认**：检查 capability invocation coordinator 是否正确将结果持久化并加入消息链。

## 会话与请求

### Q: 请求一直处于 ACCEPTED 状态

**可能原因**：

- session lane 调度等待中（同 session 活跃执行约束）。
- runtime 处理异常（查看 `logs/` 下的 `nextagent-operational.log.<sequence>.jsonl`）。
- pending input 等待用户回答（检查是否有 `USER_INPUT_REQUIRED` 事件）。

### Q: 重试请求后历史消息混乱

**这是设计行为**：

- 重试后，被替换的 assistant/capability 消息的 `visible` 字段设为 `false`。
- 查询会话历史时使用 `GET /api/v1/sessions/{id}/conversation`，该接口已过滤 `visible=false`。
- **禁止客户端自行重建历史**，必须使用 conversation API。

### Q: 浏览器刷新后 SSE 重连无响应

**解决**：

1. 使用 `lastSequence` / `lastSeenSequence` 参数重连（stream resume/replay）。
2. 区分 no-cursor live-tail、显式 `lastSeenSequence=0` replay、`requestId/runId` scoped bounded replay。
3. 若 live buffer 无法连续回放，客户端应刷新 `conversation` 历史。
4. SSE 重连时检查 HTTP 状态码。

## 幂等与 Scope

### Q: 幂等键冲突（IDEMPOTENCY_CONFLICT）

**原因**：同一 `idempotencyKey` 被重复提交且已有终态结果。

**解决**：

1. 每次新请求使用新的 `idempotencyKey`。
2. 锚点幂等写入由 runtime 保证，不要在客户端模拟幂等。
3. 重试同一请求可复用同一 key 以获得相同结果。

### Q: Scope 校验失败（REQUEST_VALIDATION_FAILED / SCOPE_VALIDATION）

**原因**：主路径同时执行 Agent Scope 与 Owner Scope 校验，任一失败返回 `REQUEST_VALIDATION_FAILED`。

**检查**：

1. 请求的 `agentId` 与 accepted run 固化的 `agentId`/`agentVersion`/`agentAssemblyRef` 一致。
2. owner scope（owner + agent scope）与持久化数据匹配。
3. 不要让客户端覆盖 scope 字段。

## Hook

### Q: Hook 未生效

**检查清单**：

1. hook 是否在启动期通过 app composition 装配（非目录扫描/manifest/请求主路径扫描）。
2. `agent.yaml.hooks` 中 `enabled: true`（或对 SYSTEM hook 未设 `disabled: true`）。
3. `stages` 收窄是否正确（只能收窄，不能扩大）。
4. 查看 `HOOK_INVOKED` 事件中的 `status` 与 `outcome`。
5. observe-only hook 返回 mutation/control 会被忽略并记诊断码——这是预期行为。

### Q: Hook 导致请求变慢

**原因**：impact hook 执行时间过长。

**优化**：

- 纯观察用途用 `effects: ["OBSERVE"]`（并行观察组，不阻塞主流程）。
- 减少 hook 中的耗时操作。
- 设置合理 `timeoutMs`。
- SYSTEM hook 必须 `failureMode: "FAIL"`；CUSTOM impact hook 可用 `CONTINUE` 在超时后继续主流程。

## 流式事件

### Q: SSE 事件不完整 / 丢失增量

**原因**：SSE 只保证实时传输，`LLM_CONTENT_DELTA` 和 `CAPABILITY_RESULT_DELTA` 不持久化。

**解决**：

- 历史完整内容通过 `conversation` API 获取。
- `role=ASSISTANT` 消息包含完整最终响应。
- `role=CAPABILITY_RESULT` 消息包含完整能力调用结果。

### Q: WebSocket 连接频繁断开

**检查**：

- agent-channel-web 提供 SSE 和 WebSocket 等价流式投影，切换为 SSE 测试是否复现。
- 检查网络代理设置。
- 检查 stream resume/replay 是否正确处理 `lastSeenSequence`。
- **反向代理 idle timeout**：NextAgent 的 SSE/WS 没有服务端心跳，服务器只在有事件时才发数据。如果代理（nginx `proxy_read_timeout`、LB idle timeout）短于事件间隔，会在无事件的间隙静默掐断连接——表现为"长思考期间断连"。将代理 idle timeout 调大到大于模型最长响应间隔，并确保客户端实现了 `lastSeenSequence` 重连。

## 提示模板

### Q: 提示模板未生效

**检查**：

1. Agent package 的 prompt 是否通过启动期 prompt template registration 装配。
2. `agent-context-engine` 的 purpose-aware template selection 是否匹配当前 `purpose`。
3. 查看 Context Engine 日志确认模板加载状态。
4. 内置 system prompt 包含双语电信输出约束（`telecom-bilingual-output` spec）。

### Q: 动态变量未被替换

**原因**：只支持模板中声明的标准变量。

**解决**：如需自定义变量，需在 context assembly 层扩展，不要在 SKILL.md 或 agent.yaml 中写表达式 DSL。

## 性能

### Q: 请求处理很慢

**常见原因**：

1. 工具调用次数过多（检查 `maxTurns` / `maxToolCallsPerTurn`）。
2. 模型响应慢（检查 `timeoutMs` 与 provider 延迟）。
3. 上下文过大（检查 context window selection 与 compaction）。
4. Hook 阻塞（检查 impact hook 执行时间）。

**诊断**：查看 timeline 中各阶段耗时分布（`HOOK_INVOKED`、`CAPABILITY_*`、模型调用）。

### Q: 内存使用过高

**可能原因**：

- large content 未按容量分级收敛（tool result inline/aggregate 阈值）。
- 会话未关闭导致内存累积。
- 记忆 aging 批量过大（`nextAgent.memory.aging.batchLimit`）。

**解决**：

- 调整 large content 阈值。
- 定期清理过期会话。
- 调整 `aging.batchLimit` 与 `extraction.maxCandidates`。

## 调试技巧

### 查看日志

运行日志为 JSONL 结构化格式，位于 `logs/` 目录，按大小滚动分片（`nextagent-operational.log.<sequence>.jsonl`）；指标导出为 `nextagent-metrics.ndjson`。日志文件名可通过 `application.yaml` 的 `observability.logging.file` 配置调整。

```bash
# 关键事件（JSONL 中 grep message 字段）
grep -E "REQUEST_ACCEPTED|REQUEST_COMPLETED|REQUEST_FAILED" logs/nextagent-operational.log.*.jsonl
grep -E "CAPABILITY_STARTED|CAPABILITY_COMPLETED" logs/nextagent-operational.log.*.jsonl
grep "HOOK_INVOKED" logs/nextagent-operational.log.*.jsonl
grep -E "ERROR|WARN" logs/nextagent-operational.log.*.jsonl
```

### 通过 API 调试

```bash
# 会话历史（已过滤 visible=false）
curl http://127.0.0.1:3000/api/v1/sessions/{sessionId}/conversation | python -m json.tool

# 监控流式事件
curl -N http://127.0.0.1:3000/api/v1/sessions/{sessionId}/stream | grep "data:" | head -20

# runtime bootstrap
curl http://127.0.0.1:3000/api/v1/runtime/bootstrap
```

### 检查 SQLite 数据

```bash
# 默认位置 <workspaceRoot>/data/system/nextagent.sqlite（由 nextAgent.paths.sqliteFile 决定）
# 另有 data/system/working-memory.sqlite 与 data/system/long-term-memory.sqlite
sqlite3 data/system/nextagent.sqlite
.tables
SELECT * FROM session ORDER BY created_at DESC LIMIT 5;
SELECT * FROM session_message WHERE session_id = 'sess_xxx' ORDER BY sequence;
SELECT * FROM run_timeline WHERE request_run_id = 'run_xxx' ORDER BY sequence;
```

> NextAgent 使用专用业务事实表（session / message / active context / timeline / checkpoint / annotation / share / memory 等），不提供 generic `records(store,key,json)` 访问。

## 获取帮助

- 开发者文档：`docs/developer/`
- OpenSpec 总览：`openspec/overview.md`
- 行为契约：`openspec/specs/`
- 发布说明：`docs/release/NextAgent-v2.0-release.md`
- [快速上手](./01-quickstart.md)
- [测试与调试](./11-testing-debugging.md)
- [部署说明](./12-deployment.md)
- 交付/二开支持渠道：以你与 NextAgent 交付方签订的协议为准（issue 跟踪、SLA 与升级流程），仓库内文档面向源码开发者
