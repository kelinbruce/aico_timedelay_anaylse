## ADDED Requirements

### Requirement: Gateway configuration is loaded and stabilized during startup

系统 SHALL 在 startup / bootstrap 阶段读取 gateway 配置组，并在 app-level configuration freeze 完成前完成 gateway adapter selection、校验和冻结。当 source configuration 完全省略 `gateway` section 时，系统 SHALL 应用默认 sqlite gateway 配置，使单进程本地部署无需显式 gateway entry 即可启动。

#### Scenario: System reaches ready state

- **WHEN** 系统对外报告 ready
- **THEN** gateway configuration 已经完成读取、校验和冻结
- **AND** downstream modules 消费的是冻结产物而不是原始 source 配置

#### Scenario: Gateway section omitted defaults to local

- **WHEN** source configuration 完全省略 `gateway` section
- **THEN** 系统 MUST 应用默认 sqlite gateway 配置
- **AND** 启动结果与显式配置 sqlite entry 一致

### Requirement: Gateway configuration owns provider selection and bindings handoff

gateway configuration SHALL 负责 provider selection and bindings handoff：判断每个 gateway entry 选择哪个 gateway adapter / provider、selected provider 是否由 trusted composition input 注入、provider 是否成功创建稳定 `GatewayBindings`。

它 MUST NOT 重新定义 gateway port 业务语义、model invocation、ToolBank / Memory / RAG 检索策略、capability conflict 规则、全局 configuration lifecycle、secret grammar / resolution 规则，也不拥有 vendor endpoint / `baseUrl`、credential reference 等私有 access baseline 字段语义。这些接入参数属于具体 provider package 或后续 remote dependency / platform gateway change。

#### Scenario: Downstream module needs gateway adapter access

- **WHEN** 下游模块需要使用某个 gateway dependency
- **THEN** 它 MUST 通过 gateway port 和冻结后的 gateway selection snapshot 消费配置事实
- **AND** 它 MUST NOT 重新解析原始 gateway source 配置

### Requirement: Adapter selection is a static per-port deployment decision

对于每个 gateway entry / gateway port，local-gateway 与 remote-gateway 共享同一接口；部署配置 SHALL 在启动期让该 entry 声明的 selected adapter 生效。同一 app 可以同时注入 local provider 与 remote provider，并由不同 provider 承载不同 adapter。系统 MUST NOT 在运行时动态切换或回退到另一个 adapter 实现；selected adapter 不可用时贡献 blocking issue。

#### Scenario: Only the configured adapter is effective per port

- **WHEN** 部署配置为某 gateway port 配置 local adapter
- **THEN** local-gateway 的实现进入该 port 的有效调用路径
- **AND** remote-gateway 对该 port 的实现保持注册但不生效

#### Scenario: No runtime dynamic fallback

- **WHEN** selected remote adapter 的 gateway port 在运行时不可用
- **THEN** 系统 MUST NOT 自动回退到 local adapter
- **AND** MUST 贡献 blocking issue

### Requirement: Validation follows deterministic rule order

startup validation MUST 按以下顺序执行：

1. gateway 配置组存在且结构可解析
2. `gatewayId` 非空且唯一
3. `adapterKind` 属于当前产品允许的稳定选择集合
4. 同一 `adapterKind` 在 gateway source set 内至多出现一次
5. 每个 entry 的 `deploymentMode` 已确定
6. 每个 entry 的 selection 判定完成

首版稳定选择集合包含系统所有 gateway provider：`sqlite`、`sandbox`、`scheduled-maintenance`、`rag-knowledge`、`skillhub`。每种 adapterKind 在 gateway source set 内至多出现一次。entry 存在即生效，不使用 `enabled` 字段进行选择判定。

`deploymentMode` 决定 gateway entry 由哪个 injected `GatewayProvider` 提供实现。配 `deploymentMode: "LOCAL"` 时，该 entry MUST 由 trusted local provider 支撑；配 `deploymentMode: "REMOTE"` 时，该 entry MUST 由 trusted remote provider 支撑。配置层只校验 adapter kind 属于当前产品稳定集合；具体 local / remote provider 是否支撑该 adapter kind 由 composition 阶段根据 injected provider 的 `supportedAdapterKinds` 校验。对应 provider 未注入、未声明支撑该 adapter kind 或 deployment mode 不匹配时 startup MUST fail。

#### Scenario: No gateway entry is configured

- **WHEN** 当前 gateway source set 没有任何 gateway entry
- **THEN** startup MUST fail before ready state

#### Scenario: Gateway adapter kind is duplicated

- **WHEN** 多个 gateway entry 共用同一 `adapterKind`
- **THEN** startup MUST fail before ready state

#### Scenario: Gateway adapter kind not supported by selected provider

- **WHEN** 一个 gateway entry 配了 `deploymentMode: "REMOTE"` 但 injected remote provider 未声明支撑该 `adapterKind`
- **THEN** startup MUST fail
- **AND** 当一个 gateway entry 配了 `deploymentMode: "LOCAL"` 但 injected local provider 未声明支撑该 `adapterKind` 时 startup 也 MUST fail

### Requirement: Gateway entries are selected independently by deployment mode

每个 gateway entry MUST 独立声明 `deploymentMode`。`deploymentMode` 区分 LOCAL 与 REMOTE，与 `gatewayKind` 组合表达该 gateway entry 的部署形态。配置层 MUST 对所有 entries 执行结构、唯一性和 adapter kind 稳定集合校验；provider 支持性和 dependency readiness MUST 在 app composition 阶段由 selected provider 校验。

#### Scenario: Remote gateway entry is selected in a local product deployment

- **WHEN** 当前 product deployment mode 是 `LOCAL`，但某 gateway entry 声明 `deploymentMode: "REMOTE"`
- **THEN** 该 remote gateway entry MUST remain selected
- **AND** startup MUST resolve an injected remote provider for that entry
- **AND** missing or unsupported remote provider MUST block before ready

### Requirement: Successful startup produces stable gateway section artifacts

成功的启动 SHALL 至少产生：

- `GatewaySelectionSnapshot`
- `GatewayBindings` readiness proof
- gateway section diagnostics contribution

这些产物 SHALL 在当前进程生命周期内保持只读，并且能够追溯到 `gatewayId`。

#### Scenario: Adapter composition happens after startup

- **WHEN** app composition 开始装配具体 gateway adapter
- **THEN** 它 MUST 消费冻结后的 gateway artifacts
- **AND** 它 MUST NOT 重新解释原始 source 配置

### Requirement: Gateway providers are injected through trusted app composition

系统 SHALL 通过 trusted app composition input 接收 gateway provider 实例。`agent-app` core composition MUST 只依赖 `GatewayProvider` / `GatewayBindings` SPI 和结构化 composition option，不得 import concrete local gateway provider factory、concrete remote gateway provider factory、concrete gateway package 或 vendor remote entrypoint package。

`GatewayProvider` 至少 SHALL 暴露：

- `providerId`
- `deploymentMode`（`"LOCAL"` 或 `"REMOTE"`）
- `create(input: GatewayProviderCreateInput): GatewayBindings`

`GatewayProviderCreateInput` SHALL include only the selected gateway entries assigned to that provider and safe runtime context required to create bindings for those entries. Provider implementation MUST create bindings only for selected adapter kinds it supports; unselected adapter kinds MUST NOT be created as a side effect. Agent-aware bindings MAY remain in app composition when their construction requires active Agent Scope that is not part of gateway configuration.

`GatewayBindings` SHALL 只暴露稳定 gateway ports、bindings readiness 和 safe close lifecycle；MUST NOT 暴露 adapter 私有 client、SDK 类型、连接池、raw endpoint、raw credential 或原始 provider config。

#### Scenario: Local entrypoint injects local provider

- **WHEN** 官方 local entrypoint 启动 app
- **THEN** local entrypoint MUST be owned by `agent-platform-gateway-local/entrypoints/local`
- **AND** local entrypoint MUST import concrete local gateway provider
- **AND** MUST call `createNextAgentApp` or `createComposedApp` with `gatewayProviders`
- **AND** MAY inject local fallback factories for sync local startup and test harnesses
- **AND** `agent-app` MUST NOT export this local product entrypoint
- **AND** `agent-app` core composition MUST resolve provider through the SPI registry rather than importing the concrete provider factory

#### Scenario: Remote entrypoint injects vendor remote provider

- **WHEN** vendor remote entrypoint 启动 app
- **THEN** remote entrypoint MUST be owned by an external vendor remote entrypoint package
- **AND** in-repo `agent-platform-gateway-remote` MUST remain an implementation reference package and MUST NOT export a runnable app entrypoint
- **AND** in-repo `agent-platform-gateway-remote` MAY provide reference `GatewayBindings` assembly for stores, sandbox, RAG retrieval and scheduled maintenance to support vendor secondary development
- **AND** remote entrypoint MUST require the caller or vendor package to provide the complete remote `gatewayProviders` and required remote binding factories
- **AND** MUST call `createNextAgentApp` or `createComposedApp` with explicit `gatewayProviders`
- **AND** MUST NOT provide a zero-argument default startup path unless the package owns complete remote bindings for every app-required gateway capability
- **AND** `agent-app` MUST NOT depend on the vendor package

### Requirement: Gateway registry resolves selected providers per gateway entry

系统 SHALL 在 gateway configuration freeze 后创建 gateway registry，并根据冻结后的 gateway selection 按 selected entry 的 `deploymentMode` 分组 resolve provider。每个 deploymentMode group MUST resolve exactly one provider；provider 的 `deploymentMode` MUST 与分配给它的 selected gateway entries 的 `deploymentMode` 匹配；provider identity、deployment mode 或 selected adapter kind 不匹配时 startup MUST fail closed。多个 provider 被选中时，系统 SHALL 合并各 provider 返回的 `GatewayBindings`，并在 merged bindings 覆盖全部 selected adapter 后才能 ready。

#### Scenario: Provider is missing

- **WHEN** frozen gateway selection requires a provider that is absent from `gatewayProviders`
- **THEN** startup MUST fail before ready
- **AND** system MUST NOT fallback to another provider

#### Scenario: Provider deployment mode does not match selection

- **WHEN** selected gateway entry requires `deploymentMode: "REMOTE"` but the resolved provider declares `deploymentMode: "LOCAL"`
- **THEN** startup MUST fail before ready
- **AND** diagnostics MUST include a safe provider mismatch reason

#### Scenario: Provider create fails

- **WHEN** selected provider `create(input)` fails or returns invalid bindings
- **THEN** startup MUST fail before ready
- **AND** system MUST NOT fallback to local provider
- **AND** diagnostics MUST NOT expose raw provider-native error body

#### Scenario: Local and remote providers are both selected

- **WHEN** gateway configuration selects `sqlite` with `deploymentMode: "LOCAL"` and `sandbox` / `rag-knowledge` / `skillhub` with `deploymentMode: "REMOTE"`
- **THEN** system MUST call the local provider only with the local selected entries
- **AND** system MUST call the remote provider only with the remote selected entries
- **AND** system MUST merge returned bindings before downstream modules consume gateway ports
- **AND** missing bindings from either provider MUST block startup

### Requirement: Gateway capability evidence covers provider and bindings readiness

package candidate evidence、startup proof 或 readiness proof SHALL 记录 gateway 能力落地事实，至少包括 selected provider id、deployment mode、gateway selection snapshot reference 和 bindings readiness reference。remote adapter 被选中时，证据 MUST prove remote provider was injected, resolved and created bindings successfully；local 与 remote provider 同时被选中时，证据 MUST preserve enough provider/readiness references to prove every selected provider reached READY.

#### Scenario: Remote package candidate is qualified

- **WHEN** remote entrypoint package candidate is qualified
- **THEN** qualification evidence MUST include selected remote provider id
- **AND** MUST include `deploymentMode: "REMOTE"`
- **AND** MUST include gateway bindings readiness proof

#### Scenario: Remote package candidate lacks remote provider

- **WHEN** remote package candidate cannot inject a `deploymentMode: "REMOTE"` provider required by frozen gateway selection
- **THEN** qualification MUST be blocked
- **AND** candidate MUST NOT be reported as local-ready fallback

### Requirement: Package launcher selects deployment entrypoint from frozen deployment mode

package startup launcher SHALL read the candidate `default-system.yaml` and use the frozen `deployment.mode` to select a deployment entrypoint declared by `deployment.deploymentEntrypointRefs` or by the package manifest. Config-declared entrypoints SHALL override or supplement manifest-declared entrypoints. `deployment.mode: "LOCAL"` SHALL select the merged LOCAL entrypoint; `deployment.mode: "REMOTE"` SHALL select the merged REMOTE entrypoint. The launcher MUST NOT import concrete local / remote gateway provider packages by convention and MUST NOT fallback to the LOCAL entrypoint when the REMOTE entrypoint is missing or unavailable.

If the selected deployment entrypoint uses a package module specifier, the launcher SHALL resolve it from the candidate package root dependency graph. This allows a packaged remote deployment module and its remote gateway dependency to be distributed with the runtime candidate without adding static `agent-app` dependencies on concrete local or remote gateway packages.

#### Scenario: Local package selects local startup script

- **WHEN** candidate config declares `deployment.mode: "LOCAL"`
- **THEN** package startup MUST select the config-or-manifest-declared LOCAL deployment entrypoint
- **AND** the LOCAL entrypoint MAY start the official local runtime package path

#### Scenario: Remote package lacks remote startup script

- **WHEN** candidate config declares `deployment.mode: "REMOTE"`
- **AND** neither `deployment.deploymentEntrypointRefs` nor the package manifest declares a REMOTE deployment entrypoint
- **THEN** package startup MUST fail before ready
- **AND** startup proof MUST include a safe missing deployment entrypoint reason
- **AND** startup MUST NOT fallback to the LOCAL deployment entrypoint

#### Scenario: Remote package uses packaged deployment and gateway packages

- **WHEN** candidate config declares `deployment.mode: "REMOTE"`
- **AND** `deployment.deploymentEntrypointRefs` or the package manifest declares a REMOTE deployment entrypoint package specifier
- **AND** the candidate package contains that deployment package and its remote gateway dependency
- **THEN** package startup MUST resolve the deployment entrypoint from the candidate package root dependency graph
- **AND** startup MUST NOT require `agent-app` to statically depend on concrete local or remote gateway packages

#### Scenario: Remote deployment is built in the same workspace

- **WHEN** vendor remote code is merged into the NextAgent workspace for one-shot packaging
- **THEN** remote gateway implementation MUST be provided by `agent-platform-gateway-remote`
- **AND** the remote deployment package MAY depend on `agent-app` because it is the deployment assembly owner
- **AND** workspace build MUST compile the remote deployment package without adding static concrete gateway dependencies to `agent-app`

### Requirement: Selected entry failure blocks startup

如果任一 selected gateway entry 校验失败，gateway section MUST 贡献 blocking issue，且 app-level configuration validation MUST 在 ready 前阻断启动。

#### Scenario: Gateway identifier is duplicated

- **WHEN** 多个 gateway entry 共用同一 `gatewayId`
- **THEN** startup MUST fail

#### Scenario: Gateway adapter kind is duplicated

- **WHEN** 多个 gateway entry 共用同一 `adapterKind`
- **THEN** startup MUST fail

### Requirement: Gateway diagnostics are safe and non-leaking

gateway validation 和 readiness diagnostics MUST 只输出 safe field ref、reason code 和脱敏摘要；它们 MUST NOT 暴露 raw secret、credential、未授权存在性细节或 adapter-native payload。

#### Scenario: Gateway validation reports a selection problem

- **WHEN** 系统输出 gateway selection 相关诊断
- **THEN** 诊断只包含 safe reason 和 field reference
- **AND** 不包含 raw secret 或 provider-native error body
