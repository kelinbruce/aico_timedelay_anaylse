## 背景与问题（Why）

TS 后端架构已经确定了 runtime、channel、core、context、gateway、capability、observability 和 app composition 的边界。下一步如果直接进入最小问答内核实现，各团队会在 identity、owner scope、RequestRun、timeline、stream、AgentError/SafeError、context、model、capability、gateway、hook、checkpoint 等对象上自行假设，导致最小内核和后续配件 change 争夺同一批主流程契约。

本变更先冻结最小内核和首版本地 release 并行开发所需的核心契约。它不实现完整 Web API、runtime state machine、store schema、具体工具、Skill source 或远端能力，只定义跨模块必须共享的 contract skeleton、命名、所有权和验证边界。

## 变更范围（What Changes）

- 建立 TS 后端核心 contract namespace，覆盖 identity/owner scope、session/message、RequestRun、runtime command、AgentError/SafeError、timeline、stream projection、attachment id/metadata/blob 边界、context assembly、model invocation、capability descriptor/invocation、gateway ports、sandbox gateway、Agent routing、hook、checkpoint、audit/error 边界和 locale。
- 冻结 canonical `RunStatus`、`TimelineEventType` 和 `StreamEventType` vocabulary，并定义 timeline 到 Web stream 的投影边界。
- 定义 owner scope 为 `tenantId` 和 `subjectId` 两个显式字段，不新增独立 owner scope DTO，并要求跨 runtime、session、attachment、capability、gateway、audit 和 observability 传递。
- 定义 RequestRun optimistic version、claim/fencing、CAS result 和 terminal commit result 的最小契约，用于本地恢复和后续多实例扩展。
- 定义 runtime-facing Agent assembly 和 lookup boundary，覆盖 agent id/version、workspaceDir、modelProfileIds、promptTemplateIds、capability bindings、runtime settings 和 active/require registry 语义。
- 定义 capability 公共 kind 为 `TOOL`、`SKILL`、`AGENT`，并保留 capability compatibility metadata、Tool 幂等声明、Skill manifest、Agent capability 和 provider governance 的扩展位置。
- 定义 no-op 允许边界：最小内核可调用 hook、checkpoint、audit 等一层直接依赖的目标接口，但本变更不要求真实落库或真实 side effect。

BREAKING：无。当前 TS 后端尚未形成稳定核心契约基线。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-core-contracts`: 定义 TS 后端最小内核和并行配件开发共享的核心运行时、事件、上下文、模型、能力、网关、安全、恢复和观测契约。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- 代码：影响后续 `agent-contracts`、`agent-common`、`agent-runtime`、`agent-session`、`agent-channel-web`、`agent-core`、`agent-context-engine`、`agent-model`、`agent-capability`、`agent-platform-gateway-*`、`agent-observability`、`agent-app` 和 `agent-test-kit` 的 public contract 依赖。
- API/事件：冻结 runtime command、timeline event、stream projection、AgentError/SafeError 和 status vocabulary 的最小形态。
- 配置：仅定义 model profile、gateway adapter、capability provider、secret reference 等配置 contract 的边界，不实现完整配置加载。
- 测试：新增核心契约、事件 vocabulary、owner scope、safe error、capability descriptor、gateway port 和 architecture boundary 的 contract tests/smoke tests。
- 运维：为 health、metrics、trace、audit 和 recovery diagnostics 保留稳定业务标识字段。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-core-contracts/spec.md`：新增 TS 核心契约行为基线。

长期背景：
- `openspec/overview.md`：保留“契约先行支撑最小内核和并行配件开发”的目标背景。

设计视图：
- `openspec/designs/architecture/runtime-boundaries.md`：提升 runtime lifecycle、terminal commit、timeline ownership 和 stream projection 边界。
- `openspec/designs/architecture/owner-scope-security.md`：提升 identity、owner scope、safe error 和 redaction 的跨模块边界。
- `openspec/designs/contracts/core-contracts.md`：提升 runtime、context、model、capability、gateway、sandbox、hook、checkpoint 和 observability contract skeleton。
- `openspec/designs/domain/request-run.md`：提升 RequestRun、timeline、terminal result、version/claim/fencing 和 recovery 相关领域对象。
- `openspec/designs/modules/agent-contracts.md`：提升 contract package 职责和非职责。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-core-contracts` 到长期设计文档的导航。

验证入口：
- contract tests：核心 schema、event vocabulary、safe error、owner scope、capability descriptor、gateway port。
- architecture tests：contract package 不依赖实现包；implementation package 只能依赖 contract，不反向依赖。
- smoke tests：最小 no-op hook/checkpoint/audit contract 可被主流程调用。

不要把实施过程状态写入长期基线文档；归档时只提升仍成立的契约和设计事实。
