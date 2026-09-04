## 1. Dev workbench composition and route surface

- [x] 1.1 在现有 local runtime package composition 中默认注册 Agent Dev Workbench extension，并在 production packaging composition 中排除 `agent-dev-workbench`、workbench route/page/API 和 local read adapter；不得新增 `dev` package profile 或生产 feature flag。主路径业务运行事实不得受工作台装配状态影响，该 refinement 由 7.1 重新验收。
  验证：local runtime package composition tests 断言 local package 可访问 `/__nextagent/dev/workbench` 页面/API；production packaging exclusion tests 断言生产产物不依赖 `agent-dev-workbench` 且 route/API 未注册。
  证据：`npx vitest run tests/local-runtime-package.test.ts --config vitest.config.release.ts -t "stages a backend-only candidate manifest"` 覆盖 local runtime package 页面/API 可访问；`npx vitest run packages/agent-app/tests/composition.test.ts --config vitest.config.release.ts -t "does not register Agent Dev Workbench"` 覆盖 production app composition route/API/mutation 404；`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts` 覆盖生产 package 不依赖 `agent-dev-workbench`、无 dev profile/feature flag。
  来源：Requirement "Local runtime package exposes an independent Agent Dev Workbench"；Design 决策 0。
- [x] 1.2 新增 `agent-dev-workbench` dev route module/package，并由 `agent-app` local runtime package composition 装配 `/__nextagent/dev/workbench` 页面和 `/__nextagent/dev/workbench/api/*` dev-only namespace；`agent-channel-web` 不拥有该 route。
  验证：route registration tests + code review 检查 route namespace 未进入生产 Web API registry；architecture/source tests 断言页面资产归 `agent-dev-workbench` dev tooling package，可复用 `agent-web` 技术栈但不得进入 `frontend/agent-web`、`agent-channel-web` 或生产打包。
  证据：`npx tsc -b packages/agent-dev-workbench packages/agent-app --pretty false`；`npx vitest run packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts`；`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`。
  来源：Requirement "Local runtime package exposes an independent Agent Dev Workbench"；Design 决策 1、2。
- [x] 1.3 为 dev-only 查询响应添加 runtime schema validation，并保持 DTO 位于 dev workbench owner 内。
  验证：route schema tests 覆盖合法响应和非法 projection failure；`npm run build`。
  证据：`npx tsc -b packages/agent-dev-workbench packages/agent-app --pretty false`；`npx vitest run packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts` 覆盖非法响应触发 500 schema validation。
  来源：Requirement "Local runtime package exposes an independent Agent Dev Workbench"；Design 决策 2。
- [x] 1.4 添加 composition negative tests，断言 workbench 不在 `agent-app` 中装配 model/capability/gateway/policy/context raw decorators、dev raw buffer 或系统 lifecycle hook。
  验证：composition tests / source architecture tests 覆盖 local runtime package 和 production packaging composition。
  证据：`npx vitest run packages/agent-app/tests/composition.test.ts --config vitest.config.release.ts -t "does not register Agent Dev Workbench"` 覆盖 production composition 不注册 workbench route/API/mutation；`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts` 覆盖通用 `create-app` 只暴露 owner-neutral trusted local extension contribution、不静态依赖 workbench、不包含 raw decorator/dev raw buffer/system lifecycle hook，并覆盖 local runtime entrypoint 才选择具体 workbench extension。
  来源：Requirement "Local runtime package exposes an independent Agent Dev Workbench"；Design 决策 1。

## 2. Read-only local conversation and projection-first graph

- [x] 2.1 实现 implementation-local `AgentDevWorkbenchLocalReadPort`，从主路径 owner 的 `working-memory.sqlite` 提供会话、对话、request/run、timeline、trajectory/log refs 的 Owner/Agent-scoped 只读查询，支持按 `agentId`、`sessionId` 和 `requestRunId` 过滤；不得误读 residual `nextagent.sqlite`，不加入稳定 `agent-contracts/gateway` 或 `/api/v1`。
  验证：dev session query tests 覆盖同 owner allowed Agent 读取、跨 owner/无关 Agent 拒绝、过滤、空结果；local runtime package integration test 断言 workbench session read availability 为 available；production packaging composition 下 adapter 不存在。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 SQLite local read adapter 在 trusted Owner Scope 与 allowed Agent graph 内读取、`agentId`/`sessionId`/`requestRunId` 过滤、跨 owner/无关 Agent 空结果、conversation/run/graph/detail/log evidence 查询；`npx vitest run tests/local-runtime-package.test.ts --config vitest.config.release.ts -t "stages a backend-only candidate manifest"` 覆盖 local runtime composition 连接 working-memory SQLite 且 session read availability 为 available；`npx vitest run packages/agent-app/tests/composition.test.ts --config vitest.config.release.ts -t "does not register Agent Dev Workbench"` 覆盖 production composition 不注册；`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts` 覆盖未进入 `agent-contracts/gateway` 或 `/api/v1`。
  来源：Requirement "Workbench reuses the authenticated Owner Scope and trusted Agent graph"；Design 决策 7。
- [x] 2.2 实现 no-mutation guard 测试，断言 workbench 查询不写 session、message、timeline、request run、gateway、audit、metric、trace、memory 或 checkpoint store。
  验证：fake store write spy tests，实际触发会话、对话、graph、detail 和 log evidence 查询并断言无写调用。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 中 SQLite read-port test 实际触发 session/conversation/run/graph/action detail/log evidence 查询，并断言 session、message、request_runs、timeline_events 以及 audit/metric/trace/memory/checkpoint guard 表计数保持不变；adapter 以 `DatabaseSync(..., { readOnly: true })` 打开本地库。
  来源：Requirement "Workbench reuses the authenticated Owner Scope and trusted Agent graph"。
- [x] 2.3 实现 request/run process graph projector，优先从 session/message/requestRun/timeline/trajectory/safe observation/safe projection payload 还原 `request`、`scheduler`、`context`、`context_compaction`、`model`、`capability`、`hook`、`policy`、`gateway`、`stream`、`terminal` 节点和顺序/调用 edge；gateway 节点 v1 仅从 optional `CAPABILITY_COMPLETED.gatewayOperations` 派生，否则标记 coverage unavailable。
  验证：graph reconstruction unit tests 覆盖完整 run、部分缺失 run、terminal outcome、capability gateway detail、gateway child node 拆分规则、gateway unavailable 标记和不解析日志文本构建 graph。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 request/scheduler/context/context_compaction/model/capability/hook/policy/gateway/stream/terminal 节点、sequence/child edge、terminal outcome、`CAPABILITY_COMPLETED.gatewayOperations` 派生 gateway child node、缺失 gateway summary 标记 unavailable，以及日志中出现 gatewayOperations 时不生成 graph node。
  来源：Requirement "Workbench reconstructs completed request processing from existing facts first"；Design 决策 3、5。
- [x] 2.4 实现历史 run 尽量回放和 detail availability 标记，facts 缺失时返回 `unavailable`/`partial`，超大时返回 `truncated`。
  验证：historical graph tests 覆盖缺失 projection payload 的旧 run，不伪造 raw input/output 或动作节点。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖无 timeline 历史 run 只返回 request node 且 graph/effective view 标记 partial、未知 run 返回 unavailable、501 条 timeline 读取被截断并标记 `truncated`，action detail 只返回 safe summary 与 `rawUnavailable`。
  来源：Requirement "Workbench reconstructs completed request processing from existing facts first"；Design 决策 3。
- [x] 2.5 实现 reconstructed run effective view projection，展示 reconstructed/current-view/partial/unavailable 状态，并关联到 `agent_snapshot`、`prompt_template`、`capability_context`、`model_effective_request` 节点或等价详情。
  验证：effective view projection tests 覆盖 run-specific facts、旧 run reconstructed/current-view 标记和缺失状态。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 run-specific model/profile/prompt/capability/tool refs 生成 `reconstructed` effective view、显式 current-view payload 标记为 `current-view`、缺 timeline 历史 run 标记为 `partial`、未知 run 标记 unavailable，并在 model/capability/action detail safe summary 中关联等价 effective view 信息。
  来源：Requirement "Workbench exposes a reconstructed run effective view"；Design 决策 6。
- [x] 2.6 实现 log evidence projection，按 `requestRunId`、`requestId`、`sessionId`、`agentId`、`agentVersion`、`requestContextId`、`capabilityInvocationId` 和 bounded time window 查询已有 runtime diagnostic log / structured safe log excerpts。
  验证：log evidence projection tests 覆盖有匹配日志、无日志、日志轮转/不可访问、超出条数/字节/时间窗口上限，以及不从日志文本构建 graph。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 runtime diagnostic log 匹配、缺失 agent filter 返回空、request/session/agent/version/context/capability refs 全匹配过滤、时间窗口过滤、日志目录缺失 unavailable、扫描/单条/返回条数 bounded，以及日志中出现 graph-like `gatewayOperations` 文本时不生成 graph node。
  来源：Requirement "Workbench exposes bounded log evidence for request/run debugging"；Design 决策 8。
- [x] 2.7 为 workbench SQLite 只读失败补充安全结构化 error log，同时保持原 bounded unavailable 响应和 no-mutation 语义。
  验证：read-port failure test 实际触发缺表异常，断言固定 event、operation 和 safe reason code，且日志不包含数据库路径或原始 SQLite error。
  证据：`npx vitest run packages/agent-dev-workbench/tests/sqlite-read-port.test.ts --config vitest.config.ts` 通过 4 tests；缺表失败返回 `SQLITE_READ_FAILED` availability，并记录 `SQLITE_SCHEMA_UNAVAILABLE` safe diagnostic。
  来源：Requirement "Workbench reuses the authenticated Owner Scope and trusted Agent graph"；Design 决策 7。

## 3. Owner-defined production-safe runtime facts

本节记录已完成的初始实现；其中以工作台缺口驱动字段增加的部分已被 Requirement "Workbench data gaps do not create diagnostic-only business facts" 和任务 7.1 替代，不能作为后续实现依据。

- [x] 3.1 梳理现有 facts 对 context/prompt/capability/model/policy/capability-gateway/run effective view 的支撑缺口，并形成 owner-by-owner 字段来源映射。
  验证：新增 gap analysis test fixture 或 design note，列出每个 graph/detail/effective view 字段来自 `RequestRunRecord`、`RunTimelineEventRecord` 顶层字段、事件对计算、session message、trajectory、existing safe observation、registry stable ref，还是确需新增 safe projection payload；断言可读取/可计算字段不新增。
  证据：新增 `openspec/changes/add-ts-dev-agent-workbench/field-source-map.md`，按 Request/Run、Timeline、Session/Message、Context/Prompt、Model、Capability、Policy/Scheduler/Hook、Log Evidence owner 列出字段来源、是否新增 payload 和缺口；`openspec validate add-ts-dev-agent-workbench --strict`。
  来源：Requirement "Workbench data gaps do not create diagnostic-only business facts"；Design 决策 4。
- [x] 3.1a 定义 safe projection payload schema owner 和 validation 策略；历史方案中的 `GatewayOperationSummary` 因没有实际业务 producer，已由 16.2 删除，不保留 speculative public contract。
  验证：schema owner tests、producer failure tests、architecture tests 覆盖 no private import、no production DTO exposure、no new `agent-contracts/runtime` payload export 和 no speculative gateway summary contract。
  证据：contract/source assertions 覆盖正式 payload validator 只从 owner public export 暴露，且 `GatewayOperationSummary` 不进入 `agent-capability`、`agent-contracts/runtime` 或 `agent-contracts/gateway`。
  来源：Requirement "Workbench data gaps do not create diagnostic-only business facts"；Design 决策 4。
- [x] 3.2 历史实现曾通过 `RenderedModelInputSafeContextProjection` 搬运 context/model-start 字段；该平行 contract 与重复 payload 已由 15.1–15.3 删除并替换为正式 run-bound invocation facts。
  验证：context projection tests 覆盖普通 assembly、compaction、skip/no-op compaction、缺失字段、可计算字段不新增和 forbidden raw leakage。
  证据：该历史实现曾通过显式 local diagnostic policy 附加 context 字段；本次审视确认这会形成调测专用事实，7.1 负责删除并按正式业务事实原则重新验收。既有 budget degradation safety guard 仍须保持。
  来源：Requirement "Workbench data gaps do not create diagnostic-only business facts"；Design 决策 4；其 local-only 实现由 7.1 删除。
- [x] 3.3 历史实现先在默认模型循环持久化已有 `MODEL_INVOCATION_STARTED`、`MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED` timeline events，并补充 production-safe 最小 payload；duration/status/start/end 由事件类型和事件时间计算。该落点覆盖面不足，7.2 将事件生命周期提升到统一 run-bound model invocation boundary 并重新验收所有模型调用方。
  验证：model projection tests 覆盖 success、provider error、abort/cancel、fallback 多尝试、usage、payload validation failure 不影响模型结果、production packaging composition 产生基础 model events 但不产生 workbench enrichment、timeline event 增量兼容性、可计算字段不新增和 forbidden raw leakage。
  证据：`npx vitest run packages/agent-core/tests/model-fallback-orchestration.test.ts --config vitest.config.ts` 覆盖 success、safe error failed、abort/throw failed、fallback primary failed + fallback completed 的 `MODEL_INVOCATION_*` sequence 和 profile ids，断言 payload 不含 raw model output、baseUrl、credentialRef、provider option value、messages/tools，并覆盖 invalid context safe projection 被标记 `projectionUnavailable` 且模型 completion 不受影响；`npx vitest run tests/agent-kernel/run-status-visibility.test.ts --config vitest.config.release.ts` 覆盖 stream projection 对 `MODEL_INVOCATION_*` 仍为安全/兼容/bounded；`npm test` 覆盖所有普通启动路径非回归。
  来源：Requirement "Run-bound model invocations use one runtime timeline boundary"；Design 决策 4、4.1；初始落点由 7.2 替代。
- [x] 3.4 历史实现曾为 capability timeline 增加 descriptor、参数/结果摘要和 speculative gateway summary contract；16.1–16.2 已按“可派生不新增”原则删除，只保留既有 lifecycle fields、`stepId` 与多调用 batch execution facts。
  验证：capability projection tests 覆盖 success、failed result、throw、generated messages/artifacts/context patch summary、gatewayOperations 展示/拆分规则、可计算/已有字段不新增和 forbidden raw leakage。
  证据：`npx vitest run tests/agent-kernel/capability-governance.test.ts --config vitest.config.release.ts` 覆盖 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 新增 descriptor/result safe fields、context patch summary、result/artifact/generated counts、safeResultSummary，且新增 payload 不含 raw argument path、raw result、secret/token 或 generated message，并覆盖 invalid capability safe projection 被标记 `projectionUnavailable` 且工具 completion 不受影响；`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 optional `gatewayOperations` 被 capability detail 展示并只从 `CAPABILITY_COMPLETED` safe payload 派生 gateway child node。
  来源：Requirement "Workbench data gaps do not create diagnostic-only business facts"；Design 决策 4；字段保留与否由 7.1 逐项复核。
- [x] 3.5 在 policy/runtime/core owner 补充必要 safe projection payload：policy 仅补 `policyId`、`policyVersion`、`policyDomain`、`policyPoint`；planning 仅补 `laneKind`、`queueDepthBucket`、`schedulerDecisionCode`；request accepted 仅在 assembly ref 不能历史稳定解析时补 `agentAssemblyHash` 或 `agentAssemblySnapshotRef`；context/policy/runtime/workbench gateway 慢边界 v1 不生成 gateway 节点，仅允许 partial/unavailable 或 log evidence。
  验证：policy/runtime projection tests 覆盖 allow/deny/error、scheduler decision、assembly ref stable/unstable、terminal success/error/cancel、非 capability gateway 不入图、可计算字段不新增和 forbidden raw leakage。
  证据：`npx vitest run packages/agent-core/tests/model-fallback-orchestration.test.ts --config vitest.config.ts` 覆盖 model fallback policy evidence 仍为 `POLICY_APPLIED` 并带 stable routing policy fields；`npx vitest run tests/agent-kernel/capability-governance.test.ts --config vitest.config.release.ts` 覆盖 capability risk policy enrichment；`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 non-capability gateway/log text 不生成 graph gateway node，缺少 gatewayOperations 时 detail 标记 unavailable。
  来源：Requirement "Workbench data gaps do not create diagnostic-only business facts"；Design 决策 4；字段保留与否由 7.1 逐项复核。
- [x] 3.6 为保留的正式 safe payload 添加 runtime schema validation 和 contract/architecture tests，确保字段归属 owner，workbench 只消费 public exports，不 private import，不新增 speculative capability contract、`DevWorkbench*Record`、process graph store、raw snapshot record 或 workbench 私有 fact table。
  验证：schema tests、`npm run test:contract`、`npm run lint:architecture`。
  证据：contract test 覆盖 model/capability/policy 正式 payload validator 的 owner public export、no `agent-contracts/runtime` shared payload schema 和 no speculative gateway summary contract；architecture gate 覆盖 no private import、no `DevWorkbench*Record`、no process graph store、no raw snapshot/workbench fact table。
  来源：Requirement "Workbench data gaps do not create diagnostic-only business facts"；Design 决策 4。

## 4. Workbench detail, log evidence, read-only behavior, and failure isolation

- [x] 4.1 实现 action detail API，从已有 facts 或 safe projection payload 返回 safe input/output summary、status、error code、timing、refs、usage/counts、detailAvailability，并支持 effective view、prompt template、capability context 和 model effective request 详情。
  验证：detail API route tests 覆盖 available、partial、unavailable、truncated、unknown actionId、run-specific effective view 和 historical current-view 标记。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 action detail 返回 safeSummary、payload keys、model usage/finish/toolCallCount、capability counts/context/gateway availability、effectiveView、unknown/missing facts unavailable/partial/truncated，以及 log query refs。
  来源：Requirement "Workbench action details expose safe detail availability"；Requirement "Workbench exposes a reconstructed run effective view"。
- [x] 4.1a 增强节点详情：模型调用显示 `inputTokens`、`outputTokens`、`totalTokens`，provider 未返回 usage 时明确标记不可用；capability 调用按节点 `toolCallId` 关联已有 `ASSISTANT_TOOL_USE` / `CAPABILITY_RESULT` messages，显示该调用的原始参数和结果，不混入同 run 其他工具调用，不新增 raw capture 或 durable fact。
  验证：action detail projector tests 覆盖 usage available/unavailable、单 run 多工具调用按 `toolCallId` 精确关联、参数/结果缺失标记；browser smoke 覆盖 Token 用量和工具参数/结果可见。
  证据：`npx vitest run packages/agent-model/tests/openrouter-provider.test.ts --config vitest.config.ts` 覆盖流式请求启用 `stream_options.include_usage` 并归一化 input/output/total token；`npx vitest run packages/agent-dev-workbench/tests/sqlite-read-port.test.ts packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts` 覆盖同 run 多工具调用按 `toolCallId` 精确关联原始参数/结果且不串节点；`npx vitest run packages/agent-dev-workbench/tests/browser-smoke.test.ts --config vitest.config.ts` 覆盖 Token 消耗面板与工具参数/结果界面可见。
  来源：Requirement "Workbench action details expose safe detail availability"；Design 决策 5。
- [x] 4.1b 收敛节点详情与 Agent 配置视图：模型详情只保留专用的工具、Skill、Agent 和 Token 消耗展示，generic safe projection 不重复 usage/visible capability/rendered tool 字段，概览移除可用性；`HOOK_INVOKED` 节点显示 lifecycle stage，详情显示 hookId 等完整 metadata；local workbench 仅在 registry 返回的 `agentId`、`agentVersion`、`agentAssemblyRef` 与 run 精确匹配时展示完整 compiled `AgentAssembly`，不得回退当前配置。
  验证：projection/browser tests 覆盖字段去重、工具/Skill/Agent、Hook 节点与详情；assembly exact-ref success 和 ref mismatch/unavailable negative tests；完整配置 runtime schema/build validation。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts --silent` 通过 3 files / 9 tests，覆盖模型专用字段、Agent 完整配置、exact-ref success/ref mismatch 和 Hook stage；实际 `npm run dev:fullstack` 页面验证 Token/工具/Skill/Agent 无重复、Hook 图节点与详情正确、`default-agent:v1` 完整配置可见且 browser console 无错误；`npm run lint:architecture` 通过并断言 dev workbench 未新增未授权 contract subpath 依赖。
  来源：Requirement "Workbench exposes a reconstructed run effective view"；Requirement "Workbench action details expose safe detail availability"；Design 决策 6。
- [x] 4.1c 增加模型 Prompt 近似视图与 Bash 命令预览：只读解析 run 精确 prompt template ref、selected messages 和 rendered tools，明确展示缺失引用和不可重放因素；Bash 图节点按 `toolCallId` 展示 bounded command preview，详情保留完整参数；统一复用 scoped run inspection messages，不改 context/model/capability 业务路径，不新增 raw capture、timeline/log payload 或 durable store。
  验证：read-port tests 覆盖模板精确解析、selected refs 顺序/缺失、近似限制、Bash command 单行截断、完整详情及同 run 其他工具不串节点；browser smoke 覆盖 Prompt 分区、非权威提示、缺失因素和 Bash 命令预览；composition/architecture tests 覆盖 resolver 仅由 local runtime 注入且生产包不注册。
  证据：`npx vitest run packages/agent-dev-workbench/tests/sqlite-read-port.test.ts packages/agent-dev-workbench/tests/browser-smoke.test.ts packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts` 通过 3 files / 9 tests，覆盖 prompt exact-ref resolver、selected message 顺序与缺失、限制原因、Bash command preview 的 160 字符单行截断、Read/Bash 节点隔离、完整 command/result 和 G6 canvas 实际文字渲染；`npm run build`、`npm test`（74 files / 527 tests，另 1 skipped）、`npm run test:contract`（28 / 233）、`npm run lint:architecture`（28 / 148）与 `openspec validate --all --strict`（177）均通过。
  来源：Requirement "Workbench action details expose safe detail availability"；Design 决策 5。
- [x] 4.1d 收敛 selected-node 生效视图并补齐 subagent 调测：run Agent identity/assembly/config 保持 run-wide，模型/Prompt/工具上下文仅在 model 节点展示；Agent 列表合并 compiled assemblies 与历史 session，包含零 session parent-scoped 和 invocation-only subagent；`AGENT` capability 投影为 subagent 节点，按 canonical invocation idempotency key 精确关联 child Session/Run，详情可查看 delegated prompt/result 并导航 child run，不做时间兜底。
  验证：read-port tests 覆盖 `PARENT` subagent、`userInvocable=false + BOUND` invoked-only Agent、historical agent、parent refs、AGENT node 分类、成功 child link 和 wrong idempotency/parent negative cases；browser smoke 覆盖非模型节点无模型上下文、Agent 信息、subagent node/detail/child navigation；composition/architecture tests 覆盖 assembly inventory resolver 仅由 local runtime 注入且生产包不注册。
  证据：`npx vitest run packages/agent-dev-workbench/tests/sqlite-read-port.test.ts packages/agent-dev-workbench/tests/routes.test.ts packages/agent-dev-workbench/tests/browser-smoke.test.ts --config vitest.config.ts` 通过 3 files / 9 tests，覆盖 compiled/historical/zero-session inventory、parent-scoped 与 invocation-only subagent 分类、parent refs、canonical idempotency child link、缺失 child negative case、非模型节点无模型上下文、subagent prompt/result 和 child run navigation；浏览器画布渲染 `Subagent · child-agent`，无 console/page error；`npx tsc -b --pretty false`、`npm test`（74 files / 527 tests，另 1 skipped）、`npm run test:contract`（28 / 233）、`npm run lint:architecture`（28 / 148）与 `openspec validate --all --strict`（177）均通过。
  来源：Requirement "Workbench action details expose safe detail availability"；Requirement "Workbench exposes a reconstructed run effective view"；Design 决策 5、6、7。
- [x] 4.2 实现 `agent-dev-workbench` 自包含轻量页面，展示会话列表、对话视图、run 列表、process graph、节点详情抽屉和 log evidence 面板；允许少量 package-owned HTML/CSS/JS asset 或服务端模板。
  验证：轻量页面 smoke tests 或 Playwright smoke 截图；code review 检查页面不调用 SSE/WS 或 mutation API，页面 asset 只归 `agent-dev-workbench`。
  证据：`npx vitest run packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts` 覆盖自包含 HTML 页面包含会话、conversation、run、process graph、detail、log evidence 入口，页面源码不包含 SSE/WS 或 mutation fetch；`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts` 覆盖页面资产归 `agent-dev-workbench`、未进入 `agent-channel-web`。
  来源：Requirement "Workbench is non-realtime and read-only"；Design 决策 2。
- [x] 4.2a 将工作台页面替换为 `agent-dev-workbench` package-owned dev frontend artifact，复用 `frontend/agent-web` 的 React/Vite/Ant Design/G6 技术栈设计整体交互，使用图形化 process graph 呈现处理图；不得在 `frontend/agent-web` 新增 route/feature，不得进入 `agent-channel-web` 或生产 package。
  验证：route/page tests 覆盖 dev route 服务 workbench frontend shell 和静态资产；architecture tests 覆盖 React/Vite/AntD/G6 只在 `agent-dev-workbench` dev artifact 中使用、`frontend/agent-web` 无 workbench route/feature、页面源码不包含 SSE/WS 或 mutation fetch；浏览器 smoke 覆盖会话、run、图形化 graph、详情和日志证据交互。
  证据：`npm run build --workspace @nextagent/agent-dev-workbench` 构建 TS 和 Vite dev frontend artifact；`npx vitest run packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts` 覆盖页面/API/asset namespace/no mutation；`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts -t "Agent Dev Workbench"` 覆盖 dev-only 边界和 `agent-web` exclusion；`npx vitest run packages/agent-dev-workbench/tests/browser-smoke.test.ts --config vitest.config.ts` 覆盖 Playwright 浏览器渲染：无 console/page error、G6 canvas 宽度>500 且高度>300、非空白像素>100、四个中文页签（对话/详情/运行配置/日志）完整可见且无重复 Agent 页签、Agent/会话/运行列表有数据；`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run build`、`openspec validate --all --strict` 均通过。
  来源：Requirement "Local runtime package exposes an independent Agent Dev Workbench"；Requirement "Workbench is non-realtime and read-only"；Design 决策 2。
- [x] 4.3 实现 running run 非实时展示：不订阅 SSE/WS，终态前只显示 running 或不可用详情。
  验证：route/page tests 断言 running run 不打开 stream transport，终态后 graph 可查询。
  证据：`npx vitest run packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts` 覆盖 running run graph 返回 running/partial，页面源码不包含 `EventSource`、`WebSocket` 或 `/stream`；`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖终态 completed run graph 查询。
  来源：Requirement "Workbench is non-realtime and read-only"。
- [x] 4.4 添加 no-mutation route negative tests，实际请求 workbench 页面/API 并断言没有 retry、edit、cancel、replay、resume、fork、answer pending input 或配置修改 endpoint。
  验证：dev route inventory tests。
  证据：`npx vitest run packages/agent-dev-workbench/tests/routes.test.ts --config vitest.config.ts` 覆盖 dev namespace 下 retry/cancel/replay/fork/pending answer mutation routes 均为 404；architecture test 断言 workbench source 不注册 POST/PUT/DELETE mutation routes。
  来源：Requirement "Workbench is non-realtime and read-only"。
- [x] 4.5 添加 projection/detail/page/log evidence failure non-interference tests。
  验证：integration tests 模拟 safe projection failure、projection serialization failure、detail query failure、log source unavailable 和 page rendering failure，并断言 request terminal outcome 不变。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 graph/detail/log read projection throw 时 dev API 返回固定 `AGENT_DEV_WORKBENCH_QUERY_FAILED`、不泄漏异常原文/raw token、页面仍可渲染、fake business write counters 为 0；同套测试覆盖 invalid response runtime schema validation 只影响该 dev query。
  来源：Requirement "Workbench projection failures do not affect normal execution"。
- [x] 4.6 添加 forbidden raw leakage negative tests，断言 raw prompt/model/tool/provider/credential/secret/token/attachment/path 内容不会因工作台进入 `ObservabilityObservationEvent`、structured log、audit、metrics、trace、canonical timeline、session message、gateway record、checkpoint 或 memory。
  验证：fake sink/store assertions；`npm test` 相关测试。
  证据：`npx vitest run packages/agent-core/tests/model-fallback-orchestration.test.ts --config vitest.config.ts` 断言 model timeline safe payload 不含 raw output、baseUrl、credentialRef、messages/tools；`npx vitest run tests/agent-kernel/capability-governance.test.ts --config vitest.config.release.ts` 断言 capability safe projection 新增字段不含 raw args/result/path/secret/token；`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 断言 workbench projection errors 不泄漏 raw prompt/token，log evidence 不生成 graph truth；`npm test` 和 `npm run lint:architecture` 全量通过 existing observability/redaction/leakage gates。
  来源：Requirement "Workbench data gaps do not create diagnostic-only business facts"；Requirement "Workbench projection failures do not affect normal execution"。
- [x] 4.7 添加 historical/current-view marking tests，断言缺少 run-specific projection payload 的历史 run 必须标记为 reconstructed/current-view/partial/unavailable，不把当前 Agent registry/model profile/prompt template/capability binding 伪装成历史真实配置。
  验证：effective view historical tests。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖缺少 run-specific projection payload 的历史 run 标记 `partial` 且不填充当前 registry/model/prompt/capability 信息；显式 current-view payload 才标记 `current-view`，避免把当前配置伪装为历史事实。
  来源：Requirement "Workbench exposes a reconstructed run effective view"；Design 决策 6。
- [x] 4.8 实现 log evidence API 和页面关联入口，从 run、graph node 或 action detail 展示 bounded safe log excerpts，不提供实时 tail/SSE/WS。
  验证：route/page tests 覆盖 `GET /__nextagent/dev/workbench/api/runs/:requestRunId/logs`、bounded response schema、node-to-log refs、missing/truncated diagnostics，以及页面不打开日志流。
  证据：`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 logs API、bounded/truncated/unavailable diagnostics、run ref 查询、action detail refs 构造 node-to-log 查询参数、页面不包含 EventSource/WebSocket/stream，并且日志文本不参与 graph 构建。
  来源：Requirement "Workbench exposes bounded log evidence for request/run debugging"；Requirement "Workbench is non-realtime and read-only"。
- [x] 4.9 添加 log evidence separation negative tests，断言工作台不会新增或修改 structured log/runtime diagnostic log schema，不把 raw prompt/model/tool/provider/credential/path 写入日志，不把 log offset/file path 作为业务主键。
  验证：fake log sink assertions、route schema tests、architecture/source assertion tests。
  证据：`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts` 断言 `agent-dev-workbench` 不创建/写入日志、不新增 structured/runtime diagnostic log schema owner、不使用 log/file offset 或 file path refs；`npx vitest run packages/agent-dev-workbench/tests --config vitest.config.ts` 覆盖 log evidence 只读 bounded excerpts 且 refs 使用 stable request/run/action refs。
  来源：Requirement "Workbench exposes bounded log evidence for request/run debugging"；Design 决策 8。

## 5. Architecture and validation

- [x] 5.1 添加 architecture tests，禁止生产 package path 依赖 dev workbench internals，禁止 `agent-channel-web` 拥有 runtime lifecycle 或日志事实 owner，禁止 `agent-app` 为 workbench 装配 raw decorators/dev raw buffer/system hook。
  验证：`npm run lint:architecture`。
  证据：`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts` 覆盖 production app package 不依赖 `@nextagent/agent-dev-workbench`、`agent-channel-web` 不包含 workbench route/package、backend-only/with-frontend entrypoints 不包含 workbench、`agent-app` 不含 raw decorator/dev raw buffer/system lifecycle hook；`node tests/architecture/package-manifest-policy.cjs` 通过 package manifest dependency policy。
  来源：Design 决策 1、2、4、8。
- [x] 5.1a 添加 compatibility tests，断言 production packaging composition 不注册 workbench route/API、不新增用户 stream DTO 或 `/api/v1` 字段；所有启动形态的新 run 都产生 production-safe `MODEL_INVOCATION_*` events，stream projection 对这些已有 event types 保持安全、兼容、bounded。该历史任务中的 local-only projection 路径由 7.1 明确替代并删除。
  验证：production packaging exclusion tests、stream projection tests、route inventory tests。
  证据：`npx vitest run packages/agent-app/tests/composition.test.ts tests/local-runtime-package.test.ts --config vitest.config.release.ts -t "does not register Agent Dev Workbench|stages a backend-only candidate manifest"` 覆盖 production composition 不注册 workbench route/API、local runtime package 才注册；`npx vitest run tests/agent-kernel/run-status-visibility.test.ts --config vitest.config.release.ts` 覆盖用户 stream projection 对 existing model event types 安全兼容；`npm run lint:architecture` 覆盖 no `/api/v1` workbench route/DTO。模型事件统一边界与 local-only projection 清理由 7.1、7.2 重新验收。
  来源：Design "Compatibility Impact"。
- [x] 5.2 运行 OpenSpec 和常规验证，并记录任务完成证据。
  验证：`openspec validate add-ts-dev-agent-workbench --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  证据：`openspec validate add-ts-dev-agent-workbench --strict` 通过；`openspec validate --all --strict` 通过 184 items；`npm run build` 通过；`npm test` 通过 82 files / 572 tests（1 file / 1 test skipped）；`npm run test:contract` 通过 28 files / 233 tests；`npm run lint:architecture` 通过 dependency-cruiser、package manifest policy、29 architecture files / 177 tests。
  来源：所有 requirements 和 design verification map。

## 6. Owner-scoped local extension refinement

- [x] 6.1 移除通用 `create-app` 中 workbench 专用 registration/context/enablement，以 owner-neutral local protected-route contribution 替代；具体 workbench extension 只由 local runtime entrypoint 选择，生产 composition 不注册。曾加入的 local diagnostic projection policy 由 7.1 明确删除。
  验证：architecture/source tests 断言 `create-app.ts` 不包含 `DevWorkbench`/`devWorkbenchRegistration`，local route 可用，production route 404；local/production 对相同主路径动作产生相同业务事实由 7.1 重新验收。
  证据：generic extension contract、channel registration 与 diagnostic projection 分别归 `composition-contracts.ts`、`channel-composition.ts`、`request-runtime-composition.ts`；具体 dynamic registration 仅在 local runtime bindings；`packages/agent-app/tests/composition.test.ts`、`tests/local-runtime-package.test.ts` 与完整 architecture gate 通过。
  来源：Requirement "Local runtime package exposes an independent Agent Dev Workbench"；Design 决策 1。
- [x] 6.2 将 workbench page/API 注册到与普通 Agent Web 相同的 local-auth protected scope；read adapter 的 session/conversation/run/graph/detail/log 查询全部接收 trusted Owner Scope 和 allowed Agent graph，拒绝跨 owner、跨无关 Agent 与客户端伪造 `agentId`。
  验证：route/read-port tests 覆盖同 owner allowed root/subagent、other tenant、other subject、unrelated Agent、同名 session、child navigation 和无认证 401；所有 negative case 不泄漏事实存在性且无写入。
  证据：`packages/agent-channel-web-auth-local/tests/protected-prefix.test.ts` 覆盖 unauthenticated 401 与登录后同 protected scope；workbench SQLite/read route tests 覆盖 trusted owner、allowed Agent graph、跨 owner/无关 Agent空结果及客户端 agent filter 不越权；相关 targeted tests 通过。
  来源：Requirement "Workbench reuses the authenticated Owner Scope and trusted Agent graph"；Design 决策 7。
- [x] 6.3 为通用 frontend hosting 增加受信任 same-origin script contribution；由 `agent-dev-workbench` 提供 Shadow DOM/custom-element 悬浮 launcher，local with-frontend 才注入，production/无 workbench composition 不注入，`frontend/agent-web` 不包含 workbench 实现或条件分支。
  验证：hosting unit tests、architecture tests、browser smoke 分别覆盖 script validation/injection、no agent-web dependency、按钮存在/不存在。
  证据：frontend hosting test 覆盖缺省无注入、same-origin `.js` 注入与外部 URL 拒绝；architecture gate 断言 agent-web/channel-web 无 workbench route/实现；browser smoke 覆盖 workbench-owned launcher。
  来源：Requirement "Local frontend receives a workbench-owned current-session launcher"；Design 决策 2。
- [x] 6.4 实现普通页面当前 `#/session/:sessionId` 到 `/__nextagent/dev/workbench?sessionId=...` 的深链接，并由工作台在 owner/agent-scoped 列表内选择该 session；无权或不存在参数显示 unavailable，不回退到其他 session。
  验证：launcher unit/browser tests 和 workbench browser smoke 覆盖 current session、无 session、URL encoding、无权 session。
  证据：route test 验证 launcher asset；browser smoke 验证当前 session 参数跳转、无权 deep link bounded unavailable 且不 fallback；最终 browser smoke 1 file / 1 test 通过。
  来源：Requirement "Local frontend receives a workbench-owned current-session launcher"；Design 决策 7.1。
- [x] 6.5 删除重复 `Agent` 页签，将 `生效` 重命名为 `运行配置`，完整 Agent configuration 仅保留一处；四个页签完整可见。subagent 节点保留精确 child refs，并提供节点内显式直接导航入口及 browser history 可返回父 run。
  验证：component/browser tests 断言恰好四个页签、无 Agent 页签、配置不重复、subagent direct navigation/back 可用。
  证据：browser smoke 断言 `对话/详情/运行配置/日志` 四页签完整可见且无 Agent 页签，并通过 subagent 节点直接导航 child run 与 browser back 返回父 run。
  来源：Requirement "Workbench uses four non-duplicated context tabs"；Requirement "Workbench action details expose safe detail availability"。
- [x] 6.6 清理被替代的 unscoped local read、旧 registration、重复配置 UI 与旧 launcher 路径；执行 OpenSpec、build、全部测试、contract、architecture、workbench browser smoke，并验证当前分支与最新 `origin/main` 无合并冲突。
  验证：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、workbench browser smoke、dead-code/source audit、`git merge-tree` 或等价无冲突检查。
  证据：分支已 rebase 到最新 `origin/main`，最终 `git merge-base --is-ancestor origin/main HEAD` 通过且 `HEAD...origin/main` 为 `2 0`；`npm run build` 通过；`npm test` 通过 82 files / 572 tests（1 file / 1 test skipped）；`npm run test:contract` 通过 28 files / 233 tests；`npm run lint:architecture` 通过 dependency-cruiser、manifest policy、29 files / 177 tests；workbench browser smoke 通过；OpenSpec 184 items strict validation 通过。
  来源：全部新增 requirements 与完成标准。

## 7. Business-fact and run-bound interaction refinement

- [x] 7.1 删除 `localDiagnosticSafeProjection` 及所有 workbench-oriented/local-only timeline enrichment 路径；逐字段审查现有新增 payload，能从已有事实或 run-bound assembly 读取/计算的字段删除重复写入，只有 owning domain 从生产运行、审计、恢复或故障诊断角度独立需要的字段保留为正式业务运行事实。
  验证：field-source map 与 producer tests 逐字段对应；local/production composition 对相同动作产生相同业务事实；architecture/source negative tests 断言不存在 workbench enrichment flag、local-only timeline payload 或 workbench private fact store。
  证据：删除 app/core 的 `localDiagnosticSafeProjection` composition 与依赖字段；移除重复 `renderedToolNames` context/model projection，保留 owner-defined context selection/disclosure facts；`rg -n localDiagnosticSafeProjection packages tests` 无命中，build/contract/architecture gates 通过。

- [x] 7.2 将 `MODEL_INVOCATION_*` 从默认 Agent loop 提升为统一 run-bound model invocation boundary：所有 RequestRun 内调用者通过该边界调用 `ModelInvocationService`，runtime timeline port 负责 canonical event；`agent-model` 不依赖 timeline，非 run-bound 调用不生成 run event。
  验证：characterization/contract tests 覆盖 default agent、workflow、context summary 或其他现存 run-bound model caller，每次 attempt 恰好 started + completed/failed；覆盖 fallback、abort、throw、safe error、非 RequestRun 调用和 no-duplicate negative case；architecture tests 断言 `agent-model` 不依赖 runtime timeline。
  证据：新增 `RunBoundModelInvocation` 统一 started/completed/failed、safe payload 和 terminal dedupe；默认 loop 仅消费该边界，不再直接 author 模型事件；model fallback 定向测试 11 项与 contract source boundary test 通过，`agent-model` 不依赖 runtime timeline。

- [x] 7.3 修正模型节点能力分类：以本次调用实际 disclosure ids 与 exact run-bound `AgentAssembly.capabilityBindings` 精确关联并按 `capabilityType` 展示工具、Skill、Agent；不得依赖 `CAPABILITY_*` 是否发生、不得以“非工具”推断 Skill、不得混入未披露 binding。
  验证：projection/browser tests 覆盖未被调用但已披露的 Skill 可见、未披露 Skill 不可见、Tool/Skill/Agent 分类、assembly ref mismatch/unavailable 和无 capability event 的模型调用。
  证据：projector 先读取 invocation disclosure ids，再与 exact-ref assembly bindings 关联 TOOL/SKILL/AGENT；不再读取 capability event 推断类型，也不再合并全部 assembly binding；SQLite projection tests 与 browser smoke 通过。

- [x] 7.4 对话和日志以当前 `requestRunId` 服务端过滤：conversation read query 同时校验 owner、agent、session/run binding 并默认只返回当前 run messages；日志继续以 runId 为必需条件，节点 refs 只在 run 内收窄。
  验证：同 session 多 run tests 断言无跨 run 消息/日志，跨 owner/agent/session-run mismatch 返回空或 bounded unavailable；browser smoke 断言切换 run 后对话和日志同步切换，不能仅靠 highlight/client filtering。
  证据：conversation API schema 强制 `requestRunId`，SQLite query 同时过滤 owner/agent/session/run；前端随 selected run 重新加载 conversation/logs；route 断言缺 runId 返回 400，SQLite 断言 session/run mismatch 为空，browser smoke 通过。

- [x] 7.5 增强 workbench-owned launcher：默认半透明，hover/focus/dragging 完全不透明并有视觉反馈；使用 Pointer Events 支持 viewport 内拖动，以移动阈值区分 click/drag，拖动释放不跳转，位置不写配置或持久化。
  验证：launcher unit/browser tests 覆盖 click deep-link、drag no-navigation、viewport clamp、hover/focus/drag opacity、pointer cancel，以及无 workbench composition 时无 launcher。
  证据：Shadow DOM launcher 使用 Pointer Events、5px threshold、pointer capture、viewport clamp 与 page-lifetime position；CSS 默认 opacity `.72` 且 hover/focus/dragging 为 1；route assertions 与 browser deep-link smoke 通过。

- [x] 7.6 清理被 7.1–7.5 替代的代码、测试和文档措辞，并完成全量验证。
  验证：`rg` 断言无 `localDiagnosticSafeProjection`、local-only workbench enrichment 和默认 loop 私有 model event lifecycle；`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、workbench browser smoke、`openspec validate --all --strict`、`git diff --check` 全部通过。
  证据：`npx tsc -b --force --pretty false`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、workbench SQLite/routes/browser smoke、`openspec validate --all --strict`（184/184）通过；`git diff --check` 通过。

## 8. Run summary and graph interaction refinement

- [x] 8.1 为 run list dev DTO 增加从该 run 已持久化 root request message 查询时派生的摘要；不得复用当前 selected run conversation state，也不得新增业务字段。
  验证：同 session 多 run 的 read-port/component/browser tests 断言每个 run 始终显示自己的摘要。

- [x] 8.2 模型节点能力分类改为“本次 disclosure ids × run-bound assembly 下 CapabilityCatalog descriptors”，覆盖默认启用 Tool、显式 binding Tool、Skill 和 Agent；不得只依赖 assembly binding，也不得展示未披露能力。
  验证：projection tests 覆盖默认 Tool、binding Tool、Skill、Agent、未披露能力和 resolver unavailable/partial。

- [x] 8.3 Capability lifecycle 按 `toolCallId` 配对与去重，一个逻辑调用只生成一个 capability/subagent 节点；交错 started/completed/failed、重复 terminal 和 delta 不得生成重复节点。
  验证：以 `call_019f50621d83730380439213` 等稳定 fixture 覆盖并发/交错/重复事件，断言每个 toolCallId 恰好一个节点。

- [x] 8.4 节点 selection 与 graph data/layout 解耦，选择详情时保留当前 zoom/pan；仅初次加载、run 切换、resize 或显式“适配”触发 fitView。
  验证：browser test 缩放后点击节点并断言 zoom/viewport 不回到初始值。

- [x] 8.5 修正 subagent child run correlation：Session 仍按 canonical parent invocation idempotency key 精确匹配，child RequestRun 只校验 child session/agent 与 parentRunId/parentRequestId，不错误要求自身 idempotency key 等于父调用 key；详情提供明确钻取按钮。
  验证：child run 使用独立 idempotency key 时仍可导航；跨 parent/agent、ambiguous child 继续 unavailable。

- [x] 8.6 在工作台顶栏增加 same-origin “返回对话”入口，跳转当前 `/#/session/:sessionId`；无 selected session 时禁用或隐藏，不引入 agent-web 依赖。
  验证：route/browser tests 覆盖当前 session、child session 和无 session 状态。

- [x] 8.7 重建 workbench artifact 并执行定向与全量验证。
  验证：workbench routes/SQLite/browser smoke、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`、`git diff --check`。
  证据：workbench 3 files / 9 tests、全量单测 82 files / 572 tests、contract 28 files / 234 tests、architecture 29 files / 177 tests、OpenSpec 184/184 均通过；workbench production artifact 已重建。

## 9. Parallel Tool batch trajectory refinement

- [x] 9.1 在 capability owner 将实际 Tool batch execution mode 建模为 production-safe timeline fact；多调用写入 `toolBatchExecutionMode`、`toolBatchOrdinal`、`toolBatchSize`，单调用不写，local/production 行为一致。
  验证：parallel Tool loop 与 request-local serialization characterization tests 分别断言 `PARALLEL` 和 `SERIAL` payload。

- [x] 9.2 工作台按 canonical batch facts 投影并行 fork/join edges 和 sibling layout；串行及缺少新字段的历史 run 保持 sequence，不从日志、时间或 `stepId` 猜测。
  验证：SQLite projector 与 browser graph tests 覆盖 5-call parallel group、serialized group 和 legacy events。

- [x] 9.3 重建 workbench artifact 并完成定向、OpenSpec 与全量验证。
  验证：core parallel tool tests、workbench tests、build、unit、contract、architecture、OpenSpec strict validation、`git diff --check`。
  证据：并行轨迹与 workbench 定向 4 files / 20 tests、全量 unit 82 files / 573 tests、contract 28 files / 234 tests、architecture 29 files / 177 tests、OpenSpec 184/184 通过；workbench artifact 已重建。

## 10. Parallel graph visual layout refinement

- [x] 10.1 重构 workbench graph layout：主链与 parallel batch 分块排布，并行成员按可用宽度 bounded wrap，join target 位于完整批次之后；不修改 graph/runtime facts。
  验证：layout tests 覆盖 2/5/8 个并行节点、窄/宽 viewport、节点不重叠且坐标在 canvas bounds 内。

- [x] 10.2 为 parallel fork/join edge 生成共享正交 routing corridor，避免穿过节点和遮挡文字；保留 sequence/child edge 视觉区分与缩放交互。
  验证：browser smoke 加载 5-call batch，断言无 console/page error、节点布局不重叠并生成 parallel route control points。

- [x] 10.3 重建 workbench artifact 并完成定向与全量验证。
  验证：workbench browser/tests、build、unit、contract、architecture、OpenSpec、`git diff --check`。
  证据：layout/browser 定向 2 files / 5 tests、全量 unit 83 files / 577 tests、contract 28 files / 234 tests、architecture 29 files / 177 tests、OpenSpec 184/184 通过；workbench artifact 已重建。

## 11. Explicit parallel-group semantics refinement

- [x] 11.1 为每个 parallel batch 派生 labelled G6 combo/group boundary，并在成员节点展示 `并行 ordinal/size`；只修改 workbench frontend projection。
  验证：layout/browser tests 断言 5-call batch 只有一个 `并行执行 · 5` group，五个成员均显示 ordinal/size。

- [x] 11.2 调整 parallel routes：fork 使用左侧 group bus，join 使用右侧 group bus，跨行路径不穿过 sibling node，不形成成员间伪串行竖线。
  验证：route unit tests 断言 fork/join control points 位于 group bounds 外侧，browser smoke 无渲染错误。

- [x] 11.3 重建 artifact 并完成定向及全量验证。
  验证：workbench tests/build、unit、contract、architecture、OpenSpec、`git diff --check`。
  证据：layout/browser 定向 2 files / 5 tests、全量 unit 83 files / 577 tests、contract 28 files / 234 tests、architecture 29 files / 177 tests、OpenSpec 184/184 通过；workbench artifact 已重建。

## 12. Parallel group edge simplification

- [x] 12.1 将 G6 visual projection 中的 member-level parallel edges 去重折叠为 `前序 action -> parallel combo -> 后序 action` 两条 group-level edge；backend graph DTO 保持不变。
  验证：visual edge tests 对 2/5/8 member batch 均断言只产生两条 parallel edge，盒内无成员连线。

- [x] 12.2 删除被替代的 group-side bus/control-point 实现和测试，保留 combo label、成员 ordinal/size、child edge 与 sequence edge。
  验证：browser smoke 断言并行组和成员文本存在、无 console/page error；source/unit tests 断言无冗余 member route。

- [x] 12.3 重建 artifact 并完成定向及全量验证。
  验证：workbench tests/build、unit、contract、architecture、OpenSpec、`git diff --check`。
  证据：layout/browser 定向 2 files / 7 tests、全量 unit 83 files / 579 tests、contract 28 files / 234 tests、architecture 29 files / 177 tests、OpenSpec 184/184 通过；workbench artifact 已重建。

## 13. Parallel group orthogonal routing refinement

- [x] 13.1 将两条 parallel combo 级外部边改为正交 polyline，保留盒子级连接与盒内无成员线的简化语义。
  验证：layout tests 断言 sequence 为 line、两条 parallel group edge 均为 polyline；browser smoke 无渲染错误。

- [x] 13.2 重建 workbench artifact 并完成定向验证。
  验证：workbench layout/browser tests、TypeScript build、OpenSpec strict validation、`git diff --check`。
  证据：layout/browser 定向 2 files / 7 tests、workbench TypeScript/build、OpenSpec change strict validation、`git diff --check` 通过；workbench artifact 已重建。

## 14. Stable vertical backbone and combo anchors

- [x] 14.1 将 parallel group 之间的 sequence backbone 改为 bounded multi-column serpentine grid，并行成员仍作为独立区块 bounded wrap；child/gateway 分支保持侧向布局。
  验证：2/5/8 member layout tests 断言普通连续节点优先共用一行、节点不重叠且不越界，并行后序位于完整 group 之后。

- [x] 14.2 为 node/combo 定义 top/bottom/right/left anchors；同一行 sequence 使用 side-to-side，换行与 parallel edge 使用 bottom-to-top，禁止并行盒子级连线连接左右边界。
  验证：visual edge tests 断言同一行 sequence 使用 right-to-left anchors，两条 parallel edge 使用 bottom-to-top 且无成员 endpoint。

- [x] 14.3 重建 workbench artifact 并完成定向及全量验证。
  验证：layout/browser tests、workbench build、unit、contract、architecture、OpenSpec strict validation、`git diff --check`。
  证据：layout/browser 定向 2 files / 7 tests、全量 unit 83 files / 579 tests、contract 28 files / 234 tests、architecture 29 files / 177 tests、OpenSpec change strict validation、`git diff --check` 通过；workbench artifact 已重建。

## 15. Model invocation business facts without duplicate context projection

- [x] 15.1 删除 `RenderedModelInputSafeContextProjection`、`RenderedModelInput.safeContextProjection`、context-engine producer/schema/export 和对应 contract test，不保留调测专用或平行 context contract。
  验证：source/contract assertions 无 `safeContextProjection` 或 `RenderedModelInputSafeContextProjection`；`agent-contracts/context` 恢复既有 `RenderedModelInput` shape。

- [x] 15.2 将必要事实建模为正式 run-bound model invocation facts：prompt template refs、selected message refs 直接来自本轮 `ContextAssembly`，`disclosedCapabilityIds` 与 `modelMessageCount` 从最终 `ModelInvocationRequest` 计算；不写 raw messages/tools。
  验证：model fallback tests 断言 success/fallback/zero-tool 路径记录实际 disclosure 和 message count，且 payload 不包含 raw prompt、message、tool schema、credential 或 provider option value。

- [x] 15.3 context budget/compression/attachment degradation events 补充 `stepId` 关联；工作台消费正式 disclosure ids 并从 catalog/assembly 派生分类和名称，兼容历史 `visibleCapabilityIds` 但不再生产该 alias。
  验证：context event tests、workbench projection tests 与 negative source assertions。

- [x] 15.4 完成 build、unit、contract、architecture、OpenSpec strict validation 和 `git diff --check`。
  验证：`npm run --workspace @nextagent/agent-core build`、`npm run --workspace @nextagent/agent-dev-workbench build`、`npm run build`、`npm test`（579 passed / 1 skipped）、`npm run test:contract`（234 passed）、`npm run lint:architecture`（177 passed）、`openspec validate --all --strict`、`git diff --check`。

## 16. Source-only frontend and capability fact cleanup

- [x] 16.1 将 `packages/agent-dev-workbench/web-dist` 从 Git 跟踪中删除并加入 `.gitignore`；前端 bundle 只由 build/local package staging 生成，缺失时使用已有 build-unavailable 页面。
  验证：`git ls-files packages/agent-dev-workbench/web-dist` 无输出；build:web 可重新生成 ignored artifact；route tests 在无 artifact 时仍返回 bounded 页面。

- [x] 16.2 删除 capability timeline 中可由 persisted tool-use/result messages 或 exact run-bound catalog/assembly 派生的 descriptor、argument/result/effect summary 字段，并删除无实际 producer 的 `GatewayOperationSummary` public export；保留既有 lifecycle fields、`stepId` 与多调用 batch execution facts。
  验证：capability characterization/contract tests 断言单调用不写重复详情，多调用准确写 PARALLEL/SERIAL mode、ordinal、size，工作台仍按 `toolCallId` 展示参数/结果。

- [x] 16.3 完成定向 build/test、OpenSpec strict validation、全量门禁和 `git diff --check`，随后修订本地 commit。
  验证：agent-core build、workbench build:web（产物 ignored）、capability/workbench/contract 定向测试、`npm run build`、`npm test`（579 passed / 1 skipped）、contract（233 passed）、architecture（177 passed）、OpenSpec all strict 和 `git diff --check`。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/dev-agent-workbench/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/observability.md`。
- 按需更新 `openspec/designs/architecture/runtime-boundaries.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 按需更新 `openspec/designs/modules/agent-channel-web.md`。
- 新增 `openspec/designs/modules/agent-dev-workbench.md`。
- 新增或更新 `openspec/designs/adr/dev-agent-workbench-projection-first-boundary.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
