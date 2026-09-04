# gateway-configuration Specification

## Purpose

Define startup gateway configuration selection, validation, provider resolution, binding merge and readiness requirements.

## Function

- **所属 Function**：`FN-10.5 集成外部系统`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Gateway configuration is loaded and stabilized during startup

系统 SHALL 在 startup/bootstrap 阶段读取 gateway 配置组，并在 app-level configuration freeze 完成前完成 gateway adapter selection、校验和冻结。当 source configuration 完全省略 `gateway` section 时，系统 SHALL 应用 LOCAL `working-memory`、LOCAL `long-term-memory`、LOCAL `sqlite` 及其他既有默认 gateway entries，使本地部署获得完整 provider bindings 后才能启动。

为模型目录装配安全 model-information capability MUST NOT 改变上述 gateway selection、freeze、LOCAL defaults 或既有 adapter readiness/fallback 语义。gateway configuration bootstrap MUST 只装配该 capability，MUST NOT 因装配行为在 ready 前发起模型信息查询。

`agent-contracts/gateway` MUST 定义环境中立且 Fetch-compatible 的 `FetchGateway` port，其单一异步操作 shape MUST 等价于 `fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>`。`GatewayBindings.fetch` MUST 是可选 binding，不新增 `GatewayAdapterKind`、selection entry、LOCAL default、readiness requirement 或仓库内 REMOTE 实现。该 port MUST 表达可供 app composition 下 outbound HTTP consumer 复用的运行环境 transport 能力，MUST NOT 以模型、REST resource 或具体 provider 命名。多个 selected Gateway providers 同时返回非空 `fetch` binding 时，app composition MUST 在 ready 前以安全 binding conflict 失败；恰好一个 provider 返回该 binding 时，merge MUST 保留同一 port 实例。本 change MUST NOT 迁移其他 REST client、建立全局 HTTP client abstraction、定义 header policy 或增加额外 header 语义。

**需求类别**：功能性需求

#### Scenario: 系统进入 ready 状态

- **WHEN** 系统对外报告 ready
- **THEN** gateway configuration 已经完成读取、校验和冻结
- **AND** downstream modules 消费冻结产物而不是原始 source 配置

#### Scenario: 省略 Gateway section 时使用本地 capability providers

- **WHEN** source configuration 完全省略 `gateway` section
- **THEN** 系统 MUST 选择 LOCAL Working Memory、Long-term Memory 和保留 SQLite providers
- **AND** 启动结果 MUST 与显式声明对应默认 entries 一致

#### Scenario: 装配 model-information capability

- **WHEN** trusted app composition 为模型目录装配 Gateway model-information capability
- **THEN** gateway configuration 的 selection、freeze、LOCAL defaults 和既有 adapter readiness/fallback 语义 MUST 保持不变
- **AND** 系统 MUST NOT 因该 capability 的装配在 ready 前发起模型信息查询

#### Scenario: Remote provider 提供可选通用 fetch

- **WHEN** trusted Gateway provider 或预装配 `GatewayBindings` 提供 `fetch`
- **THEN** Gateway bindings merge MUST 向 app composition 保留同一 optional `fetch` port
- **AND** 该 port MUST NOT 建立独立 adapter kind、selection entry 或 readiness requirement

#### Scenario: Local bindings 未提供通用 fetch

- **WHEN** LOCAL deployment 的 Gateway bindings 未提供 `fetch`
- **THEN** app startup MUST 正常完成
- **AND** merged `GatewayBindings.fetch` MUST 保持缺失

#### Scenario: 多个 provider 重复提供通用 fetch

- **WHEN** 多个 selected Gateway providers 同时返回非空 `fetch` binding
- **THEN** app composition MUST 在 ready 前以安全 binding conflict 失败
- **AND** 系统 MUST NOT 任意选择或覆盖其中一个 binding

#### Scenario: 当前 change 不扩展其他 HTTP consumer

- **WHEN** 通用 `FetchGateway` 已由 app composition 装配
- **THEN** 本 change MUST 只要求 OpenAI-compatible adapter 消费该 binding
- **AND** 既有 REST client 和其他 outbound HTTP consumer MUST 保持现有实现，直到其 owning change 明确定义迁移

### Requirement: Validation follows deterministic rule order

startup validation MUST 按以下顺序执行：

1. gateway 配置组存在且结构可解析；
2. `gatewayId` 非空且唯一；
3. `adapterKind` 属于当前产品允许的稳定选择集合；
4. 同一 `adapterKind` 在 gateway source set 内至多出现一次；
5. 每个 entry 的 `deploymentMode` 已确定；
6. 每个 entry 的 provider selection 和 capability binding 完整性判定完成。

稳定选择集合 MUST 包含 `working-memory`、`long-term-memory`、`sqlite`、`sandbox`、`scheduled-maintenance`、`cron-tasks`、`rag-knowledge`、`skillhub`、`workflow-execution`、`guardrail` 和 `watermark`。`sqlite` MUST 只映射到 gateway-store-provider-ownership 规格定义的保留 stores，不得作为 Working Memory 或 Long-term Memory 的别名。`guardrail` MUST 只在 `deployment.mode: "REMOTE"` 下被 selected entry 接受；LOCAL 下 selected `guardrail` entry MUST 被 startup 视为禁用且不产生 binding。`watermark` MUST 只在 `deployment.mode: "REMOTE"` 下被 selected entry 接受；LOCAL 下 selected `watermark` entry MUST 被 startup 视为禁用且不产生 binding。provider 缺失、deployment mode 不匹配、未声明支持 selected adapter kind、capability binding 不完整或 binding 冲突时，startup MUST fail before ready。

#### Scenario: Guardrail belongs to the stable adapter selection set

- **WHEN** source configuration 声明 `adapterKind: "guardrail"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: Guardrail selected in LOCAL is disabled

- **WHEN** `deployment.mode: "LOCAL"` 且 source configuration 含 selected `guardrail` entry
- **THEN** startup MUST 将该 entry 视为禁用
- **AND** MUST NOT 为其创建 binding
- **AND** startup MUST NOT 仅因该 entry 而 fail before ready

#### Scenario: Watermark belongs to the stable adapter selection set

- **WHEN** source configuration 声明 `adapterKind: "watermark"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: Watermark selected in LOCAL is disabled

- **WHEN** `deployment.mode: "LOCAL"` 且 source configuration 含 selected `watermark` entry
- **THEN** startup MUST 将该 entry 视为禁用
- **AND** MUST NOT 为其创建 binding
- **AND** startup MUST NOT 仅因该 entry 而 fail before ready

### Requirement: Gateway registry resolves selected providers per gateway entry

系统 SHALL 在 gateway configuration freeze 后创建 gateway registry，并根据每个 frozen entry 的 `deploymentMode` 和 `adapterKind` resolve 一个声明支持该 capability 的 injected provider。每个 selected entry MUST 恰好由一个 provider 创建 binding；同一 provider MAY 支持多个 selected adapter kinds，但 MUST 只创建分配给它的 bindings。系统 SHALL 按顶层 capability binding 合并不同 provider 的结果，并在 merged bindings 完整覆盖全部 selected adapters 后才能 ready。

#### Scenario: Three local persistence capabilities are selected

- **WHEN** gateway selection 同时包含 LOCAL `working-memory`、LOCAL `long-term-memory` 和 LOCAL `sqlite`
- **THEN** registry MUST 为三个 entries 解析支持对应 adapter kind 的 provider
- **AND** composition MUST 合并互不冲突的 Working Memory、Long-term Memory 和保留 SQLite bindings

#### Scenario: Provider returns an unselected binding

- **WHEN** provider 返回未分配给它的 capability binding
- **THEN** composition MUST fail before ready
- **AND** diagnostics MUST 只包含 safe provider/binding references

### Requirement: Gateway configuration owns provider selection and bindings handoff

gateway configuration SHALL own provider selection and bindings handoff: it determines which selected gateway entry is assigned to which trusted provider, verifies that the provider was injected by trusted composition, and verifies that provider creation produced stable `GatewayBindings`.

It MUST NOT redefine gateway port business semantics, model invocation, Tool/Memory/RAG policy, capability conflict rules, global configuration lifecycle, secret resolution grammar, vendor endpoint fields, credential references, or provider-private access baseline fields.

#### Scenario: Downstream module needs gateway adapter access

- **WHEN** a downstream module needs a gateway dependency
- **THEN** it MUST consume the frozen gateway selection and gateway port bindings
- **AND** it MUST NOT reinterpret raw gateway source configuration

### Requirement: Adapter selection is a static per-port deployment decision

For each gateway entry, local and remote providers share the same port contract but deployment configuration selects one effective adapter at startup. The system MUST NOT switch or fallback to another adapter implementation at runtime. If a selected adapter is unavailable, the selected entry contributes a blocking startup/readiness issue.

#### Scenario: No runtime dynamic fallback

- **WHEN** a selected remote adapter is unavailable at runtime startup/readiness
- **THEN** the system MUST NOT fallback to a local adapter
- **AND** diagnostics MUST report a safe blocking issue

### Requirement: Gateway providers are injected through trusted app composition

The system SHALL receive gateway provider instances through trusted app composition input. `agent-app` core composition MUST depend only on gateway provider/binding SPI and structured composition options; it MUST NOT import concrete local gateway provider factories, concrete remote provider factories, concrete gateway packages or vendor remote entrypoint packages.

`GatewayBindings` SHALL expose only stable gateway ports, readiness and safe close lifecycle. It MUST NOT expose adapter-private clients, SDK types, connection pools, raw endpoint, raw credential or raw provider config.

#### Scenario: Provider creates only selected bindings

- **WHEN** a selected provider creates gateway bindings
- **THEN** it MUST create bindings only for adapter kinds assigned to that provider
- **AND** unselected adapter kinds MUST NOT be created as side effects

### Requirement: Package launcher selects deployment entrypoint from frozen deployment mode

Package startup launcher SHALL read the candidate configuration and use frozen `deployment.mode` to select a declared deployment entrypoint. `deployment.mode: "LOCAL"` selects the LOCAL entrypoint; `deployment.mode: "REMOTE"` selects the REMOTE entrypoint. The launcher MUST NOT import concrete local or remote gateway provider packages by convention and MUST NOT fallback to LOCAL when a REMOTE entrypoint is missing or unavailable.

If the selected entrypoint uses a package module specifier, the launcher SHALL resolve it from the candidate package root dependency graph.

#### Scenario: Remote package lacks remote startup script

- **WHEN** candidate config declares `deployment.mode: "REMOTE"`
- **AND** neither config nor package manifest declares a REMOTE deployment entrypoint
- **THEN** package startup MUST fail before ready
- **AND** startup proof MUST include a safe missing deployment entrypoint reason
- **AND** startup MUST NOT fallback to the LOCAL deployment entrypoint

### Requirement: Gateway capability evidence covers provider and bindings readiness

Package candidate evidence, startup proof or readiness proof SHALL record gateway capability readiness facts. Evidence MUST identify selected provider id, deployment mode, gateway selection snapshot reference and bindings readiness reference. When local and remote providers are both selected, evidence MUST preserve enough provider/readiness references to prove every selected provider reached READY.

#### Scenario: Remote package candidate is qualified

- **WHEN** a remote entrypoint package candidate is qualified
- **THEN** qualification evidence MUST include selected remote provider id
- **AND** MUST include `deploymentMode: "REMOTE"`
- **AND** MUST include gateway bindings readiness proof

### Requirement: Gateway diagnostics are safe and non-leaking

Gateway validation and readiness diagnostics MUST output only safe field references, reason codes and redacted summaries. They MUST NOT expose raw secrets, credentials, unauthorized existence details or adapter-native payloads.

#### Scenario: Gateway validation reports a selection problem

- **WHEN** the system reports a gateway selection diagnostic
- **THEN** diagnostics MUST contain only safe reason and field reference
- **AND** MUST NOT contain raw secret or provider-native error body

### Requirement: GatewayBindings exposes an optional guardrail port

`GatewayBindings` SHALL 暴露可选 `guardrail?: GuardrailGatewayPort`。当且仅当 frozen gateway selection 含一个 REMOTE selected `guardrail` entry 且其 provider 创建 binding 成功时，`GatewayBindings.guardrail` MUST 非 undefined。downstream 模块消费护栏能力 MUST 通过 `GatewayBindings.guardrail`，MUST NOT 重新解析 raw gateway source configuration 或自行构造 RobotRouter client。

LOCAL 部署下 `GatewayBindings.guardrail` MUST 为 undefined。`GuardrailGatewayPort` MUST 只暴露稳定 port 操作（guard proxy 转发、nl2py check）与 safe 诊断，MUST NOT 暴露 adapter-private client、SDK 类型、原始 endpoint、credential 或连接池。

#### Scenario: REMOTE guardrail binding is available to downstream

- **WHEN** frozen gateway selection 含 REMOTE selected `guardrail` entry 且 provider 创建 binding 成功
- **THEN** `GatewayBindings.guardrail` MUST 非 undefined
- **AND** downstream 模块通过该 port 消费护栏能力

#### Scenario: LOCAL guardrail binding is absent

- **WHEN** `deployment.mode: "LOCAL"`
- **THEN** `GatewayBindings.guardrail` MUST 为 undefined
- **AND** downstream 模块 MUST NOT 消费护栏能力

### Requirement: GatewayBindings exposes an optional watermark port

GatewayBindings SHALL 暴露可选 watermark?: WatermarkGatewayPort。当且仅当 frozen gateway selection 含一个 REMOTE selected watermark entry 且其 provider 创建 binding 成功时，GatewayBindings.watermark MUST 非 undefined。channel 层消费水印能力 MUST 通过 GatewayBindings.watermark 经 composition 适配为 WebWatermarkPort，MUST NOT 重新解析 raw gateway source configuration 或自行构造外部 watermark client。

LOCAL 部署下 GatewayBindings.watermark MUST 为 undefined。WatermarkGatewayPort MUST 只暴露稳定 port 操作（embedWatermark）与 safe 诊断，MUST NOT 暴露 adapter-private client、SDK 类型、原始 endpoint、credential 或连接池。

水印默认关闭，通过 agent package 的 config/config.json 的 watermarkEnabled 字段（boolean）控制是否启用。channel 层在实际调用时检查 watermark port 是否存在——watermarkEnabled === true 但没有 watermark binding 时，transform 不执行，原文返回。

#### Scenario: REMOTE watermark binding is available to downstream

- **WHEN** frozen gateway selection 含 REMOTE selected `watermark` entry 且 provider 创建 binding 成功
- **THEN** `GatewayBindings.watermark` MUST 非 undefined
- **AND** channel 层通过该 port 消费水印能力

#### Scenario: LOCAL watermark binding is absent

- **WHEN** `deployment.mode: "LOCAL"`
- **THEN** `GatewayBindings.watermark` MUST 为 undefined
- **AND** channel 层 MUST NOT 消费水印能力

### Requirement: Cron gateway adapter selection
系统 SHALL 通过受信 gateway configuration 为 Cron task 选择恰好一个 LOCAL 或 REMOTE adapter。选择项存在但 provider 不支持或 binding 缺失时，应用启动 MUST fail fast；不得静默回退到 in-memory store。

#### Scenario: Local selection
- **WHEN** deployment 选择 LOCAL Cron adapter
- **THEN** composition MUST 注入 SQLite-backed Cron gateway 并把 local scheduler 纳入应用 start/stop lifecycle

#### Scenario: Remote selection
- **WHEN** deployment 选择 REMOTE Cron adapter
- **THEN** composition MUST 注入 external Cron service adapter，且本地不得启动第二个任务到期 scheduler

#### Scenario: 缺少 binding
- **WHEN** 配置选择 Cron adapter 但 provider 未返回对应 binding
- **THEN** 启动 MUST 以稳定配置错误失败

### Requirement: 用户查询 Gateway 提供稳定公共契约

`agent-contracts/gateway` MUST 定义 `UserQueryGateway` 及其 runtime schemas。`UserQueryGateway.queryUsers` MUST 接收 `UserQueryRequest` 和可选 `AbortSignal`，并返回 `UserQueryResult | SafeError`。`UserQueryRequest` MUST 包含作为可信授权上下文的 `tenantId`、当前调用者 `subjectId`，以及 `targetSubjectIds`；`targetSubjectIds` MUST 是包含 1..10000 个互不重复 `SubjectId` 的数组。`UserQueryResult.users` MUST 是 `UserProfileRecord` 数组，每项只包含 required `subjectId` 和 required `userName`；`userName` MUST 是 1..256 个 Unicode code point 的非空字符串。请求和结果 schema MUST 拒绝未知字段。

结果中的每个 `subjectId` MUST 来自本次 `targetSubjectIds`，MUST NOT 重复，并 MUST 按目标标识在请求中的相对顺序返回。Gateway MAY 省略不存在或调用者无权查看的目标用户；省略时 MUST NOT 通过错误、占位字段或诊断泄漏该用户是否存在。Gateway 收到已取消 signal 时 MUST 返回 category 为 `CANCELED` 的 presentation-safe `SafeError`，且 MUST NOT 返回部分成功结果。Gateway 的结果、`SafeError` 和安全诊断 MUST NOT 包含未请求用户、credential、token、原始 provider payload 或未经授权的用户属性。

**需求类别**：功能性需求

#### Scenario: 批量查询返回有序用户结果

- **WHEN** 调用者在可信 Owner Scope 下查询三个互不重复的目标用户标识
- **THEN** Gateway MUST 返回请求目标集合的一个有序子集
- **AND** 每个返回项 MUST 只包含对应 `subjectId` 和合法 `userName`

#### Scenario: 缺失用户不泄漏存在性

- **WHEN** 至少一个目标用户不存在或调用者无权查看
- **THEN** Gateway MUST 从 `users` 中省略该目标用户
- **AND** 其它已授权目标用户仍按请求相对顺序返回

#### Scenario: 拒绝越界或重复目标集合

- **WHEN** `targetSubjectIds` 为空、超过 10000 项、包含重复标识或包含未知字段
- **THEN** runtime schema validation MUST 拒绝该请求
- **AND** Gateway operation MUST NOT 被执行

#### Scenario: 查询被取消

- **WHEN** `queryUsers` 观察到已取消的 `AbortSignal`
- **THEN** Gateway MUST 返回 category 为 `CANCELED` 的 presentation-safe `SafeError`
- **AND** MUST NOT 返回部分用户结果

### Requirement: 用户查询 Gateway 通过正式 adapter 注册

稳定 `GatewayAdapterKind` 集合 MUST 包含 `user-query`。`GatewayBindings` MUST 以 optional `userQuery?: UserQueryGateway` 暴露该单一 Gateway port，MUST NOT 为该单一 port 增加一层只包含它的聚合 bindings，也 MUST NOT 把它放入 Working Memory、Long-term Memory 或 SQLite bindings。

当 frozen gateway selection 包含 selected `user-query` entry 时，受信 provider MUST 声明支持同 deployment mode 的 `user-query` 并返回非空 `GatewayBindings.userQuery`。provider 缺失、binding 缺失、provider 返回未选择的 `userQuery`，或多个 provider 返回 `userQuery` 时，composition MUST 在 ready 前以安全配置错误失败。系统 MUST NOT 在运行期切换 adapter 或在 REMOTE selection 失败时回退到 LOCAL 实现。

当 source configuration 完全省略 `gateway` section 时，LOCAL 默认 gateway entries MUST 包含 `gatewayId=local-user-query`、`gatewayKind=user-query`、`deploymentMode=LOCAL`。LOCAL provider MUST 为每个请求的目标标识返回 `userName="${subjectId}-name"`，并 MUST 保持请求顺序。REMOTE provider 的 transport、认证 header、wire DTO 和 provider 错误映射不属于本契约；REMOTE selected `user-query` 仍 MUST 满足同一 `UserQueryGateway` 输入、输出、取消和安全语义。

**需求类别**：功能性需求

#### Scenario: 省略 Gateway 配置时获得 LOCAL 用户查询

- **WHEN** LOCAL source configuration 完全省略 `gateway` section
- **THEN** frozen gateway selection MUST 包含 LOCAL `user-query` entry
- **AND** merged `GatewayBindings.userQuery` MUST 可用

#### Scenario: LOCAL 用户名是确定性映射

- **WHEN** LOCAL `UserQueryGateway` 查询目标 `subject-a` 和 `subject-b`
- **THEN** 结果 MUST 依次包含 `subject-a-name` 和 `subject-b-name`
- **AND** 不得访问外部用户服务或写入用户数据

#### Scenario: REMOTE selection 缺少 provider

- **WHEN** frozen gateway selection 包含 REMOTE `user-query` entry
- **AND** 没有恰好一个同 deployment mode 的 provider 声明支持该 adapter
- **THEN** startup MUST 在 ready 前失败
- **AND** MUST NOT 使用 LOCAL 默认实现继续启动

#### Scenario: Provider 返回未选择或冲突 binding

- **WHEN** provider 返回未分配给它的 `userQuery`，或多个 provider 同时返回非空 `userQuery`
- **THEN** composition MUST 在 ready 前以安全 binding 错误失败
- **AND** MUST NOT 任意选择或覆盖 binding
