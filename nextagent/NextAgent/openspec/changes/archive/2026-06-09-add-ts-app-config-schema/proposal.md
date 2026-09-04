## 背景与问题（Why）

TS 后端需要一套统一的 app composition 配置规格，用来在系统进入 ready 前明确三件事：

- 哪些配置属于 framework/runtime，哪些属于 app composition，哪些属于 Agent 业务定义；
- 哪些配置组是首版本地 release 的必需输入，哪些只在被选中的部署分支上生效；
- 配置无效、依赖缺失或 secret reference 不可用时，系统如何以安全、可诊断、非静默的方式阻断或降级。

如果缺少这层统一规格，配置解释会分散到 model、gateway、channel、session 和 app 装配流程中，导致：

- ready 判定时机不稳定；
- 配置失败边界与错误输出不一致；
- downstream 模块在请求期重新解释源配置，破坏 app composition ownership；
- future configuration changes 各自形成第二套 schema 和校验规则。

## 变更范围（What Changes）

- 新增 `app-config-schema` capability。
- 定义 app composition 配置的三层 ownership：framework/runtime config、app composition config、Agent package config。
- 定义首版 app composition 稳定配置组：`deployment`、`paths`、`identity`、`channel`、`hostedAgent`、`modelProfiles`、`capabilityProviders`、`gateway`。
- 定义启动期同步配置校验、配置冻结和 ready gate 的唯一触发机制。
- 收敛 app-internal 配置对象：`RawDefaultSystemConfig` 只作为源配置输入，`DefaultSystemConfig` 作为启动期验证后的唯一完整配置事实，health/release 只消费最小安全投影 `ConfigValidationEvidence`；不新增独立 `AppConfigSnapshot` 或并行 validation artifact。
- 定义 safe config error、operator-visible diagnostics 和显式降级边界。

## Capability 影响（Capabilities）

### 新增 Capability

- `app-config-schema`: 定义 app composition 配置的读取、校验、冻结、ready gate 和安全诊断边界。

### 相邻 Capability 消费关系

本 change 不在本目录内修改 `agent-assembly` 或 `local-runtime-release` capability delta：

- `agent-assembly`: 消费由已冻结 app configuration 派生的 runtime-safe registry/input。
- `local-runtime-release`: 消费 ready 前已完成的 app configuration validation/freeze evidence。

## 影响范围（Impact）

- 受影响模块：
  - `packages/agent-app`
  - `packages/agent-model`
  - `packages/agent-platform-gateway-local`
  - `packages/agent-platform-gateway-remote`
  - `tests/contract`
  - `tests/integration`
- 受影响协作边界：
  - `agent-app` 负责源配置读取、组装、校验、冻结和 ready gate
  - 完整 `DefaultSystemConfig` 保持在 `agent-app` 内部，不新增 `agent-contracts/configuration`，不修改冻结核心契约
  - 下游消费路径固定为：Agent assembly 使用 `AgentAssemblyRegistry`；model 使用由 `DefaultSystemConfig.modelProfiles` 构造的 restart-scoped `ModelProfileRegistry`；gateway 使用 app composition 注入的 gateway port；capability 使用 capability catalog/provider registry；`agent-app` 使用 `ConfigValidationEvidence` 发布 readiness 并构造 release 输入
- 受影响后续 change：
  - `add-ts-model-provider-configuration`
  - `add-ts-capability-provider-configuration`
  - `add-ts-gateway-configuration`
  - `add-ts-secret-configuration-boundary`

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：

- `openspec/specs/app-config-schema/spec.md`：新增

设计视图：

- `openspec/designs/architecture/configuration-boundary.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/contracts/platform-gateway-spi.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：

- configuration contract tests
- bootstrap validation tests
- startup readiness integration tests
- release smoke prerequisites
