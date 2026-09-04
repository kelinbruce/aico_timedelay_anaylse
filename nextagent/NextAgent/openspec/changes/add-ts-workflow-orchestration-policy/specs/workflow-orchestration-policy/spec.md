## ADDED Requirements

### Requirement: Workflow 与模型循环双模式

NextAgent SHALL 在 Agent 边界内支持两种 Agent 请求处理模式：确定性 workflow 执行和模型驱动循环执行。Workflow 模式 SHALL 为高频电信运维任务执行受治理的 workflow。模型循环模式 SHALL 继续通过 context assembly、model invocation 和受治理的 capability 使用处理通用或探索性任务。

#### Scenario: Workflow 模式处理匹配的高频任务
- **WHEN** Agent 路由为已受理请求选择已注册的 workflow
- **THEN** Agent Core MUST 为选中的 workflow 调用 workflow 执行路径
- **AND** 它 MUST NOT 在执行该 workflow 之前运行初始的模型驱动规划循环

#### Scenario: 模型循环模式仍是默认通用路径
- **WHEN** 没有受治理路由规则或策略结果选择 workflow
- **THEN** Agent Core MUST 继续走既有模型驱动循环路径
- **AND** 它 MUST NOT 从不可信的用户文本中编造 workflow 目标

#### Scenario: Workflow 失败不掩盖 terminal truth
- **WHEN** 选中的 workflow 返回 failed 或 interrupted 的 terminal 结果
- **THEN** 请求 MUST 通过既有的 runtime 拥有的 terminal lifecycle 保留该 terminal truth
- **AND** 任何向模型循环的降级 MUST 在可信策略配置或 spec 定义的 fallback 规则中显式声明

### Requirement: 开发者受治理的 Workflow 路由策略

NextAgent SHALL 允许 Agent 开发者配置 workflow 路由规则，并通过可信 Agent package composition 提供完整路由策略实现。两种形式 SHALL 产生受控路由决策，并 SHALL 保持在 Agent Core 治理之内。

#### Scenario: 开发者规则选择 workflow
- **WHEN** 可信 Agent 配置声明了一条匹配已受理输入且以 workflow 为目标的有序规则
- **THEN** 路由策略 MUST 仅在该 workflow 已为当前 `agentId` 注册时才选择它
- **AND** 当该 workflow 不可用时，它 MUST 按规则的受治理 fallback 行为降级或 fail closed

#### Scenario: 开发者规则选择模型循环
- **WHEN** 可信 Agent 配置声明了一条匹配已受理输入且以模型循环为目标的有序规则
- **THEN** 路由策略 MUST 选择模型驱动循环
- **AND** 它 MUST NOT 为同一请求评估后续的 workflow 规则

#### Scenario: 完整策略实现返回受控决策
- **WHEN** 可信 Agent package composition 提供完整路由策略实现
- **THEN** Agent Core MUST 通过受控 policy SPI 执行它
- **AND** Agent Core MUST 在分发到 workflow 或模型循环之前校验策略输出
- **AND** 非法策略输出 MUST 以安全策略错误 fail closed

#### Scenario: 策略输入受治理
- **WHEN** 路由策略评估一个请求
- **THEN** 它 MUST 只消费 runtime 已受理的请求事实、frozen Agent assembly 事实、可信 Agent 配置、受治理 workflow 元数据、受治理 capability 可见性、locale、identity 和 cancellation context
- **AND** 它 MUST NOT 把客户端提供的 owner 或 agent 字段、模型输出、capability 参数、超出已受理输入文本的 raw prompt 文本、不可信 metadata 或文件系统路径用作路由权威

### Requirement: 模型规划的 Workflow 候选

NextAgent SHALL 允许模型驱动循环为复杂任务提出 workflow 候选，但该候选 SHALL 仅在校验、治理和编译产出被 workflow engine 接受的 canonical workflow 之后才可执行。

#### Scenario: 模型为复杂任务提出 workflow
- **WHEN** 模型循环判定一个多步电信任务应以确定性方式执行
- **THEN** 它 MAY 通过受治理的规划输出通道产出 workflow 候选
- **AND** 在 workflow 校验和编译成功之前，Agent Core MUST 把该候选视为不可信

#### Scenario: 非法的模型 workflow 被拒绝
- **WHEN** 模型规划的 workflow 候选未通过 schema 校验、DAG 校验、策略校验、sandbox 编译或 capability 治理
- **THEN** 系统 MUST 以安全的规划错误拒绝该候选
- **AND** 它 MUST NOT 执行被拒绝候选中的任何节点

#### Scenario: 已受理的模型 workflow 通过同一引擎执行
- **WHEN** 模型规划的 workflow 候选被成功校验和编译
- **THEN** 产生的 canonical workflow MUST 通过预配置 workflow 所使用的同一 workflow 执行引擎执行
- **AND** 它 MUST 保留当前 Agent Scope、Owner Scope、request、session、run 和 cancellation context

### Requirement: 循环轨迹学习为 Workflow

当可信的 Agent 学习策略判定所观察到的路径具有确定性和可复用性时，NextAgent SHALL 支持从重复成功的模型驱动循环执行中学习可复用的 workflow 候选。learned 候选在通过治理、校验、编译和发布之前 SHALL NOT 成为可执行的 workflow。

#### Scenario: 重复的确定性循环路径产出 workflow 候选
- **WHEN** 同一 Agent 通过稳定的模型驱动循环路径反复完成相似的电信任务
- **AND** 可信学习策略把该路径归类为确定且可复用
- **THEN** 系统 MAY 从安全的执行轨迹摘要生成 learned workflow 候选
- **AND** 该候选 MUST 限定在当前 `agentId` 范围内

#### Scenario: Learned 候选在发布前不可执行
- **WHEN** 一个 learned workflow 候选尚未通过治理、workflow 校验、sandbox 编译和发布
- **THEN** Agent 路由 MUST NOT 为用户请求选择该候选
- **AND** workflow 执行 MUST NOT 执行该候选中的任何节点

#### Scenario: 已发布的 learned workflow 改进未来路由
- **WHEN** 一个 learned workflow 候选被发布为当前 Agent 的受治理 workflow
- **AND** 后续已受理请求命中其可信路由策略
- **THEN** Agent 路由 MAY 选择已发布的 workflow 路径而非模型驱动循环路径
- **AND** 它 MUST 保留与预配置 workflow 相同的 Agent Scope、Owner Scope、cancellation 和安全可观测性边界

#### Scenario: 学习输入是安全的
- **WHEN** 系统从模型驱动循环历史中推导 workflow 候选
- **THEN** 它 MUST 使用安全的轨迹摘要和受治理的 capability 引用
- **AND** 它 MUST NOT 把 raw prompt、raw model output、raw provider payload、raw capability 输入/输出、secret、credential、本地路径或 attachment 内容用作持久学习输入

### Requirement: Workflow DAG 校验与优化

Workflow 执行 SHALL 在执行前校验并优化 workflow DAG。优化 SHALL 保留 workflow 语义，并 SHALL NOT 以改变外部可观察结果的方式创建、删除或重排有副作用的节点执行。

#### Scenario: 非法 DAG 在执行前被拒绝
- **WHEN** workflow 不含 start 节点、含多个 start 节点、存在不可达的必需节点、缺少目标节点、存在被禁止的环，或存在无法安全求值的分支条件
- **THEN** DAG 校验 MUST 在执行任何节点之前拒绝该 workflow
- **AND** 该拒绝 MUST 以安全的 workflow 校验错误形式呈现

#### Scenario: 优化器保留副作用顺序
- **WHEN** DAG 优化构建执行计划
- **THEN** 它 MUST 为有副作用的节点保留声明的依赖顺序，例如模型调用、capability 调用、gateway 调用、用户交互、sandbox 执行和子 workflow 调用
- **AND** 它 MUST 仅在不存在要求顺序执行的依赖边或共享可变 workflow 变量时才把节点标记为可并行

#### Scenario: 优化可通过安全诊断观察
- **WHEN** workflow 优化产出执行计划
- **THEN** 系统 MUST 向 observability 提供安全的诊断摘要
- **AND** 该摘要 MUST NOT 包含 raw prompt、raw model output、raw capability 结果、secret、credential、本地路径或 attachment 内容

### Requirement: YAML 与 TS Workflow 共享同一 Canonical 执行路径

预定义 workflow SHALL 使用 YAML DSL 作为编写格式。YAML workflow SHALL 在执行前编译为 canonical TS workflow module。模型规划的 workflow SHALL 使用 TS workflow 源码形式。两种来源 SHALL 被规范化为同一 workflow contract，并由同一引擎执行。

#### Scenario: YAML workflow 编译为 canonical workflow
- **WHEN** startup composition 或首次使用加载读取预定义 YAML workflow
- **THEN** 系统 MUST 校验 YAML DSL
- **AND** 它 MUST 把 YAML 编译为 canonical TS workflow 表示
- **AND** 它 MUST 只通过 workflow engine 执行 canonical workflow 表示

#### Scenario: TS workflow 源码在执行前受治理
- **WHEN** 收到模型规划的 TS workflow 源码
- **THEN** 系统 MUST 通过 sandbox gateway boundary 编译并校验它
- **AND** 它 MUST NOT 在宿主进程中直接求值或导入该源码

#### Scenario: Canonical 执行不暴露源码格式差异
- **WHEN** YAML 编写的 workflow 和 TS 编写的 workflow 产生相同的 canonical workflow 图
- **THEN** workflow engine 行为在路由、DAG 校验、节点执行、cancellation、安全事件和 terminal 结果处理上 MUST 等价

### Requirement: Workflow 编排安全与作用域

Workflow 编排 SHALL 在路由、规划、编译、优化和执行全程保留 Agent Scope、Owner Scope、cancellation 和安全可观测性。

#### Scenario: 作用域不能被 workflow 源码覆盖
- **WHEN** YAML DSL、TS workflow 源码、模型规划的 workflow 内容或路由策略输出包含 `agentId`、owner identity 或等价的作用域字段
- **THEN** 系统 MUST NOT 使用这些字段覆盖可信的当前 Agent Scope 或 Owner Scope
- **AND** 冲突的源码字段 MUST 按其被检测到的边界产生安全诊断或校验失败

#### Scenario: 动态 workflow 代码使用 sandbox 边界
- **WHEN** workflow 编排编译或执行由模型产生或作为开发者策略代码提供的动态 TS 源码
- **THEN** 它 MUST 使用 sandbox gateway boundary
- **AND** 它 MUST NOT 以直接宿主进程权限执行动态代码

#### Scenario: Workflow 事件默认安全
- **WHEN** 路由、workflow 规划、编译、优化或执行发出 diagnostic、audit、metric、trace 或 stream 可见事实
- **THEN** 这些事实 MUST 只包含安全摘要和稳定标识符
- **AND** 它们 MUST NOT 包含 prompt、raw model output、raw provider error、raw capability 输入/输出、secret、credential、本地路径、attachment 内容或高基数 raw payload
