# extension-registration Specification Delta

## Added Requirements

### Requirement: Extension 注册是确定性的、仅在启动期发生且被冻结

系统 SHALL 通过确定性的启动期 contribution registry 注册框架 extension。Extension 注册 MUST 在系统进入 ready 状态或接受 request、stream、history 或 control 流量之前完成。

冻结的注册结果 SHALL 以进程重启为范围。Runtime 请求、客户端 metadata、Skill 内容、ready 之后的文件系统变更、gateway 响应和 capability 参数 SHALL 在重启前观察到同一个冻结的框架 contribution snapshot。

Contribution 来源 MUST 可信且确定：`agent-capability` builtin 使用 owner-local 稳定列表，外部 owner contribution 使用所属 package 的 public contribution factory，显式的产品 composition 输入，以及由 `agent-capability` 转换的配置驱动的 provider 定义。系统 SHALL 只通过这些启动期 contribution 输入发现框架 contribution。

AgentAssembly 启动物化 MAY 在 extension 注册校验完成之前发生，但该物化 SHALL 只执行格式和结构安全检查。跨资源有效性检查，包括 model profile 引用、capability provider 引用、lifecycle hook 激活有效性、路由目标有效性、Agent 绑定可见性、parent scope 和 invocation policy 检查，MUST 在启动资源和 capability contribution 组装完成后、系统进入 ready 状态之前运行。如果启动图校验失败，系统 MUST 失败关闭，MUST NOT 接受 request、stream、history 或 control 流量。

#### Scenario: Ready 状态冻结 extension registry

- **WHEN** 系统达到 ready
- **THEN** builtin capability contribution 和启动期 provider contribution 已被发现、校验并冻结
- **AND** 之后的请求流量使用冻结的 contribution snapshot

#### Scenario: Runtime 输入不能变更 extension registry

- **WHEN** 请求体、客户端 metadata、Skill 内容或 capability 参数包含类似 contribution 的数据
- **THEN** 框架 extension 注册继续只使用启动期 contribution 输入
- **AND** 冻结的 registry 保持不变

#### Scenario: AgentAssembly 物化不要求 provider 事实

- **WHEN** app composition 在启动期从可信 Agent 定义物化 AgentAssembly 事实
- **THEN** 物化只校验格式和结构安全约束
- **AND** 它不要求 capability provider 事实、model profile readiness、lifecycle hook 定义、路由目标或 capability catalog descriptor 可用
- **AND** 这些跨资源引用由启动图校验在 ready 之前校验

#### Scenario: 无效启动图阻断 ready

- **WHEN** 物化的 AgentAssembly 事实引用缺失或禁用的 model profile、capability provider、lifecycle hook、路由目标，或存在无效的 Agent 绑定可见性、无效 parent scope
- **THEN** 启动图校验产生阻断性安全诊断或等价的阻断性 readiness 结果
- **AND** 应用不进入 ready 状态
- **AND** 不接受 request、stream、history 和 control 流量

#### Scenario: Import 副作用不注册框架 contribution

- **WHEN** 一个包含可能 contribution 的模块被导入
- **THEN** 注册只通过显式的启动期 contribution registry 输入发生
- **AND** 冻结的 registry 恰好包含启动期 contribution 集合

### Requirement: Builtin capability contribution 是 owner 拥有的启动期事实

Builtin tool 和其他框架拥有的 builtin capability SHALL 通过由 `agent-capability` 组装的、owner 拥有的 builtin capability contribution 进入 capability 系统。Capability catalog 组合 SHALL 消费子系统启动期间产生的冻结 builtin contribution snapshot。

每个 builtin capability contribution SHALL 携带既有 capability 治理路径所要求的相同 executable 和 descriptor 事实。对 Tool contribution 而言，该 contribution MUST 提供一个 `ToolDefinition` 或等价的 Tool 框架输入，MUST 继续使用既有 Tool catalog、descriptor 投影、输入/输出 schema 校验、provider 感知的 executable 查找、replay 策略、依赖 readiness、risk policy、cancellation 和 safe error mapping。

新增一个 builtin capability contribution SHALL 通过 owner 拥有的 contribution 输入和既有 app composition 依赖完成。Builtin Tool contribution SHALL 使用 `agent-capability` owner-local 稳定列表作为启动期 contribution 输入。Builtin contribution SHALL 使用既有 descriptor DTO、capability invocation 协议、provider 感知 executor 查找和 owner 创建的执行映射。

#### Scenario: 新 builtin Tool 进入既有 catalog 路径

- **WHEN** 一个所属 package 通过启动期 contribution registry 贡献一个新的 builtin Tool
- **THEN** 该 Tool 被加入 `agent-capability` owner-local 稳定列表
- **AND** 该 Tool 在启动后通过既有 capability discovery/catalog 列表路径出现
- **AND** 调用使用既有 capability invocation 边界和 Tool executor 行为

#### Scenario: Builtin contribution 保持治理

- **WHEN** 一个 builtin capability contribution 缺少依赖、schema 无效或 capability id 冲突
- **THEN** 在该 capability 变为可执行之前适用既有的 availability、validation 和冲突治理规则
- **AND** 该 contribution 通过与其他 capability 相同的路径进入 catalog 治理

### Requirement: 启动期 capability provider contribution 是 owner 拥有的启动期事实

框架和保留的 capability provider SHALL 作为启动期资源 provider contribution 注册，由拥有该 provider 语义的 package 所拥有。`agent-capability` SHALL 为其框架拥有的 builtin/保留 provider 拥有 capability contribution 组装，SHALL 产生冻结的 provider contribution snapshot 作为权威的启动期 provider 事实来源。

跨 package 的 provider contribution contract（包括 `CapabilityProviderContribution`、provider 绑定的 discovery public SPI 和 provider 中立的 executor public SPI）SHALL 定义在 `agent-contracts/capability` 之下并通过该 public contract subpath 导出。`agent-capability` SHALL 消费该 contract 进行组装和校验；`agent-contracts/capability` 保持跨 package contribution 类型的 contract owner。

App composition 边界 SHALL 向 `agent-capability` 提供配置、adapter/options、来自其他模块的可信 owner contribution 和外部 contribution 输入，向 runtime/scheduler owner 注册 owner 提供的 lifecycle/maintenance hook，并消费组装后的 capability 子系统暴露的 `CapabilityProvider[]` 事实用于启动图校验。`agent-capability` SHALL 在子系统组装期间枚举、构造并绑定其拥有的 builtin/保留 provider discovery 和 executor 对象。

`CapabilitySubsystem` MUST NOT 把 contribution snapshot、discovery 实例、executor 实例、provider config 选项，或 Tool 依赖 port（如 `WorkspaceFilePort`）作为 public return 字段暴露。`WorkspaceFilePort`、sandbox 文件系统准备、run 范围 snapshot 清理、Skill 资源投影清理和 workspace 文件安全诊断是 capability 拥有的语义。App composition MAY 传递可信的 runtime workspace 事实、gateway execute adapter、risk policy evaluator、policy provider 或组装这些 capability 拥有依赖所需的其他选项，但 MUST NOT 直接创建、保留或调用 `WorkspaceFilePort`。

外部 owner contribution SHALL 由所属模块通过其 public exports 构造。App composition MAY 调用所属模块的 public contribution factory 并把返回的 contribution 传给 `agent-capability`。

每个启动期 provider contribution SHALL 把恰好一个 provider identity 绑定到恰好一个 discovery 对象和至多一个 executor 对象。Contribution 中的 provider identity 是权威的。Discovery 对象 SHALL 把 provider 和 discovery mode 作为 public SPI 暴露。Discovery 的 provider identity MUST 与 contribution 的 provider identity 一致。Executor 对象 MUST NOT 把 provider 作为 public SPI 暴露；同一 executor 对象 MAY 被多个 provider contribution 复用，executor 的 provider 绑定通过 contribution 组装和 `agent-capability` 内部的 provider 感知 executor 查找应用。

启动期 provider contribution MAY 包含 provider identity、provider kind、默认启用策略、discovery 支持、executor 支持、依赖要求和进入既有资源清单与 capability catalog 路径所需的安全 metadata。

保留 provider（如 builtin、local/system、agent-owned、memory、workflow 或其他框架拥有的 provider）SHALL 通过可信启动期 contribution 声明。用户 capability provider 配置 SHALL 继续只定义用户配置的外部或本地 provider，并在校验需要时消费已注册的支持事实。

#### Scenario: 新保留 provider 进入资源清单

- **WHEN** 一个所属 package 在启动期贡献一个新的框架/保留 capability provider
- **THEN** `agent-capability` 把该 provider 纳入冻结的 contribution snapshot，并通过 `CapabilitySubsystem.capabilityProviders` 暴露其 `CapabilityProvider` 事实
- **AND** capability discovery/execution 能通过既有 catalog 路径消费其注册的支持
- **AND** AgentAssembly 启动图校验能校验引用该 provider 的绑定，而 `agent-app` 无需维护单独的框架/保留 provider 列表

#### Scenario: 外部 owner 构造自己的 contribution

- **WHEN** `agent-memory` 贡献 `memory-tools` provider
- **THEN** `agent-memory` MUST 通过其 public package export 暴露一个 owner 拥有的 contribution factory
- **AND** app composition MAY 把返回的 contribution 传给 `agent-capability`
- **AND** memory ToolCatalog 构造和 memory provider 语义保持由 `agent-memory` 拥有

#### Scenario: 用户配置不能伪造保留 provider

- **WHEN** 用户配置试图声明一个为框架 contribution 保留的 provider id 或 provider kind
- **THEN** 启动校验 MUST 为该原始条目产生既有的配置失败结果
- **AND** 框架 provider 保持只由可信启动期 contribution 控制

### Requirement: Capability provider discovery 和 executor 支持随 provider contribution 一起注册

Capability provider contribution SHALL 注册其 descriptor 被列出和调用所需的 discovery 和 executor 支持。Discovery 支持 MUST 与既有 `CapabilityDiscovery` 和 catalog 治理路径集成，包括其声明的单一 discovery mode。Executor 支持 MUST 与既有 `CapabilityInvocationPort` 和 provider 感知的 executable 查找路径集成。

仅当 capability 模块能从 discovery 对象的显式 executable 接口推导出安全默认 executor 时，MAY 省略 executor 支持。默认 executor 推导 SHALL 使用该 executable 接口和 provider identity 检查。它 MUST 校验 discovery provider、contribution provider 和解析出的 descriptor provider 一致，并校验 discovery 暴露默认 executor 所需的 executable 查找面。

当一个 provider contribution 在资源清单中可见但缺少可执行 descriptor 所需的 discovery 或 executor 支持时，capability 子系统 SHALL 应用以下结果序列：组装记录一条安全诊断，catalog 把该可执行 descriptor 标记为不可用，请求执行时调用返回安全失败。

#### Scenario: Provider descriptor 没有 executor 支持

- **WHEN** 一个 provider contribution 列出可执行的 capability descriptor，但没有已注册 executor 能执行解析出的 provider/capability 对
- **THEN** 组装记录一条安全诊断
- **AND** catalog 把该 capability 标记为不可用
- **AND** 调用在执行前返回安全失败
- **AND** executor 查找使用 catalog 治理选择的 provider/capability 对

#### Scenario: Discovery 支持进入既有 catalog

- **WHEN** provider discovery 支持由启动期 contribution 注册
- **THEN** capability catalog 通过既有 discovery 边界消费 descriptor
- **AND** 冲突解决、Agent 绑定过滤、availability 规则和安全诊断仍然适用

### Requirement: Extension 注册校验产生安全且显式的结果

Extension 注册 MUST 校验 contribution 并呈现安全结果。校验 case SHALL 包括同一受治理 scope 内的重复 provider id、需要受治理解决的重复 capability id、没有注册支持的 provider kind、必需依赖缺失、无效 schema、discovery 支持缺失、executor 支持缺失和畸形 contribution metadata。

失败 MUST 按所属配置边界呈现为 startup/config/assembly 诊断或失败关闭的 readiness 结果。诊断 MUST 只包含安全的有界字段，例如 provider id、capability id、安全 reason code、severity 和有界摘要。

不依赖其他模块的 capability 拥有校验 MUST 在 `agent-capability` 内执行：同步的 contribution 形状、重复 provider、provider/discovery 不匹配和不受支持的 provider 支持失败，在无需 I/O 即可确定时 MUST 在子系统组装期间失败。需要 EAGER discovery 或异步 readiness 的 capability 拥有启动检查 MUST 通过 `validateStartupRegistration()` 的单一 capability 启动校验结果呈现。App composition SHALL 把该结果作为更广泛启动图校验的一个输入，SHALL NOT 重新实现 capability 拥有的 contribution 校验。

#### Scenario: 重复 provider contribution 产生阻断性结果

- **WHEN** 两个启动期 contribution 在同一受治理 scope 内声明相同的 provider id
- **THEN** 启动 MUST 产生阻断性安全诊断或等价的阻断性 readiness 结果
- **AND** 受治理的结果为该 provider id 保持单一权威 provider 事实

#### Scenario: 安全诊断脱敏不安全细节

- **WHEN** contribution 校验因畸形 metadata、缺失文件或缺失依赖而失败
- **THEN** 呈现的诊断 MUST 使用稳定的 reason code 和安全标识符
- **AND** 它 MUST 只包含启动诊断已批准的有界安全字段

#### Scenario: Workspace 文件边界由 owner 组装而非 app 拥有

- **WHEN** builtin 文件工具、Skill 资源投影、sandbox 文件系统准备或 run 清理需要 workspace 文件访问
- **THEN** `agent-capability` MUST 从可信启动选项/adapter 组装并拥有面向 Tool 的 WorkspaceFilePort 边界
- **AND** app composition MUST 只传递那些可信选项/adapter，并向相应 runtime/scheduler owner 注册 owner 提供的清理 hook 或调度 job
- **AND** `CapabilitySubsystem` MUST NOT 把 WorkspaceFilePort 作为 public 字段返回
- **AND** app composition MUST NOT 直接调用 `WorkspaceFilePort.clearRun`、`WorkspaceFilePort.sandboxFilesystem`、`WorkspaceFilePort.resolveView` 或等价的 workspace 文件操作

### Requirement: Extension 注册不重新定义执行语义

Extension 注册 SHALL 只定义框架 contribution 如何成为启动期事实。Request lifecycle、Agent Scope、Owner Scope、session/run 持久化、terminal commit、capability invocation、capability 冲突解决、risk policy、sandbox 执行、lifecycle hook 和 stream 投影仍由其既有模块和 spec 拥有。

已注册的 contribution MUST 进入既有 owner 边界。Builtin capability contribution 进入 capability 治理；provider contribution 进入启动期资源清单和 capability catalog；app composition 只连接组装后的子系统输出。

#### Scenario: 已注册 contribution 遵循既有 owner 边界

- **WHEN** 一个已注册 contribution 在请求执行期间被使用
- **THEN** 执行通过该 contribution 类型的既有所属模块边界进行
- **AND** request lifecycle、capability invocation 和 stream 投影使用其既有 owner 路径
