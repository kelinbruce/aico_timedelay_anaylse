## 背景与问题（Why）

当前 TypeScript 最小内核已经把请求生命周期、Agent assembly 固化、context/model/capability 主链路落在 `agent-runtime` 与 `agent-core`，但 `agent-core` 仍主要体现为默认模型循环。roadmap 的 Agent Routing 能力组要求请求业务路由必须位于 Agent 内部：runtime/channel 只能传递已接受请求事实和 typed constraints，不能替 Agent 选择确定性流程、模型驱动流程、Skill、拒绝、澄清或人工接管。

本 change 建立 Agent 内部 routing policy 的最小核心契约和流程接入点，为后续 routing evidence、约束校验、定向 Skill、recipe dispatch 等 change 提供唯一入口。

## 变更范围（What Changes）

- 在 Agent boundary 之后、context/model/capability 调用之前引入 Agent routing policy 决策点。
- 复用已冻结核心契约中的 routing decision kind：deterministic flow、model-driven loop、clarify、reject、human handoff。
- 当前 change 的可执行选择逻辑只覆盖默认 `MODEL_DRIVEN_LOOP` 和 fail-closed rejection；deterministic、clarify、human handoff 只保留为已冻结 vocabulary 的可翻译边界，真实选择规则由后续 change 定义。
- 明确 routing policy 的触发机制、输入前置条件、输出副作用、核心判断顺序、状态契约、流程接入、失败降级和验收样例。
- 明确 router 必须能承载由可信 Agent 配置提供的 routing 规则配置，未配置或显式声明 `default` 时走默认模型驱动路径，其他受控模式先支持 `policy` 配置。
- 明确 `policy` 配置的输入和输出 contract，用于约束 routing policy 可消费的事实以及 routing 结果的最小 shape；当前 routing 结果只承载 `skillName` 目标字段，`workflowName` 留给后续 change。
- 明确 `policy` 模式未来支持用户自定义代码，但当前 change 只预制系统默认 `policy:intent-recognition` 配置方法；当前仅识别该配置并保留受控入口，不实现真正的 intent-recognition policy evaluation。用户自定义 policy 的加载、执行、沙箱和治理由后续 change 定义。
- 明确 runtime/channel 只能传递 request facts、Agent scope、Owner scope 和 typed constraints，不拥有业务 routing。
- 不在本 change 定义具体业务规则库、规则匹配/优先级算法、recipe 文件格式、完整模型 fallback 算法、用户显式 Skill 的细化校验或新的 routing decision kind；`policy` 路由规则的具体匹配语义由后续 change 承载。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-routing-core`: 在 Agent 内部建立 routing policy 决策点和受控 routing decision 契约。

### 修改的 Capability
- `ts-core-contracts`: 使用已有 request routing skeleton，不在本 change 冻结新的通用 `PolicyPort`。
- `ts-backend-architecture`: 归档前同步 Agent routing 位于 Agent 内部的主流程设计事实。

## 影响范围（Impact）

- `agent-core`: 增加 routing policy 边界、默认模型驱动路径适配和 fail-closed 处理。
- `agent-runtime`: 继续负责 accepted request、lane、cancellation、timeline、terminal commit；不新增业务路由职责。
- `agent-channel-web`: 继续负责 transport/schema/projection；不直接选择 Skill/Tool/Agent capability。
- `agent-contracts`: 本 change 不修改已冻结 `RoutingDecisionKind` / `AgentRoutingDecision`；如后续需要新增 decision kind 或 request-carried constraints DTO，必须先提出 contract refinement change。
- 验证：agent-core routing unit tests、runtime/channel non-routing architecture tests、OpenSpec strict validation。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-routing-core/spec.md`：新增 Agent routing core 行为契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/ts-backend-architecture.md`：同步 Agent 内部 routing 主流程、边界和非职责。
- `openspec/designs/modules/agent-core.md`：同步 `agent-core` 拥有 routing policy 决策点。
- `openspec/designs/modules/agent-runtime.md`：同步 runtime 不拥有业务 routing。
- `openspec/designs/modules/agent-channel-web.md`：同步 channel 不拥有业务 routing。
- `openspec/designs/spec-to-design-map.md`：增加 spec 导航。

验证入口：
- `npm test -- --run packages/agent-core/tests/*routing*`
- `npm run lint:architecture`
- `openspec validate add-ts-agent-routing-core --strict`
