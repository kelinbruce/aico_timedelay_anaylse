# extension-registration Specification

## Purpose

定义框架自有 capability 贡献和框架/保留 capability provider 的稳定启动期扩展注册契约。本 spec 固化 builtin Tool、Skill 和 Agent provider、owner 提供的外部贡献、config 驱动的 provider 定义以及 startup graph 校验如何成为确定性的冻结 capability 注册快照，而不把 provider/Tool 业务语义移入 `agent-app`。
## Requirements
### Requirement: 扩展注册是确定性的、仅启动期的、冻结的

系统 SHALL 通过确定性的启动期贡献输入注册框架扩展。扩展注册 MUST 在 app 进入 ready 状态或接受依赖 runtime/capability 图的 request、stream、history、health-deep 或 runtime control 流量之前完成。

冻结的注册结果 SHALL 以进程重启为作用域。在进程重启并重新运行 startup composition 之前，runtime request、client metadata、Skill 内容、ready 之后的文件系统变更、gateway 响应、模型输出和 capability 参数 SHALL 观察同一个冻结的框架贡献快照。

可信贡献来源仅限于：

- owning package 内的 owner-local 稳定列表，例如 `agent-capability` 的 builtin Tool 定义；
- owning package 的公开贡献工厂，例如返回 `memory-tools` 贡献的 `agent-memory`；
- 显式的可信产品 composition 输入；
- user provider config 条目，经 startup resolver 校验并由 `agent-capability` 转换为 config 驱动的 provider 贡献后。

系统 MUST NOT 通过 import 副作用、runtime 装饰器、request payload、目录 watcher、Skill 正文内容、模型输出、gateway 响应或隐藏的全局可变 registry 注册框架贡献。

AgentAssembly startup materialization MAY 在扩展注册校验完成之前运行。该 materialization SHALL 只执行创建 runtime-safe assembly facts 所需的格式与结构安全检查。跨资源有效性检查（包括 model profile 引用、capability provider 引用、lifecycle hook 激活有效性、routing target 有效性、Agent binding 可见性、parent scope 和 invocation policy 检查）MUST 在 startup 资源和 capability 贡献完成组装之后、ready 之前运行。

如果 startup graph 校验失败，系统 MUST fail closed 且 MUST NOT 进入 ready。任何 request、stream、history 或 runtime control 操作都不得观察到部分组装的 capability 图。

#### Scenario: ready 状态冻结扩展 registry

- **WHEN** 系统达到 ready
- **THEN** builtin capability 贡献和 startup provider 贡献已经被发现、校验并冻结
- **AND** 后续 request 流量使用冻结的贡献快照

#### Scenario: runtime 输入不能改变扩展 registry

- **WHEN** request body、client metadata、Skill 内容、模型输出、文件变更或 capability 参数包含类似贡献的数据
- **THEN** 框架扩展注册继续只使用 startup 贡献输入
- **AND** 冻结的 registry 保持不变

#### Scenario: AgentAssembly materialization 不要求 provider facts

- **WHEN** app composition 在 startup 期间从可信 Agent 定义 materialize AgentAssembly facts
- **THEN** materialization 只校验格式和结构安全约束
- **AND** 它不要求 capability provider facts、model profile 就绪、lifecycle hook 定义、routing targets 或 capability catalog descriptors 可用
- **AND** 这些跨资源引用由 startup graph 校验在 ready 之前校验

#### Scenario: 非法 startup graph 阻断 ready

- **WHEN** materialized AgentAssembly facts 引用缺失或被禁用的 model profile、capability provider、lifecycle hook、routing target、非法 Agent binding 可见性或非法 parent scope
- **THEN** startup graph 校验产生阻断性 safe diagnostic 或等价的阻断性 readiness 结果
- **AND** app 不进入 ready 状态

### Requirement: capability provider 贡献是 owner 拥有的 startup facts

框架和保留的 capability provider SHALL 注册为 startup provider 贡献，由拥有该 provider 语义的 package 拥有。`agent-capability` SHALL 拥有框架自有 builtin/保留 provider 的 capability 贡献组装，并 SHALL 产出冻结的 provider 贡献快照作为权威的 startup provider fact 来源。

跨 package 的 provider 贡献契约 SHALL 定义在 `agent-contracts/capability` 下并通过该公开 subpath 导出。它包括 `CapabilityProviderContribution`、provider 绑定的 `CapabilityDiscovery`、provider 中立的 `CapabilityExecutor`，以及这些方法签名使用的公开支持类型。实现类和具体 provider 内部细节保持在 `agent-contracts` 之外。

每个 startup provider 贡献 SHALL 把恰好一个 `CapabilityProvider` 身份绑定到恰好一个 discovery 对象和至多一个 executor 对象：

- 贡献的 `provider` 是权威的 provider fact；
- discovery 对象是 provider 绑定的，MUST 暴露相同的 provider 身份和恰好一个 discovery mode；
- executor 对象是 provider 中立的，MUST NOT 把 provider 作为公开 SPI 暴露；
- 同一个 executor 对象 MAY 被多个 provider 贡献复用，provider 绑定由 `agent-capability` 内部组装施加。

保留 provider（如 `builtin-tools`、`builtin-skills`、`builtin-agents`、`local-skills-system`、`local-skills-agent-owned`、`local-agents`、`local-subagents` 和 `memory-tools`）SHALL 来自可信 startup 贡献。用户 capability provider 配置 SHALL 只定义用户配置的 provider，MUST NOT 声明、覆盖、禁用或伪造框架/保留 provider id。

`agent-app` MAY 调用公开的 owner 贡献工厂，并把返回的贡献作为外部贡献传给 `agent-capability`。它 MUST NOT 维护单独手工编写的框架/保留 provider 列表作为权威 startup registry。

#### Scenario: 新的保留 provider 进入资源 inventory

- **WHEN** 一个 owning package 在 startup 贡献新的框架/保留 capability provider
- **THEN** `agent-capability` 把该 provider 纳入冻结的贡献快照
- **AND** 通过 `CapabilitySubsystem.capabilityProviders` 暴露其 `CapabilityProvider` fact
- **AND** AgentAssembly startup graph 校验可以校验引用该 provider 的 binding，而无需 `agent-app` 维护单独的保留 provider 列表

#### Scenario: 外部 owner 构造自己的贡献

- **WHEN** `agent-memory` 贡献 `memory-tools` provider
- **THEN** `agent-memory` 通过其公开 package export 暴露一个 owner 拥有的贡献工厂
- **AND** app composition 可以把返回的贡献传给 `agent-capability`
- **AND** memory Tool catalog 构建和 memory provider 语义仍由 `agent-memory` 拥有

#### Scenario: 用户配置不能伪造保留 provider

- **WHEN** 用户配置试图声明为框架贡献保留的 provider id 或 provider kind
- **THEN** startup 校验以 safe diagnostic 拒绝该原始条目
- **AND** 框架 provider 仍然只由可信 startup 贡献控制

### Requirement: builtin capability 贡献是 owner 拥有的 startup facts

Builtin Tool 和其他框架自有的 builtin capability SHALL 通过由 `agent-capability` 组装的、owner 拥有的贡献进入 capability 系统。Capability catalog 组合 SHALL 消费 subsystem startup 期间产出的冻结 builtin 贡献快照。

每个 builtin Tool 贡献 SHALL 携带既有 capability 治理路径所要求的相同 executable 和 descriptor facts。Builtin Tool MUST 继续使用既有 Tool 框架：provider 中立的 Tool metadata、显式的 owner-local Tool 定义、Tool catalog descriptor projection、输入/输出 schema 校验、provider-aware executable lookup、replay policy、dependency readiness、risk policy、cancellation 和 safe error mapping。

新增一个 builtin capability 贡献 SHALL 通过修改 owning package 的稳定贡献输入和测试完成。它 MUST NOT 要求编辑 `agent-app` 来添加 provider id、capability id、tool 描述、discovery 对象、executor 对象或 Tool catalog 条目。

#### Scenario: 新的 builtin Tool 进入既有 catalog 路径

- **WHEN** 一个 owning package 通过 startup 贡献 registry 贡献新的 builtin Tool
- **THEN** 该 Tool 被加入 `agent-capability` 的 owner-local 稳定列表
- **AND** 该 Tool 在 startup 之后通过既有的 capability discovery/catalog 列表路径出现
- **AND** 调用使用既有的 capability invocation 边界和 Tool executor 行为

#### Scenario: builtin 贡献保持治理

- **WHEN** 一个 builtin capability 贡献存在缺失依赖、非法 schema 或冲突的 capability id
- **THEN** 既有的 availability、validation 和冲突治理规则在该 capability 变为可执行之前生效
- **AND** 没有任何 app 侧特例绕过 catalog 治理

### Requirement: capability discovery 和 executor 支持随贡献一起注册

Capability provider 贡献 SHALL 注册其 descriptor 被列出和调用所需的 discovery 和 executor 支持。Discovery 支持 MUST 与既有的 `CapabilityDiscovery` 和 catalog 治理路径集成。Executor 支持 MUST 与既有的 `CapabilityInvocationPort` 和 provider-aware executable lookup 路径集成。

Catalog discovery 输入保持 provider 绑定。`agent-capability` SHALL 校验贡献、冻结它们，并把 provider 绑定的 discovery 投影到 catalog 的 EAGER 和 SEARCH discovery 集合。Catalog 仍然拥有 descriptor 治理、Agent binding 过滤、default-enabled policy、availability 过滤、冲突解决，以及 `listAvailable` / `resolve` 一致性。

只有当 `agent-capability` 能够从 discovery 对象的显式 executable 接口派生安全默认 executor 时，才 MAY 省略 executor 支持。默认 executor 派生 MUST 校验贡献 provider、discovery provider 和已解析 descriptor provider 相互匹配。它 MUST NOT 仅从 `CapabilityKind` 推断可执行性。

当一个 provider 贡献在资源 inventory 中可见，但对某个可执行 descriptor 缺少所需的 discovery 或 executor 支持时，capability subsystem SHALL 施加同一条结果序列：组装记录 safe diagnostic，catalog 把该可执行 descriptor 标记为不可用，并且在请求执行时 invocation 返回 safe failure。

#### Scenario: provider descriptor 没有 executor 支持

- **WHEN** 一个 provider 贡献列出可执行的 capability descriptor，但没有已注册的 executor 能执行解析出的 provider/capability 对
- **THEN** 组装记录 safe diagnostic
- **AND** catalog 把该 capability 标记为不可用
- **AND** invocation 在执行前返回 safe failure
- **AND** executor lookup 使用 catalog 治理选择的 provider/capability 对

#### Scenario: discovery 支持进入既有 catalog

- **WHEN** provider discovery 支持由 startup 贡献注册
- **THEN** capability catalog 通过既有 discovery 边界消费 descriptor
- **AND** 冲突解决、Agent binding 过滤、availability 规则和 safe diagnostic 仍然生效

### Requirement: capability subsystem 拥有贡献组装 surface

`createCapabilitySubsystem()` SHALL 是 capability subsystem 的组合入口。它 SHALL 接收单个 options 对象，其中包含已校验的 provider 配置、外部 owner 贡献，以及组装 capability 拥有的依赖所需的可信 runtime/adaptor 选项。

该 subsystem SHALL 在内部创建 `agent-capability` 拥有的内部贡献、合并外部 owner 贡献、在已占用的 provider 身份集合已知后把 config 驱动的 provider 配置转换为贡献、校验/冻结贡献快照、组装 catalog discovery 和 executor lookup，并暴露 app composition 所需的 runtime port 和 provider facts。

公开返回 surface SHALL 包括：

- `catalog`；
- `invocationPort`；
- `capabilityProviders`；
- capability 拥有的 startup 校验/报告收集入口，例如 `validateStartupRegistration()` 和 `collectSkillScanReport()`；
- app composition 可向 runtime/scheduler owner 注册的、由 owner 提供的 cleanup/maintenance hook 或 job。

公开返回 surface MUST NOT 暴露贡献快照、discovery 实例、executor 实例、provider 配置选项、独立 diagnostics 字段，或面向 Tool 的依赖 port（如 `WorkspaceFilePort`）。

`WorkspaceFilePort`、sandbox filesystem 准备、Python 临时脚本准备、run 作用域的快照清理、Skill 资源投影清理和 workspace 文件 safe diagnostic 是 capability 拥有的语义。App composition 可以传递可信的 runtime workspace facts、执行 workspace resolver、gateway execute adapter、risk policy evaluator、policy provider、logger 或组装这些依赖所需的其他窄选项，但 MUST NOT 直接创建、保留、返回或调用 `WorkspaceFilePort`。

#### Scenario: capability subsystem 暴露 provider facts 而非内部细节

- **WHEN** app composition 创建 capability subsystem
- **THEN** app composition 接收 `CapabilitySubsystem.capabilityProviders` 作为 startup graph 校验的 provider fact 输入
- **AND** 它不接收贡献快照、discovery 对象、executor 对象或 `WorkspaceFilePort`

#### Scenario: workspace 文件边界由 owner 组装而非 app 拥有

- **WHEN** builtin 文件 Tool、Skill 资源投影、sandbox filesystem 准备或 run 清理需要访问 workspace 文件
- **THEN** `agent-capability` 从可信 startup 选项/adapter 组装并拥有面向 Tool 的 `WorkspaceFilePort` 边界
- **AND** app composition 只传递这些可信选项/adapter，并注册 owner 提供的 cleanup hook 或定时 job
- **AND** app composition 不直接调用 `WorkspaceFilePort.clearRun`、`WorkspaceFilePort.sandboxFilesystem`、`WorkspaceFilePort.resolveView` 或等价的 workspace 操作

### Requirement: 扩展注册校验产生安全且明确的结果

扩展注册 MUST 校验贡献并呈现安全结果。校验 case SHALL 包括同一治理 scope 内的重复 provider id、需要治理解决的重复 capability id、没有已注册支持的 provider kind、必需依赖缺失、非法 schema、discovery 支持缺失、executor 支持缺失、provider/discovery 不匹配，以及畸形的贡献 metadata。

不依赖其他模块的 capability 拥有的校验 MUST 在 `agent-capability` 内执行。同步的贡献 shape、重复 provider、provider/discovery 不匹配、不受支持的 provider 支持、面向 Tool 的 workspace/sandbox 依赖选项 shape 以及等价的本地组装失败，在无需 I/O 即可判定时 MUST 在 subsystem 组装期间失败。需要 EAGER discovery 或异步就绪的 capability 拥有的 startup 检查 MUST 通过 `validateStartupRegistration()` 的 capability startup 校验结果呈现。

App composition SHALL 把 capability startup 校验结果作为更广泛 startup graph 校验的一个输入。它 MUST NOT 重新实现 capability 拥有的贡献校验、provider 匹配、Tool executable lookup 规则、workspace 清理语义或 sandbox 请求准备。

Diagnostic MUST 只包含有界的安全字段，例如 provider id、capability id、安全 reason code、severity、source scope 和有界 summary。它们 MUST NOT 包含原始 provider body、原始本地路径、credential 材料、模型输出、Skill 正文内容、stack trace 或 adapter 原生异常文本。

#### Scenario: 重复 provider 贡献产生阻断性结果

- **WHEN** 两个 startup 贡献在同一治理 scope 内声明相同的 provider id
- **THEN** startup 产生阻断性 safe diagnostic 或等价的阻断性 readiness 结果
- **AND** 治理结果为该 provider id 保留唯一的权威 provider fact

#### Scenario: safe diagnostic 脱敏不安全细节

- **WHEN** 贡献校验因畸形 metadata、文件缺失或依赖缺失而失败
- **THEN** 呈现的 diagnostic 使用稳定的 reason code 和安全标识符
- **AND** 它只包含 startup diagnostic 批准的有界安全字段

### Requirement: 扩展注册不重新定义执行语义

扩展注册 SHALL 只定义框架贡献如何成为 startup facts。Request lifecycle、Agent Scope、Owner Scope、session/run 持久化、terminal commit、capability invocation、capability 冲突解决、risk policy、sandbox 执行、lifecycle hook、stream 投影、gateway 持久化和 observability 仍由其既有模块和 spec 拥有。

已注册的贡献 MUST 进入既有 owner 边界。Builtin capability 贡献进入 capability 治理；provider 贡献进入 startup 资源 inventory 和 capability catalog；app composition 连接已组装的 subsystem 输出并执行跨模块 ready 校验。

#### Scenario: 已注册贡献遵循既有 owner 边界

- **WHEN** 一个已注册的贡献在 request 执行期间被使用
- **THEN** 执行通过该贡献类型的既有 owning module 边界继续
- **AND** request lifecycle、capability invocation 和 stream 投影使用其既有 owner 路径

### Requirement: WorkflowSandboxExecutionPort 是 capability 拥有的窄 sandbox port

`agent-capability` SHALL 把 `WorkflowSandboxExecutionPort` 作为公开 export 暴露。该 port SHALL 只暴露用于通过 sandbox gateway 边界执行 Python 源码的 `runPython`。该 port SHALL NOT 暴露 `runShell`、`runShellStreaming`、`runShellBackgroundable`、`startBackgroundShell`、`WorkspaceFilePort`、sandbox gateway 内部细节，或任何 capability executor 或 catalog 内部细节。

`agent-capability` SHALL 使用与组装面向 Tool 的 `SandboxExecutionPort` 相同的可信 startup 选项，拥有 `WorkflowSandboxExecutionPort` 的组装。App composition MAY 传递组装该依赖所需的相同可信 startup 选项/adapter，但 MUST NOT 直接创建、保留、返回或调用 `WorkspaceFilePort` 或 `SandboxExecutionPort`。

该 port MUST 通过与面向 Tool 的 `SandboxExecutionPort.runPython` 相同的 sandbox gateway 边界、risk policy 和 safe error mapping 路由执行。该 port MUST NOT 通过 capability executor、capability catalog 或 nl2py guardrail 路由。

#### Scenario: port 只暴露 runPython

- **WHEN** `WorkflowSandboxExecutionPort` 由 `agent-capability` 创建
- **THEN** 该 port MUST 只暴露一个 `runPython` 操作
- **AND** MUST NOT 暴露 shell 执行、后台执行、streaming、workspace 文件或 sandbox 内部细节

#### Scenario: port 通过 sandbox gateway 路由

- **WHEN** `WorkflowSandboxExecutionPort.runPython` 被调用
- **THEN** 执行 MUST 通过 sandbox gateway 边界路由
- **AND** risk policy 和 safe error mapping MUST 生效
- **AND** MUST NOT 通过 capability executor 或 nl2py guardrail 路由

#### Scenario: app composition 不触碰 sandbox 内部细节

- **WHEN** app composition 创建 workflow node catalog
- **THEN** app composition MUST 从 `agent-capability` 接收 `WorkflowSandboxExecutionPort`
- **AND** MUST NOT 直接创建或调用 `SandboxExecutionPort` 或 `WorkspaceFilePort`
