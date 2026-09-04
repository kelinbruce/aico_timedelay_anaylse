## 1. FN-7.8 上报 AI 日志

- [ ] 1.1 在 `agent-contracts/gateway` 新增 `OperationLogGatewayPort` 接口和 `OperationLogEntry` 类型
  来源：design `FN-7.8 上报 AI 日志 / 修改方案 / 1. Contract 定义`；`FN-7.8` + `OperationLogGatewayPort 是 AI 日志上报出口`
  验证：`npm run build` 通过；contract test 验证接口和类型导出

- [ ] 1.2 在 `agent-app` composition 新增辅助函数 `truncate`、`buildResourceName`、`formatAiLogDetail`、`resolveAuditLocale`，中英文模板直接 hardcode
  来源：design `FN-7.8 上报 AI 日志 / 修改方案 / 2. 辅助函数`；`FN-7.8` + `detail 字段按 locale 选择模板`
  验证：unit test 验证中英文模板填充、resourceName 构建（含 km 标记）、truncate 至 1024 字符按 Unicode 字符数、`resolveAuditLocale` 的 `OSS_LANG` 优先与下划线归一化及空值降级行为

- [ ] 1.3 扩展 `extractRequestHeaders` 捕获 `x-real-client-addr` / `x-forwarded-for` / `request.ip`，存入 requestHeaders
  来源：design `FN-7.8 上报 AI 日志 / 修改方案 / 3. terminalIP 获取`；`FN-7.8` + `terminalIP 从请求头捕获` + `terminalIP 来自 x-real-client-addr`、`terminalIP 来自 x-forwarded-for`、`terminalIP 来自 request.ip`
  验证：运行相关 Vitest suites；现有 header 提取行为不回归

- [ ] 1.4 在 composition 层注册 `runTimelineEventListeners`，按 `runId` 在内存 Map 中收集 modelId（`MODEL_INVOCATION_COMPLETED`）和 km 标记（`CAPABILITY_COMPLETED` + `capabilityId === 'Rag'` 或 `nodeType === 'KNOWLEDGE_SEARCH'` / `'KNOWLEDGE_QA'`），listener 在 port 为 undefined 时不注册
  来源：design `FN-7.8 上报 AI 日志 / 修改方案 / 4. Composition wiring`；`FN-7.8` + 可靠性/恢复 + `通过 timeline 事件监听收集模型名和 km 标记` + `模型调用记录 modelId`、`Agent loop RagTool 记录 km 标记`、`Workflow knowledge 节点记录 km 标记`、`Port 不存在时不注册 listener`
  验证：unit test 验证 modelId 收集、km 标记两种来源（agent loop RagTool 和 workflow knowledge 节点）、去重行为、port 为 undefined 时不注册

- [ ] 1.5 在 `agent-app` composition 层 `postTerminalCallback` 闭包中组装 AI 日志 entry（所有终态、审计 locale 按 `OSS_LANG` 优先解析、4 参数 detail 模板、resourceName 构建、truncate），在 early-return 之前执行，调用 `writeAiLog`，fire-and-forget
  来源：design `FN-7.8 上报 AI 日志 / 修改方案 / 5. AI 日志组装`；`FN-7.8` + `所有终态都上报 AI 日志` + `COMPLETED 终态上报 SUCCESSFUL`、`FAILED 终态上报 FAILURE 并填充 answer panel 内容`、`CANCELED 终态上报 FAILURE`、`无 ASSISTANT 消息时输出内容为空`、`Guardrail 拦截轮次上报且资源名称为空`；`detail 字段按 locale 选择模板` + `中文 locale 使用中文标点模板`、`英文 locale 使用英文标点模板`、`输出内容截断至 1024 个字符`
  验证：integration test 验证 COMPLETED/FAILED/CANCELED 终态的 entry 组装、模板填充、截断行为、fire-and-forget 容错；`OSS_LANG` 优先于 `command.locale` 决定审计 locale；guardrail blocked round 的 resourceName 为空；无 ASSISTANT 消息时 answer 为空字符串

- [ ] 1.6 验证多实例 recovery 降级：recovery 实例内存 Map 为空时 AI 日志仍上报，resourceName 为空字符串
  来源：design `FN-7.8 上报 AI 日志 / 修改方案 / 4. Composition wiring / 多实例降级`；`FN-7.8` + 可靠性/恢复 + `通过 timeline 事件监听收集模型名和 km 标记` + `Recovery 实例资源名称为空`
  验证：integration test 验证 recovery 场景下 AI 日志正常上报且 resourceName 为空

## 2. 安全边界

- [ ] 2.1 验证 AI 日志内容不进入 observability surfaces（`ObservabilityProjectorHost`、Web API、SSE、WebSocket、timeline、audit）
  来源：design `FN-7.8 上报 AI 日志 / 修改方案 / 质量属性影响`；`FN-7.8` + 安全 + `CloudSop 审计通道是受控脱敏例外` + `AI 日志内容不进入可观测面`、`AI 日志只包含用户输入和 assistant 输出`
  验证：architecture test 验证 AI 日志路径不经过 observability 投影路径

## 3. Change 整体验证

- [ ] 3.1 严格校验 change
  来源：proposal `What Changes`；design `验证策略`
  验证：运行 `openspec validate add-ai-log-reporting --strict`；预期 strict validation 通过

- [ ] 3.2 运行 build、contract、architecture gates
  来源：proposal `影响范围`；design `验证策略`
  验证：运行 `npm run build`、`npm run test:contract`、`npm run lint:architecture`；本 change 相关用例全部通过

- [ ] 3.3 运行 `$nextagent-code-review` 检视
  来源：AGENTS.md `Push/Commit 约束`
  验证：检视结论为 PASS 或 PASS WITH FOLLOW-UP

## 归档前更新基线检查（非实施任务）

归档流程按 design 的长期基线刷新计划同步 stable spec、Function 文档、overview 和 spec-to-design-map，确认安全边界例外已文档化，并检查不重复定义 redaction-policy 既有约束。
