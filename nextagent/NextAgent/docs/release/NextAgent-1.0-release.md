# NextAgent 1.0 Release

> 本文档描述当前仓库实现基线下的 1.0 发布口径。仓库 package 版本仍为 `0.1.0`，本文档不修改版本号，只整理当前可交付能力。

## 概览

NextAgent 1.0 是面向电信网络智能体的 TypeScript 后端底座，围绕一次问答主链路提供可审计、可恢复、可治理、可诊断的生产能力。

它覆盖会话、请求、流式输出、模型调用、能力调用、持久化、发布打包和观测安全，目标不是通用聊天 demo，而是可落地的后端内核。

## 黑盒效果

- 可以创建会话、提交问题、订阅流式输出、读取历史结果。
- 可以在 SSE 和 WebSocket 两种 transport 间切换。
- 可以在同一会话中保持上下文一致性。
- 可以在失败时得到安全、可读的错误，而不是敏感原始异常。
- 可以在本地模式下完成启动、打包和发布资格检查。

## 关键功能规格

### 1. 最小 Agent 问答内核

用户提交一个合法问题后，系统返回 accepted response，并持续输出模型结果直到唯一终态。

关键规格：

- Web submit 进入 `RuntimeCommandPort.submit`，request lifecycle 由 `agent-runtime` 拥有。
- Runtime 在 acceptance 阶段创建或推进 `RequestRun`，固化 `sessionId`、`agentId`、`agentVersion`、`agentAssemblyRef`。
- Agent core 至少完成一次 context render 和 model invocation。
- terminal commit 成功后，才允许投影 `REQUEST_COMPLETED` 或 `REQUEST_FAILED`。
- history 以持久化 visible message 为准，不从 stream envelope 或 projection cache 反推最终对话。
- 同一 owner + agent scoped session 同时只能有一个 active run，后到的并发 submit 必须安全拒绝或冲突返回。

输入约束：

- submit 请求必须包含非空 `inputText` 和 `idempotencyKey`。
- `locale` 可选。
- `attachments` 当前只允许空数组。
- owner 字段、agent 字段、stream path、runtime status、title 等不能由请求体注入。

### 2. 会话与历史

用户可以创建会话、分页列出会话、读取指定会话对话历史；convenience submit 可在没有显式 session 时自动创建并提交。

关键规格：

- `POST /api/v1/sessions` 只允许 `locale?`，不触发 Agent core，也不调用模型。
- session create 的 owner scope 来自可信 channel/auth identity，agent scope 来自 runtime 内部 resolver。
- create-session 成功响应只返回 `sessionId`、`displayTitle`、`lastActivityAt`。
- session list query 只允许 `offset?` 和 `limit?`。
- session list 以 `updatedAt desc, sessionId asc` 稳定排序。
- conversation query 支持 `cursor?`、`limit?`、`includeCapabilityResults?`。
- conversation 默认读取最新 visible message window，按 `createdAt asc, messageId asc` 返回。
- public Web alias 只在 `agent-channel-web` projection 层出现；内部服务使用 canonical 字段。
- 跨 owner 或跨 agent 访问必须返回 safe not-found outcome，不泄漏对象是否存在。

输出边界：

- session list 不返回 `tenantId`、`subjectId`、`agentId`、stream path、websocket path、conversation messages 或 internal cursor 字段。
- conversation 不公开 `includeHidden`，且 `includeCapabilityResults` 默认 false。

### 3. 流式传输

用户可以通过 SSE 或 WebSocket 订阅同一个 request/run 的进度，两种 transport 投影同一 canonical timeline。

关键规格：

- bootstrap response 只暴露 `transportKind: "SSE" | "WEBSOCKET"`。
- `transportKind` 来自可信 app/channel 配置，不能来自 query、body、localStorage、user metadata、模型输出或 capability 参数。
- stream query 只允许 `lastSeenSequence?`、`requestId?`、`runId?`。
- `lastSeenSequence` 必须是非负 safe integer。
- Web channel 读取 runtime canonical timeline，并通过共享 projection service 输出 `StreamEnvelope`。
- request/run scoped stream 在匹配 terminal event 后关闭；session scoped stream 在单个 run terminal 后继续订阅同一 session 后续事件。
- client disconnect、heartbeat、transport close、cleanup 不能生成 execution facts，也不能合成 terminal event。

首版 stream event vocabulary：

- `REQUEST_ACCEPTED`
- `LLM_THINKING_DELTA`
- `LLM_CONTENT_DELTA`
- `CAPABILITY_STARTED`
- `CAPABILITY_RESULT_DELTA`
- `CAPABILITY_COMPLETED`
- `DEGRADATION_NOTICE`
- `REQUEST_COMPLETED`
- `REQUEST_FAILED`
- `REQUEST_CANCELED`
- `REQUEST_SUPERSEDED`
- `USER_INPUT_REQUIRED`
- `USER_INPUT_RECEIVED`
- `USER_INPUT_TIMEOUT`
- `USER_INPUT_CANCELED`
- `ATTACHMENT_ACCEPTED`
- `ATTACHMENT_REJECTED`
- `CONTEXT_COMPACTED`

禁止项：

- Web channel 不创建私有 RequestRun status、terminal state 或 timeline facts。
- 不输出 deprecated event name，例如 `STREAM_STARTED`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED`。
- projection、serialization 或 timeline read 失败时必须 safe failure，不能静默吞错或伪造 `REQUEST_COMPLETED`。

### 4. 模型与能力

默认 Agent 可通过配置的 OpenAI-compatible profile 调用模型，模型 profile、prompt template 和 capability binding 由已接受 request 的 assembly 决定。

关键规格：

- `modelProfiles` 在 system 配置中注册，Agent 通过 `modelProfileIds` 和 `runtimeSettings.defaultModelProfileId` 选择。
- 当前模型 profile 使用 `providerKind=OPENAI` 的 provider boundary。
- raw credential 不进入 Agent 配置；模型 credential 通过 `credentialRef` 引用。
- accepted request 执行时必须使用 acceptance 固化的 assembly version，不能重新按 active version 选择模型、prompt 或 capability。
- capability 可见性来自 accepted assembly 的 binding；未绑定能力不能暴露给模型。
- capability invocation 通过 `agent-capability` 生命周期承载，结果对外只投影 safe summary 或安全字段。

边界：

- provider SDK、stream normalization、tool-use normalization 和 safe error mapping 封装在 `agent-model`。
- runtime 不做业务语义路由，core 不直接写 gateway。
- raw provider error、raw model output 和 tool result 不能进入 SafeError、日志、audit 或 public stream。

### 5. 持久化与恢复

本地 gateway 使用 SQLite 专用事实表，重复提交不会重复产生副作用，终态和历史保持一致。

关键规格：

- gateway-local 使用专用业务表保存 sessions、messages、request_runs、active context、timeline events 和 checkpoints。
- 主路径持久化事实必须同时携带 owner scope 和 agent scope。
- session create 的幂等锚点是 `sessions`。
- accepted request run create 的幂等锚点是 `request_runs`。
- message append 使用 `messages` 锚点事实，并与 active context 更新保持事务一致。
- request run 状态推进使用 version CAS transition。
- terminal commit 在一个 gateway transaction 内提交 terminal message、active context item、terminal event 和 RequestRun terminal state。
- terminal commit 必须结合 CAS 与 idempotency key 防止双终态。

恢复与降级：

- terminal durable commit 失败后，run 进入可诊断 internal failure 或 pending commit 状态。
- output 超限不能静默截断；除 `read` 能力显式分页截断外，必须发布 `DEGRADATION_NOTICE` 并以 safe failure 结束。

### 6. 发布与打包

开发者可以构建本地 runtime package，并通过固定 qualification flow 判断是否可发布。

关键规格：

- release qualification 只接收 candidate root 和显式 release scope。
- qualification 按固定顺序执行：contract、architecture、security、resilience、release-package、product-journey、capacity。
- 固定命令结果只有 `PASSED` 能继续推进；`FAILED`、`MISSING`、`TIMEOUT`、`UNAVAILABLE` 都必须 fail closed。
- release-package 必须产出 `PackageCandidateEvidence` 和 `HealthProof`。
- health proof 的 primary、deep 和 critical dependency statuses 都必须通过，才可证明关键依赖可服务。
- diagnostics 只作为 release evidence，不成为 request truth、checkpoint、memory 或用户可见历史。

已提供命令：

- `npm run pack:backend`
- `npm run pack:release`
- `npm run release:qualify`
- `npm run test:e2e:release-package`
- `npm run test:e2e:product-journey`
- `npm run test:e2e:release`

### 7. 观测与安全

用户侧失败以 safe error 或 safe failure envelope 表达，运维侧通过结构化日志、metric、trace 和 audit 摘要定位问题。

关键规格：

- `agent-observability` 提供 AsyncLocalStorage request/run context、Pino structured logging helper、OpenTelemetry integration wrapper、metric tag policy 和 redaction policy。
- SafeError、stream payload、history message 和 audit safe summary 不能包含 raw prompt、model output、stream delta、raw provider error、tool args/result、credential、token、附件内容或未脱敏路径。
- `RunStatus` 只使用 canonical lifecycle status；降级通过 `DEGRADATION_NOTICE`、safe error、audit event 或 metric 表达。
- projection diagnostic 只作为 safe log、metric 或 audit summary，不写入 canonical execution timeline 作为业务事实。
- lifecycle hook、checkpoint、audit 的默认 no-op provider 必须显式装配并被主流程调用。

安全边界：

- identity 和 owner scope 只来自 channel/auth boundary。
- agent scope 只来自 app composition、hosted-agent selection 或已持久化 session/run。
- 客户端请求体、模型输出、capability 参数不能覆盖 owner scope 或 agent scope。

## DFX

- 可诊断：request lifecycle、run 状态、terminal commit、capability 调用都能追踪。
- 可恢复：canonical timeline、checkpoint、terminal commit 和幂等写入一起支撑恢复。
- 可测试：contract、architecture、E2E 和 release gate 都能重复验证。
- 可维护：DO / DTO / Record / row 分层清晰，跨包只走 public exports。
- 可治理：owner scope、agent scope、模型和能力边界都有明确可信来源。

## 用户自定义配置

默认配置位于：

- `packages/agent-app/config/default-system.yaml`
- `packages/agent-app/config/default-agent.yaml`

system 配置可调整项：

- `deployment.mode`
- `paths.workspaceRoot`
- `paths.logDirectory`
- `observability.logging.redaction`
- `auth.mode`
- `auth.localIdentity`
- `channel.transport`
- `channel.host`
- `channel.port`
- `hostedAgent.activeAgentId`
- `modelProfiles`
- `gateway`
- `sandbox.clipcExecutableDirectoryEnv`
- `noopBoundaries`

agent 配置可调整项：

- `agentId`
- `agentVersion`
- `displayName`
- `description`
- `workspaceDir`
- `modelProfileIds`
- Agent package `prompts/` prompt template manifests
- `capabilityBindings`
- `runtimeSettings`
- `resources`

环境变量示例：

- `OPENAI_API_KEY`
- `CLIP_HOME`

## 使用方式

```bash
npm install
npm run build
npm test
npm run test:contract
npm run lint:architecture
openspec validate --all --strict
```

```bash
npm run release:qualify
npm run pack:backend
npm run pack:release
```

```bash
npm run dev:watch
npm run dev:fullstack
```

典型流程：

1. 启动 `agent-app`。
2. 通过 `POST /api/v1/sessions` 创建会话。
3. 通过 `POST /api/v1/requests` 提交问题。
4. 通过 SSE 或 WebSocket 订阅 stream。
5. 通过 history 接口查看最终对话结果。

## 已知边界

- 当前仓库是 TS 后端 workspace，不包含浏览器 UI 源码。
- 当前 release 口径仍以最小 Agent 内核为核心，不覆盖附件、多工具长链路、长期记忆等更外层能力。
- 本文档描述的是当前实现基线，不等同于产品版本号已经切到 `1.0.0`。
