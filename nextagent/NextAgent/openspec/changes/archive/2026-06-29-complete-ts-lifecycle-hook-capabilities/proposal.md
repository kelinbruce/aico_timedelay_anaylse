## 背景与问题（Why）

电信网络运维诊断、网络能力治理、客户系统集成和审计场景需要 lifecycle hook 在 runtime-owned lifecycle boundary 内提供可预测、可审计、可恢复、可测试的治理扩展点。hook 必须覆盖固定 stage、Agent 级启用边界、系统治理默认生效、上下文和执行边界修正、观测审计、执行阻断、可恢复等待和失败隔离。

目标状态是：开发者通过 `defineLifecycleHook(...)` 定义一个满足 `LifecycleHook` interface 的 hook implementation object，在同一对象中声明 hook identity、effects、支持 stage、失败策略、可选配置校验、可选装配期 `configure` 和 `execute`；现有 Agent package 配置通过 `agent.yaml.hooks` 声明该 Agent 如何启用、关闭、收窄、定位或配置 hook，并在启动期编译进 `AgentAssembly.hooks`；runtime 按 9 个 lifecycle stage 执行 hook，按 effects 决定并行观察或串行影响型执行，并把所有控制结果、mutation、pending input 和观测事实收敛到 runtime-owned contract。

本 change 依赖 `refine-ts-pending-input-contracts` 先完成并归档。原因是 `PEND` outcome 会创建 runtime-owned PendingInput，必须基于已归档的 pending input question/answer、pause outcome、gateway fact query 和 resolve idempotency contract，不得在 hook change 中并行发明 pending input 私有形态。

## 变更范围（What Changes）

- 定义 lifecycle hook 产品路径对 9 个 runtime-owned stage 的一致支持，包括 developer-facing `LifecycleHook` interface / `defineLifecycleHook(...)` helper、startup composition hook registry、`agent.yaml.hooks` / `AgentAssembly.hooks` materialization、runtime execution、测试和恢复入口。
- 明确 hook 本体和 Agent 级启用/关闭的最小边界：开发者通过 `defineLifecycleHook(...)` 定义一个满足 `LifecycleHook` interface 的 hook implementation object，其中同时包含稳定 identity、effects、可选 `configSchema` / `configure` 和 `execute`；`agent.yaml` 只表达当前 Agent 对已注册 hook 的启用、关闭、stage 收窄、相对定位、timeout 和 config；startup composition 在启动期把 hook implementation object materialize 为 runtime definition、configured executable 与 code registration。自定义 hook 只有被当前 Agent assembly 显式绑定后才生效；系统 hook 默认对所有 Agent 生效，但开发者可以在当前 Agent 的 `agent.yaml.hooks` 中通过 `enabled=false` 或 `disabled=true` 显式关闭。
- 为 developer-facing `LifecycleHook` interface / `defineLifecycleHook(...)` 返回的 hook implementation object 和 materialized runtime definition 增加稳定 effect 集合，至少覆盖：
  - `OBSERVE`：记录、审计、指标、trace、诊断，以及有界、幂等、不影响当前流程的外部观察/通知类副作用；observe-only hook 不控制流程、不修改 boundary，也不写入 runtime-owned truth；
  - `TRANSFORM`：修改当前 stage 允许的 effective boundary；
  - `CONTROL`：影响 protected operation 是否继续，支持 `PASS`、`SKIP`、`DENY`、`BLOCK`，并支持 `PEND` 的 stage 限定语义。
- 明确 hook result outcome 语义：`PASS` 表示 hook 已执行且允许继续；`SKIP` 表示 hook 已进入但自行判断不适用于当前 run；`DENY` 表示治理拒绝；`BLOCK` 表示条件不满足或执行保护阻断；`PEND` 表示可恢复等待。首版 `PEND` 只允许在可安全暂停且 protected operation 尚未执行的 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_AGENT_TERMINAL`。
- 增加单一 stage hook 数量上限 `maxHooksPerStage`：按当前 Agent 每个 lifecycle stage 的 effective hook 总数计数，超过上限时 Agent assembly 编译失败，runtime 不截断、不降级。
- 按副作用定义执行策略：
  - 仅声明 `OBSERVE` effect 的 hook 可并行执行；它可以执行有界、幂等、不影响当前流程的观察/通知类副作用，失败只产生观测降级事实，不改变 request truth；
  - observe-only hook 获取 runtime 提供的 opaque safe idempotency key；该 key 基于可恢复的 stage occurrence / operation coordinate 生成，同一 occurrence 恢复重试稳定，合法新 occurrence 和不同 configured hook 区分；
  - 任何声明 `TRANSFORM` 或 `CONTROL` effect 的 hook 必须串行稳定执行；
  - 串行 hook 先按 `SYSTEM` before `CUSTOM` 分组；`SYSTEM` 组内按框架内置 hook 的显式 order；`CUSTOM` 组内默认按当前 Agent 启用声明顺序，也可使用绝对 `priority` 或 `before` / `after` 相对定位，再按 `hookId` 兜底排序；
  - 并行 hook 的完成顺序不得影响主流程 truth，观测事件必须保留 hook invocation 级证据。
- 补齐 stage-specific mutation 支持和校验，hook 在明确声明的 stage mutation contract 内按同名字段完整替换当前 stage owner 可消费的有效输入、有效输出或安全投影；raw context / model / capability evidence、持久化 truth 和跨 owner state 保持由原 owner 管理，mutation 使用 closed object 字段替换 contract 表达。
- 明确 `DENY` 和 `BLOCK` 的黑盒语义：`DENY` 表示治理拒绝，`BLOCK` 表示条件不满足或执行保护阻断；两者都停止后续会影响主流程的 hook 和 protected operation，但安全错误分类、timeline evidence 和观测 reason code 必须可区分。
- 强化 `SYSTEM` hook 约束：作为框架内置 hook 默认对所有 Agent 启用，可被当前 Agent 显式关闭；启用时整体优先于 `CUSTOM` hook；系统 hook 组内顺序必须由框架内置定义的显式 `order.priority` 或等价 order 约束决定；`failureMode` 必须为 `FAIL`，startup composition 和 direct composition 都必须 fail closed 校验非法定义。
- 增加推荐首个内置系统 hook `system.output-redaction-guard`：在 `BEFORE_AGENT_TERMINAL` 扫描最终 `finalContent` 中的凭据模式、内部 IP 段、客户标识、路径等敏感信息，可安全脱敏时通过 `AgentTerminalMutation.finalContent` 替换最终输出，无法安全脱敏或命中高风险泄漏时返回 `BLOCK` 阻止 final-content event 发送；该 hook 用于验证 pre-final-event 时序、finalContent mutation、CONTROL BLOCK 和电信诊断输出防泄漏路径，不替代 `AFTER_MODEL_RESULT` 的模型结果边界。
- 保持 hook code 来源边界收敛：本 change 不引入 hook 目录配置、manifest 加载、remote hook、shell/script hook、非 TypeScript hook runtime、模型生成 hook、热加载、运行期目录扫描或 marketplace。开发者实现 hook 后如何贡献到系统由后续 plugin composition change 承载。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `lifecycle-hook-execution`: 修改 runtime lifecycle hook 的 stage 覆盖、effect 声明、并行/串行执行语义、stage-specific mutation、`DENY` / `BLOCK` 控制结果、`SYSTEM` hook fail-closed 校验和观测事件要求。
- `agent-package-assembly`: 修改 Agent package assembly，使 `agent.yaml.hooks` 作为 Agent 权威配置的一部分编译进 runtime-facing `AgentAssembly.hooks`。
- `ts-core-contracts`: refine frozen hook / pending baseline，将旧 decision/execution-mode/binding 语义替换为 effects/outcome/AgentAssembly hooks 语义，并将 lifecycle-changing hook timeline evidence 收敛到 timeline-only `HOOK_INVOKED`。

## 影响范围（Impact）

- `packages/agent-contracts/runtime`：扩展 developer-facing `LifecycleHook` interface、`defineLifecycleHook(...)` helper、runtime-internal hook definition、result / invocation event contract，补齐 hook effects、execution strategy、hook outcome 和 stage mutation vocabulary。
- `packages/agent-contracts/agent-assembly`：在 runtime-facing `AgentAssembly` 增加 `hooks`，作为 Agent package assembly fact，而不是 hook 目录或 runtime request path 的私有配置。
- `openspec/specs/ts-core-contracts` / `packages/agent-contracts` shared contract tests：声明并验证 frozen hook baseline refinement，删除旧 `HookDecision`、`HookExecutionMode`、独立 `AgentHookBinding` 和单独 `HOOK_OUTCOME_APPLIED` 语义入口。
- `packages/agent-runtime`：提供 runtime-owned hook execution / outcome interpretation / pending handoff / timeline evidence 能力，支持独立 `LifecycleHookInvocationPort`、stage invocation request、一致排序、串行归约、并行 observe 调度、stage-level timeout、控制结果解释、mutation 校验和 `HOOK_INVOKED` timeline-only evidence；不得把所有 stage 触发都集中在 `agent.execute()` 前，也不得依赖 `agent-model`、`agent-context-engine` 或其它 stage owner implementation package。
- `packages/agent-core`：在 agent loop 内每个 planning turn 调用模型前触发 `BEFORE_PLANNING`，位置必须在请求/技能路由和 routing constraint 已解析、当前 planning-turn 输入已确定之后，且在 context assembly / model request construction 之前；在 agent loop 返回 runtime 之前触发 `BEFORE_AGENT_TERMINAL`；消费 planning、capability 和 agent terminal effective boundary mutation，保持 core 只通过 injected runtime-owned hook port 协作，不依赖 runtime implementation。
- `packages/agent-model`：在所有模型调用进入 provider SDK 前触发 `BEFORE_MODEL_INVOKE`，并在 provider result normalization 后、返回 caller 前触发 `AFTER_MODEL_RESULT`，使 agent loop、fallback、context/prompt、评估或其他后续模型调用路径共享同一 model hook boundary；可依赖 `agent-contracts/runtime` 中受限的 hook stage invocation contract，消费 effective model invocation/result 后再继续；不得导入 `agent-runtime` implementation，不得使用 runtime run state、checkpoint、timeline 或 terminal contract。
- `packages/agent-context-engine`：在 context engine 的真实 compaction 边界触发 `BEFORE_CONTEXT_COMPACT`，并在 summary draft 生成且通过基础校验后、`commitCompaction` 持久化之前触发 `AFTER_CONTEXT_COMPACT`；可依赖 `agent-contracts/runtime` 中受限的 hook stage invocation contract，消费 effective context compaction boundary；skipped/no-op context 路径不得触发 after compact hook；不得导入 `agent-runtime` implementation，不得使用 runtime run state、checkpoint、timeline 或 terminal contract。
- `packages/agent-app`：作为 composition root，将 `agent-runtime` hook executor implementation 注入 `agent-core`、`agent-model` 和 `agent-context-engine` 所消费的 hook stage invocation contract。
- `packages/agent-app`：提供 startup composition hook registry，接收系统内置 hook 和后续 plugin composition 已装配的 `LifecycleHook` objects；扩展 `agent.yaml` parser / assembly compiler，将 `hooks` 编译进 frozen AgentAssembly；本 change 不定义 hook 目录配置、manifest 加载或配置目录加载路径。
- `packages/agent-observability` / app composition：确保 hook invocation、并行 observe 失败、控制结果、mutation summary 和 diagnostic reason 可被日志、指标、审计消费，且不泄漏 raw prompt、模型输出、工具参数/结果、附件内容、路径或 credential。
- 测试：需要补 characterization、contract、architecture 和 negative case，覆盖全 stage、并行观察、串行 transform/control、系统优先级、自定义排序、非法 mutation、非法 composition input、失败模式、恢复入口和观测降级。
- 运维：hook 作者需要通过 `defineLifecycleHook(...)` 声明 hook 能力和执行策略；Agent package 作者在现有 `agent.yaml` 中声明 hook activation；非法 startup hook registry input 或非法 Agent hook activation 会启动失败。开发者 hook 的插件发现、插件加载和插件激活由后续 plugin composition change 定义。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-core-contracts/spec.md`：提炼 hook / pending frozen baseline refinement，覆盖 HookEffect、HookOutcome、AgentAssembly.hooks、system hook disable 和 `HOOK_INVOKED` timeline-only evidence。
- `openspec/specs/lifecycle-hook-execution/spec.md`：提炼 9 stage 一致支持、hook effects、并行/串行执行语义、stage mutation、控制结果、系统 hook fail-closed 和观测事实。
- `openspec/specs/agent-package-assembly/spec.md`：提炼 `agent.yaml.hooks` 到 `AgentAssembly.hooks` 的启动期编译、校验和 request path frozen consumption 规则。
- `openspec/specs/ts-run-status-visibility/spec.md`、`openspec/specs/trace-log-linking/spec.md`、`openspec/specs/human-pending-input-core/spec.md`：同步旧 `HOOK_OUTCOME_APPLIED` / `HookResult.decision` / `decision=PEND` 引用到 `HOOK_INVOKED`、`HookOutcome` 和 runtime-owned pending handoff 目标语义。

长期背景：
- `openspec/overview.md`：补充 lifecycle hook 作为完整治理扩展点的长期背景；如归档时认为 overview 已足够则无。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：补充 hook effects / execution strategy / stage mutation 属于 runtime contract 的稳定边界。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 hook 在 request lifecycle 中的串行/并行执行位置、控制结果和 mutation owner。
- `openspec/designs/architecture/observability.md`：补充 hook invocation、并行 observe 降级、控制结果和 mutation summary 的安全观测要求。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime hook executor 职责、非职责、顺序、并行观察、串行归约和恢复语义。
- `openspec/designs/modules/agent-core.md`：补充 core 在 agent loop 内每个 planning turn 的模型调用前触发 `BEFORE_PLANNING`，并在 agent loop 返回前触发 `BEFORE_AGENT_TERMINAL`，只消费 runtime-owned hook result 和 effective boundary，不拥有 hook executor。
- `openspec/designs/modules/agent-model.md`：补充 model provider invocation boundary 触发 `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT`，并保证所有带 accepted run context 的模型调用路径共享同一 model hook boundary。
- `openspec/designs/modules/agent-context-engine.md`：补充 context engine 拥有 context compaction hook 触发位置，`AFTER_CONTEXT_COMPACT` 只在 summary draft 生成后、compaction 持久化前触发。
- `openspec/designs/modules/agent-app.md`：补充 startup hook registry、AgentDefinition parser / AgentAssembly compiler 对 `hooks` 的处理、startup validation 和 frozen snapshot 注入。
- `agent-app` 旧 hook directory product path：删除 `hook-directory-loader.ts` 或等价目录加载实现、`loadHookDirectoryForSystemConfig` / `HookDirectoryLoadResult` export/use、`hooksRoot` / `configRoot/hooks` 作为 hook source root 的配置派生和 `hook.json` manifest loading。
- `openspec/designs/architecture/configuration-boundary.md`：移除 `hooksRoot` 作为 product hook source root 的长期描述，保留 runtime 不从配置目录发现 hook 的边界。
- `openspec/designs/adr/<id>.md`：如归档时需要长期保留“按副作用而非 kind 决定并行/串行”的取舍理由，则新增 ADR；否则无。
- `openspec/designs/spec-to-design-map.md`：更新 `lifecycle-hook-execution` 到上述 architecture / module 设计文档和验证入口的导航。

验证入口：
- `npm run build`
- `npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-*.test.ts tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/main-path.test.ts tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/lifecycle-hook-stage-owner-integration.test.ts`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
