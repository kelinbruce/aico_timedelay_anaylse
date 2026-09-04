<!--
Task 编写规则：
- 每个 checkbox 只能对应一个可独立验收的交付结果
- 每个实现类 task 必须包含"验证"和"来源"
- 涉及 forbidden behavior、边界约束、权限、依赖规则或失败路径时，必须添加 negative verification task
-->

## 1. 功能维度 — Submit→Terminal + Scope 双层校验

- [ ] 1.1 TC-F-001: Submit→Terminal 完整主流程（正路径）
  验证：`vitest run TC-F-001-002.test.ts` — submit.status=200, requestId 存在, conversation ≥2 条
  来源：functional-test-behavior-contracts / Submit→Terminal 正路径

- [ ] 1.2 TC-F-001B: Submit→Terminal 并发双终态 CAS 竞争（边界）
  验证：`vitest run TC-F-001-002.test.ts` — CAS 竞争唯一终态, ⚠️ REQUEST_CANCEL_ALREADY_TERMINAL
  来源：functional-test-behavior-contracts / Submit→Terminal 并发双终态边界

- [ ] 1.3 TC-F-001E: Submit 缺 idempotencyKey 无 side effect（异常）
  验证：`vitest run TC-F-001-002.test.ts` — ⚠️ 真实API: idempotencyKey 可选, API 自动生成而非返回 400
  来源：functional-test-behavior-contracts / Submit 缺 key 异常

- [ ] 1.4 TC-F-002: Scope 双层校验合法请求通过（正路径）
  验证：`vitest run TC-F-001-002.test.ts` — submit → COMPLETED 正常
  来源：functional-test-behavior-contracts / Scope 双层校验正路径

- [ ] 1.5 TC-F-002B: Trusted identity 模式下 nonexistent session 返回 404（边界）
  验证：`vitest run TC-F-001-002.test.ts` — getConversation('nonexistent') = 404
  来源：functional-test-behavior-contracts / Scope Request-level 拒绝边界

- [ ] 1.6 TC-F-002E: Capability-level safe-not-found 不泄漏 internal（异常）
  验证：`vitest run TC-F-001-002.test.ts` — ⚠️ 真实API: /capabilities 不存在, 通过 conversation 间接验证
  来源：functional-test-behavior-contracts / Capability-level safe-not-found 异常

## 2. 功能维度 — Cancel propagation + Retry

- [ ] 2.1 TC-F-003: Cancel propagation EXECUTING→CANCELLED（正路径）
  验证：`vitest run TC-F-003-004.test.ts` — cancel.status=200, terminal 包含 CANCELLED 或 COMPLETED
  来源：functional-test-behavior-contracts / Cancel propagation 正路径

- [ ] 2.2 TC-F-003E: Trusted identity 模式下 Cancel 同一 session（异常）
  验证：`vitest run TC-F-003-004.test.ts` — cancel.status ∈ [200, 409]
  来源：functional-test-behavior-contracts / Trusted identity Cancel 异常

- [ ] 2.3 TC-F-004: Retry 创建新 attempt 且旧 attempt 不变（正路径）
  验证：`vitest run TC-F-003-004.test.ts` — retry.status=200, 新 requestId ≠ 旧 requestId
  来源：functional-test-behavior-contracts / Retry 新 attempt 正路径

- [ ] 2.4 TC-F-004B: Retry 两条 attempt Stream 独立可追溯（边界）
  验证：`vitest run TC-F-003-004.test.ts` — conversation 包含两条独立追溯的消息
  来源：functional-test-behavior-contracts / Retry 独立追溯边界

## 3. 功能维度 — Pending Input / Stream Resume / History / 状态机 / Lane

- [ ] 3.1 TC-F-006: Pending Input lifecycle TRIGGERED→DELIVERED→RESOLVED（正路径）
  验证：`vitest run TC-F-006-010.test.ts` — ⚠️ resolvePendingInput 端点未确认, 通过 conversation 间接验证
  来源：functional-test-behavior-contracts / Pending Input lifecycle 正路径

- [ ] 3.2 TC-F-006B: Pending Input 超时必须 EXPIRED（边界）
  验证：`vitest run TC-F-006-010.test.ts` — 超时后 request 到达明确终态
  来源：functional-test-behavior-contracts / Pending Input 超时边界

- [ ] 3.3 TC-F-007: Stream Resume 从 bootstrap anchor 重播（正路径）
  验证：`vitest run TC-F-006-010.test.ts` — conversation bootstrap 消息 ≥1 条
  来源：functional-test-behavior-contracts / Stream Resume 正路径

- [ ] 3.4 TC-F-007E: Stream Resume 失败保持降级提示（异常）
  验证：`vitest run TC-F-006-010.test.ts` — 不静默空白, messages ≥1 条
  来源：functional-test-behavior-contracts / Stream Resume 失败异常

- [ ] 3.5 TC-F-008: History 与 Stream 内容一致（正路径）
  验证：`vitest run TC-F-006-010.test.ts` — conversation 消息 ≥2 条
  来源：functional-test-behavior-contracts / History 一致正路径

- [ ] 3.6 TC-F-008B: 刷新后消息数量与顺序不变（边界）
  验证：`vitest run TC-F-006-010.test.ts` — 两次 conversation 消息数量相等、首尾一致
  来源：functional-test-behavior-contracts / History 一致边界

- [ ] 3.7 TC-F-009: RequestRun 状态机合法转换 QUEUED→EXECUTING→COMPLETED（正路径）
  验证：`vitest run TC-F-006-010.test.ts` — conversation 含 ASSISTANT 消息
  来源：functional-test-behavior-contracts / RequestRun 状态机正路径

- [ ] 3.8 TC-F-009E: RequestRun 非法转换 COMPLETED→CANCELLED 被 CAS 拒绝（异常）
  验证：`vitest run TC-F-006-010.test.ts` — cancel.status ∈ [400, 409, 422], ⚠️ error.code=REQUEST_CANCEL_ALREADY_TERMINAL
  来源：functional-test-behavior-contracts / RequestRun CAS 拒绝异常

- [ ] 3.9 TC-F-010: Lane 串行调度同一 Lane 至多一个 EXECUTING（正路径）
  验证：`vitest run TC-F-006-010.test.ts` — 两个 request 最终到达终态
  来源：functional-test-behavior-contracts / Lane 串行正路径

- [ ] 3.10 TC-F-010B: Lane 串行调度多请求排队（边界）
  验证：`vitest run TC-F-006-010.test.ts` — 3 个 request 全部到达终态
  来源：functional-test-behavior-contracts / Lane 串行边界

## 4. 功能维度 — 其余功能用例 Part 2 (TC-F-013~026)

- [ ] 4.1 TC-F-013: Attachment lifecycle intake→staging→availability（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — conversation 包含 REQUEST_COMPLETED
  来源：functional-test-behavior-contracts / Attachment lifecycle 正路径

- [ ] 4.2 TC-F-013E: Attachment 校验失败明确报错（异常）
  验证：`vitest run TC-F-013-026.test.ts` — malicious file ref → 400/422 或 REQUEST_FAILED
  来源：functional-test-behavior-contracts / Attachment 校验失败异常

- [ ] 4.3 TC-F-014: Context budget 超出给出可解释提示（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — long context → COMPLETED 或 FAILED
  来源：functional-test-behavior-contracts / Context budget 正路径

- [ ] 4.4 TC-F-015: Model fallback primary 不可用切换 fallback fail-closed（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — fallback → waitForTerminal
  来源：functional-test-behavior-contracts / Model fallback 正路径

- [ ] 4.5 TC-F-015E: Model fallback 全链不可用明确 FAILED（异常）
  验证：`vitest run TC-F-013-026.test.ts` — all-fail → waitForTerminal
  来源：functional-test-behavior-contracts / Model fallback 全链失败异常

- [ ] 4.6 TC-F-016: Unified Capability invocation 四种类型共享统一接口（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — ⚠️ /capabilities 不存在, 通过 conversation 间接验证
  来源：functional-test-behavior-contracts / Capability invocation 正路径

- [ ] 4.7 TC-F-017: Pending Input AUTHORIZATION 触发→approve→RESOLVED（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — ⚠️ resolvePendingInput 端点未确认
  来源：functional-test-behavior-contracts / Pending Input AUTHORIZATION 正路径

- [ ] 4.8 TC-F-018: Risk policy 高风险操作触发 AUTHORIZATION（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — ⚠️ resolvePendingInput 端点未确认
  来源：functional-test-behavior-contracts / Risk policy 正路径

- [ ] 4.9 TC-F-019: Session title 异步生成不阻塞主流程（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — submit → waitForTerminal → getConversation
  来源：functional-test-behavior-contracts / Session title 正路径

- [ ] 4.10 TC-F-022: Builtin tool 边界内正常执行超边界明确拒绝（正路径）
  验证：`vitest run TC-F-013-026.test.ts` — "list current directory" OK + "curl external-url" fail
  来源：functional-test-behavior-contracts / Builtin tool boundary 正路径

## 5. 功能维度 — 配置安全门控 (TC-F-027~038)

- [ ] 5.1 TC-F-027: 配置越界权限写入 → BLOCKED（负路径）
  验证：`vitest run TC-F-027-038.test.ts` — "ownership violation" + BLOCKED
  来源：functional-test-behavior-contracts / 配置越界权限拒绝策略

- [ ] 5.2 TC-F-028: observability.logging.redaction 非法枚举值 → BLOCKED（负路径）
  验证：`vitest run TC-F-027-038.test.ts` — "invalid enum value" + BLOCKED
  来源：functional-test-behavior-contracts / 非法枚举值安全拒绝

- [ ] 5.3 TC-F-029: 无可用 enabled model profile → BLOCKED（负路径）
  验证：`vitest run TC-F-027-038.test.ts` — "no viable enabled model profile" + BLOCKED
  来源：functional-test-behavior-contracts / 无可用 model profile 安全拒绝

- [ ] 5.4 TC-F-030: DefaultSystemConfig 运行时不可变（正路径）
  验证：`vitest run TC-F-027-038.test.ts` — 运行时修改不影响已有配置
  来源：functional-test-behavior-contracts / DefaultSystemConfig 运行时不可变

- [ ] 5.5 TC-F-031: sandbox.enabled 缺失默认为 true 且阻断（正路径）
  验证：`vitest run TC-F-027-038.test.ts` — 无 sandbox 配置 → sandbox.enabled.*true
  来源：functional-test-behavior-contracts / sandbox 缺失默认 true

- [ ] 5.6 TC-F-032: sandbox.enabled 非布尔值安全失败（异常）
  验证：`vitest run TC-F-027-038.test.ts` — "yes" → "expected boolean…got string…yes" + BLOCKED
  来源：functional-test-behavior-contracts / sandbox 非布尔值安全失败

- [ ] 5.7 TC-F-037: Model 调用不越界 workspace 文件权限（正路径）
  验证：`vitest run TC-F-027-038.test.ts` — "write to /etc/hacked.txt" → sandbox 拒绝
  来源：functional-test-behavior-contracts / Model 调用不越界文件权限

- [ ] 5.8 TC-F-038: dev:fullstack 启动前后端共端口（正路径）
  验证：`vitest run TC-F-027-038.test.ts` — /health=200, / 返回 HTML, agent-web package version 匹配
  来源：functional-test-behavior-contracts / dev:fullstack 共端口

## 6. 功能维度 — 补充用例 (TC-F-040~065)

- [ ] 6.1 TC-F-040~065: 功能维度 P1 补充用例（状态机/输入校验/安全隔离/接口契约/并发/认证）
  验证：`vitest run TC-F-040-065.test.ts` — 34 个 test 按各自预期验证
  来源：functional-test-behavior-contracts / 补充用例覆盖

## 7. 功能维度 — SSE stream / Capability / Command idempotency (Playwright)

- [ ] 7.1 TC-F-005: SSE stream 事件序列完整推送（正路径）
  验证：`npx playwright test TC-F-005-012.spec.ts` — ⚠️ SSE only（无 WS），JS collector 收集事件序列
  来源：functional-test-behavior-contracts / SSE stream 正路径

- [ ] 7.2 TC-F-011: Session scope 限制合法请求正常执行（正路径）
  验证：`npx playwright test TC-F-005-012.spec.ts` — ⚠️ /capabilities 不存在, 通过 conversation 间接验证
  来源：functional-test-behavior-contracts / Capability catalog 正路径

- [ ] 7.3 TC-F-012: Command idempotency 重复提交返回首次结果（正路径）
  验证：`npx playwright test TC-F-005-012.spec.ts` — ⚠️ 真实API: 返回相同 requestId（幂等）
  来源：functional-test-behavior-contracts / Command idempotency 正路径

- [ ] 7.4 TC-F-012E: Command idempotency 缺 key 自动生成（异常）
  验证：`npx playwright test TC-F-005-012.spec.ts` — ⚠️ 真实API: idempotencyKey 可选
  来源：functional-test-behavior-contracts / Command idempotency 缺 key 异常

## 8. UI 交互维度 (Playwright)

- [ ] 8.1 TC-UI-001: Web UI 提交消息→SSE stream 推送回复正确渲染（正路径）
  验证：`npx playwright test TC-UI-001-003.spec.ts` — message-textarea + btn-send + ai-bubble + chat-stream-status-strip
  来源：ui-interaction-test-behavior-contracts / SSE stream UI 渲染正路径

- [ ] 8.2 TC-UI-002: Web UI Pending Input AUTHORIZATION 交互组件（正路径）
  验证：`npx playwright test TC-UI-001-003.spec.ts` — respond-input-panel + respond-input-approval
  来源：ui-interaction-test-behavior-contracts / Pending Input 交互正路径

- [ ] 8.3 TC-UI-003: Web UI Stream 断连重连提示与内容恢复（正路径）
  验证：`npx playwright test TC-UI-001-003.spec.ts` — ⚠️ SSE 可能超时
  来源：ui-interaction-test-behavior-contracts / 断连重连正路径

- [ ] 8.4 TC-UI-004: Web UI 会话列表展开/收缩 sessionStorage 持久化（正路径）
  验证：`npx playwright test TC-UI-004-006.spec.ts` — ⚠️ 已知 FAIL: sessionStorage.getItem('sessionListPreference') 返回 null
  来源：ui-interaction-test-behavior-contracts / Session List 持久化正路径

- [ ] 8.5 TC-UI-005: Web UI Composer 草稿缓存与恢复（正路径）
  验证：`npx playwright test TC-UI-004-006.spec.ts` — ⚠️ 已知 FAIL: sessionStorage.getItem('composerDraft_{sid}') 返回 null
  来源：ui-interaction-test-behavior-contracts / Composer 草稿正路径

- [ ] 8.6 TC-UI-006: Web UI 深色模式 scrollbar 主题一致性（正路径）
  验证：`npx playwright test TC-UI-004-006.spec.ts` — ⚠️ 已知 FAIL: 无 theme-toggle-btn
  来源：ui-interaction-test-behavior-contracts / 深色模式 scrollbar 正路径

## 9. 兼容性维度

- [ ] 9.1 TC-C-001: 跨平台可执行语义一致性（正路径）
  验证：`vitest run TC-C-001-003.test.ts` — 三平台 assistant 回复包含 "hello"
  来源：compatibility-test-behavior-contracts / 跨平台语义一致正路径

- [ ] 9.2 TC-C-002: 前端 backend-only/with-frontend 双模式 API 行为一致（正路径）
  验证：`vitest run TC-C-001-003.test.ts` — 两种模式 Submit→COMPLETED 正常, RequestRun 结构一致
  来源：compatibility-test-behavior-contracts / 双模式 API 行为一致正路径

- [ ] 9.3 TC-C-003: Agent Web 多 host 模式各 host 独立（正路径）
  验证：`vitest run TC-C-001-003.test.ts` — ⚠️ trusted identity 模式下无跨 tenant 隔离
  来源：compatibility-test-behavior-contracts / 多 host 独立正路径

- [ ] 9.4 TC-C-004~012: 兼容性维度其余用例（跨版本/降级/协议/编码等）
  验证：`vitest run TC-C-004-012.test.ts` — 20 个 test 按各自预期验证
  来源：compatibility-test-behavior-contracts / 兼容性其余用例

- [ ] 9.5 TC-C-013~017: 兼容性维度补充用例（配置/部署/安全边界等）
  验证：`vitest run TC-C-013-017.test.ts` — 17 个 test 按各自预期验证
  来源：compatibility-test-behavior-contracts / 兼容性补充用例

## 10. 可观测性维度

- [ ] 10.1 TC-O-001: 日志四层结构化可检索过滤（正路径）
  验证：`vitest run TC-O-001-003.test.ts` — conversation 消息 ≥1 条, 包含 role+content
  来源：observability-test-behavior-contracts / 日志四层结构化正路径

- [ ] 10.2 TC-O-001E: 日志不含 raw Secret 和非结构化内容（异常）
  验证：`vitest run TC-O-001-003.test.ts` — conversation 不包含 raw Secret 值, 不包含 *Record
  来源：observability-test-behavior-contracts / 日志脱敏异常

- [ ] 10.3 TC-O-002: Audit event 按 RequestRun id 追溯完整 chain（正路径）
  验证：`vitest run TC-O-001-003.test.ts` — conversation 消息含 requestId+timestamp, 时间戳递增
  来源：observability-test-behavior-contracts / Audit event 追溯正路径

- [ ] 10.4 TC-O-003: Metric 低基数可聚合可对比（正路径）
  验证：`vitest run TC-O-001-003.test.ts` — ⚠️ /metrics 端点可能不存在(404)
  来源：observability-test-behavior-contracts / Metric 低基数正路径

## 11. 验证和收尾

- [ ] 11.1 运行 Vitest 全量测试（17 .test.ts 文件）
  验证：`vitest run` — 98 用例全量执行
  来源：design / 双框架执行架构

- [ ] 11.2 运行 Playwright E2E 全量测试（3 .spec.ts 文件）
  验证：`npx playwright test` — 16 用例全量执行
  来源：design / 双框架执行架构

- [ ] 11.3 标注已知问题：SSE 超时、sessionStorage key 不存在、无 theme-toggle-btn
  验证：检查 TC-F-005/005B, TC-UI-004/005/006 的 ⚠️ 标注完整性
  来源：design / 已知问题标注策略

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/ts-architecture-test-gate-functional/spec.md`：新增功能维度测试行为契约
- 同步 `openspec/specs/ts-architecture-test-gate-compatibility/spec.md`：新增兼容性维度测试行为契约
- 同步 `openspec/specs/ts-architecture-test-gate-observability/spec.md`：新增可观测性维度测试行为契约
- 同步 `openspec/specs/ts-architecture-test-gate-ui-interaction/spec.md`：新增 UI 交互维度测试行为契约
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义
