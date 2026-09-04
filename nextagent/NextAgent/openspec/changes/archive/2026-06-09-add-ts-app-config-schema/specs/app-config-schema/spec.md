## ADDED Requirements

### Requirement: App composition 配置在 ready 状态之前被校验并冻结

系统 SHALL 在启动/bootstrap 期间、request 生命周期之外、且在系统进入 ready 状态或接受任何 request、stream、history 或 control 操作之前，恰好执行一次 app composition 配置加载、校验和冻结。

该流程对当前进程启动 MUST 是同步的，并且 MUST 在 app composition、Agent assembly 解析或 readiness 发布对外可见之前完成。

#### Scenario: 启动带着已校验的配置事实进入 ready

- **WHEN** 系统在启动后报告 ready
- **THEN** app composition 配置已被加载、校验并冻结
- **AND** 下游模块消费从 `DefaultSystemConfig` 派生的 owning-boundary 投影，而不是 raw source 配置

#### Scenario: 正常 request 流量不触发配置校验

- **WHEN** 用户提交一个 request、恢复一个 stream、读取 history 或发送一个 control command
- **THEN** 系统不在该 request 生命周期中重新运行 app composition 配置校验

### Requirement: 配置所有权在框架、app composition 和 Agent package 三层之间保持拆分

系统 SHALL 把配置所有权保持在三个显式层：

- `framework/runtime config`
- `app composition config`
- `Agent package config`

`app composition config` SHALL 是唯一由 app composition 边界拥有的层。Agent package 配置 MUST NOT 覆盖 deployment 分支选择、gateway credential policy、channel transport 边界或框架拥有的 runtime 旋钮。

#### Scenario: 所有权违规在启动期间被拒绝

- **WHEN** 一个配置键或值跨越了它不拥有的所有权边界
- **THEN** 启动校验 MUST 拒绝该配置
- **AND** 系统 MUST 返回安全配置失败，而不是静默重新解释该输入

### Requirement: App composition schema 暴露稳定的首个发布组基线

app composition 配置 schema SHALL 为首个发布暴露以下稳定组：

- `deployment`
- `paths`
- `identity`
- `channel`
- `hostedAgent`
- `modelProfiles`
- `capabilityProviders`
- `gateway`

每个组 MUST 在配置边界下拥有一个稳定的 owning 契约。未来 change MAY 扩展某个组或其窄的 owning-boundary 投影，但 MUST NOT 通过引入竞争性的 app 级配置事实来源来绕过该基线。

#### Scenario: 被禁用或未激活的配置分支保持非权威

- **WHEN** 一个配置条目被禁用或属于未激活的 deployment 分支
- **THEN** 它 MAY 保留在 source 配置中
- **AND** 它 MUST NOT 成为当前进程激活的已校验 runtime config 的一部分

### Requirement: 校验遵循确定性的规则顺序

启动校验 MUST 按以下顺序应用 app composition 规则：

1. 解析启动配置源集合和优先级
2. 强制执行配置所有权边界
3. 校验必填的顶层组：`deployment`、`paths`、`identity`、`channel`、`hostedAgent`
4. 确定激活的 deployment 分支和选中的 adapter/source 分支
5. 对激活分支应用完整校验，对未激活分支只应用结构校验
6. 校验 `modelProfiles` 可行性并派生启用的 runtime model profile 集合
7. 校验 app 级 `capabilityProviders` 和 `gateway` 选择器与引用
8. 校验必需的激活分支 secret 引用、路径引用和选中的依赖引用
9. 派生 readiness 状态并收集安全诊断
10. 冻结 `DefaultSystemConfig` 并产出 `ConfigValidationEvidence` 作为 readiness/release 安全投影

系统 MUST NOT 把这些决定推迟到第一个在线 request。

#### Scenario: 没有可用启用 model profile 时阻止 ready 状态

- **WHEN** 校验完成且激活配置分支没有任何可用的启用 model profile
- **THEN** 启动 MUST 产生 `BLOCKED`
- **AND** 系统 MUST NOT 进入 ready 状态

#### Scenario: 未激活的远程分支不阻止本地启动

- **WHEN** 当前 deployment 分支选择了本地 gateway 路径，且存在一个 remote-only 分支但未被解析
- **THEN** 该 remote-only 分支 MAY 产生一个非阻塞诊断
- **AND** 它 MUST NOT 阻止激活本地分支的 ready 状态

### Requirement: 成功校验产出不可变配置工件

成功或降级成功的启动 SHALL 产出以下稳定工件：

- 已校验的 `DefaultSystemConfig`
- readiness 状态
- 安全诊断
- `ConfigValidationEvidence`

`DefaultSystemConfig` 对当前进程生命周期 SHALL 是不可变的，并且 SHALL 保持为 `agent-app` 内部。下游消费 MUST 使用该固定映射：

- Agent assembly 消费 `AgentAssemblyRegistry`
- model 消费由 `DefaultSystemConfig.modelProfiles` 构建的 restart 范围 `ModelProfileRegistry`
- gateway 消费者接收由 app 组合的 gateway port
- capability 消费者接收 capability catalog/provider registry
- `agent-app` 的 readiness 发布和 release 输入构造消费 `ConfigValidationEvidence`

下游模块 MUST NOT 选择或创建替代的配置投影。

#### Scenario: 下游 assembly 消费窄的冻结配置投影

- **WHEN** app composition 解析激活的 Agent assembly 或下游 runtime 依赖
- **THEN** 它 MUST 使用本 requirement 定义的固定 owning-boundary 投影
- **AND** 它 MUST NOT 重新读取或重新解释 raw 启动配置源集合
- **AND** 它 MUST NOT 把完整的 `DefaultSystemConfig` 作为跨 package 的 public 契约接收

### Requirement: 配置工件具有显式的安全形状和生命周期语义

系统 SHALL 保持以下最低工件语义：

- `RawDefaultSystemConfig`
  - 是已解析的 source 输入，MUST NOT 被当作已校验的 runtime 事实
- `DefaultSystemConfig`
  - 包含 deployment mode、runtime 路径、本地 auth/identity 配置、channel 配置、hosted agent ref、已校验的 model profile、已校验的 capability provider、选中的 gateway 配置、noop 边界配置以及 release/readiness 证据输入
  - 只包含 secret 引用，绝不包含已解析的 secret 值
  - 保持为 `agent-app` 内部，不从 `agent-contracts` 导出
- readiness 状态
  - MUST 是 `READY`、`DEGRADED_READY` 或 `BLOCKED` 之一
- 安全诊断
  - 包含 reason code、scope 或字段 ref、安全 message 以及 readiness 影响
- `ConfigValidationEvidence`
  - 包含 readiness 状态、安全 issue、已声明的降级、可选的 evidence ref 和求值时间

这些工件是启动/readiness 诊断，而不是 request 真相、checkpoint payload、pending input 对象、memory record 或用户可见的 conversation history。

#### Scenario: 配置诊断保持可追溯但非业务

- **WHEN** 系统向 readiness 检查或 release 资格评估呈现配置诊断
- **THEN** 这些诊断 MUST 保持可通过稳定的 ref 或 issue 字段追溯
- **AND** 它们 MUST NOT 成为 request history、terminal message 或 canonical runtime timeline 事实的一部分

### Requirement: 安全配置失败和诊断是显式的

配置失败和诊断 MUST 是展示安全且显式的。系统 SHALL 发出安全配置失败或安全诊断，而不是 raw 异常、raw provider body、raw 本地路径或 raw credential 材料。

语法或 schema 失败 MUST 以 validation-safe 失败呈现。缺失或未解析的激活关键依赖引用 MUST 以安全不可用或校验失败呈现。系统 MUST NOT 静默丢弃无效的激活配置。

#### Scenario: 无效激活 secret 引用安全地阻止启动

- **WHEN** 激活选中分支要求一个缺失、畸形或无法解析的 secret 引用
- **THEN** 启动 MUST 返回安全配置失败
- **AND** 该失败 MUST NOT 暴露 raw secret 值、未解析的文件内容或框架原生异常文本

### Requirement: 降级和阻断规则是显式的且 fail-closed

系统 SHALL 使用以下有界结果规则：

- 缺失必填顶层组 -> `BLOCKED`
- 所有权违规 -> `BLOCKED`
- 无效激活关键分支 -> `BLOCKED`
- 无效激活必需 secret/路径/依赖引用 -> `BLOCKED`
- 无效未激活分支 -> 仅非阻塞诊断
- 无效非关键激活条目且剩余激活集合仍可用 -> `DEGRADED_READY`

每当系统无法安全分类或脱敏一个配置问题时，系统 MUST fail-closed。

#### Scenario: 非关键激活条目被移除并得到 degraded-ready 结果

- **WHEN** 一个非关键激活配置条目无效，但剩余激活集合仍满足当前 deployment 分支的最低 runtime 前提
- **THEN** 启动 MAY 以 `DEGRADED_READY` 继续
- **AND** 被丢弃的条目 MUST 不出现在 `DefaultSystemConfig` 中
- **AND** 系统 MUST 保留一个标识被丢弃条目和 reason code 的安全诊断

### Requirement: 配置流程与下游组合和 release 门禁集成

冻结的 app 配置流程 SHALL 把启动路径连接到：

- app composition
- Agent assembly 解析
- model profile 选择基线
- capability provider 启用基线
- gateway adapter 选择基线
- readiness/health 诊断
- release 资格证据

没有下游模块 MAY 创建竞争性的 app 级配置状态机，或创建绕过冻结启动结果的 request 时回退路径。

系统 MUST NOT 在本 change 中引入 public 的 catch-all 配置对象或新的 `agent-contracts/configuration` owning 表面。任何未来的 public 配置契约变更都需要一个显式的契约精化 change。

`ConfigValidationEvidence` SHALL 是 `agent-app` 内部用于 readiness 发布和 release 输入构造的单一安全配置证据形状。它 SHALL 包含 readiness 状态、安全 issue、已声明的降级、可选的 evidence ref 和求值时间。本 requirement MUST NOT 创建对 `agent-app` 的实现 package 依赖。

实际的候选启动 SHALL 只暴露一个不透明的 `configValidationEvidenceRef` 用于 package/release 交接。Release 输入构造器 SHALL 把该 ref 解析为同一个内部 `ConfigValidationEvidence`。Package、E2E 门禁和资格评估消费者 MUST NOT 把它的字段复制进去，也 MUST NOT 定义替代的配置证据形状。

#### Scenario: Ready 状态发布等待配置冻结

- **WHEN** 系统正准备发布 readiness 或启动成功
- **THEN** 配置冻结和 readiness 状态派生已经完成
- **AND** health/readiness 消费者可以读取稳定的 readiness 状态

### Requirement: App composition 配置是 restart 范围的，不隐式热重载

app composition 配置事实对首个发布 SHALL 是 restart 范围的。在启动后更改 app 级配置 MUST 要求一次新的进程启动/bootstrap 周期，新配置才能变为权威。

#### Scenario: 运行期间编辑配置不改变激活配置

- **WHEN** 运维人员在进程已经在服务流量时编辑一个 app 级配置源
- **THEN** 当前的 `DefaultSystemConfig` 对该进程保持权威
- **AND** 新配置在一次新的启动/bootstrap 周期完成之前不会变为激活

### Requirement: 典型启动结果保持显式且可复现

系统 SHALL 为完整、降级和阻断配置路径产出显式且可复现的启动结果。

#### Scenario: 本地启动以一条可用激活路径达到 READY

- **WHEN** 激活的 deployment 分支拥有有效的必填组、至少一个可用的启用 model profile、一个可解析的激活 Agent 引用，以及可解析的激活 secret/路径/依赖引用
- **THEN** 启动 MUST 产生 readiness 状态 `READY`
- **AND** 系统 MUST 在组合下游消费者之前冻结 `DefaultSystemConfig`

#### Scenario: 无效的仅回退激活条目产生 DEGRADED_READY

- **WHEN** 激活的 deployment 分支仍有可用的最低 runtime 集合，但一个非关键激活条目（例如仅回退的 model profile）无效
- **THEN** 启动 MAY 产生 readiness 状态 `DEGRADED_READY`
- **AND** 该无效非关键条目 MUST 从 `DefaultSystemConfig` 中移除
- **AND** 系统 MUST 为被丢弃的条目保留一个安全诊断

#### Scenario: 唯一可用的激活 model 路径失败并阻止启动

- **WHEN** 唯一可用的启用激活 model profile 因其配置、provider kind 或激活 secret 引用无效而变为无效
- **THEN** 启动 MUST 产生 readiness 状态 `BLOCKED`
- **AND** 系统 MUST NOT 发布 ready 状态或可用的 runtime 配置投影

#### Scenario: 未激活分支失败保持非阻塞

- **WHEN** 一个未激活的 deployment 分支或未激活的 adapter/source 分支在结构上存在，但未被当前启动路径选中，且该分支不完整或不可服务
- **THEN** 系统 MAY 为该分支发出一个安全的非阻塞诊断
- **AND** 该未激活分支失败本身 MUST NOT 阻止激活的 deployment 分支达到 `READY` 或 `DEGRADED_READY`
