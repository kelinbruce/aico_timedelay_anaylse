## ADDED Requirements

### Requirement: 冲突检测发生在 request-scope catalog 可见性之前

Capability 冲突检测 MUST 发生在 source 特定的解析与校验之后、capability 候选进入 request-scope 可执行或 model 可见 catalog 视图之前。在本 change 中，冲突检测是一个 catalog 治理步骤，而不是 runtime dispatch 时点行为。

#### Scenario: 非法冲突结果阻止可见性与执行

- **WHEN** 一个 capability 候选到达 request-scope catalog 治理步骤
- **THEN** 系统 MUST 在该候选变为 model 可见或可执行之前运行冲突检测
- **AND** 被冲突解决拒绝的候选 MUST NOT 进入该 request scope 的可执行 catalog 视图

### Requirement: 冲突解决只作用于已组装的 Capability 候选

冲突检测与解决 MUST 只作用于已经组装完成的 `CapabilityDescriptor` 候选。本 change MUST NOT 把解析 Skill source 布局、manifest 文件、本地目录结构、包安装结构或隐藏 Skill 内容作为冲突检测的一部分。

#### Scenario: 冲突检测不解析原始 source 内容

- **WHEN** 冲突检测将一个新的 capability 候选与既有 catalog 候选比较
- **THEN** 它 MUST 只消费已组装的 capability descriptor 和安全的 source 事实
- **AND** 它 MUST NOT 在冲突评估期间解析原始 manifest、原始本地路径或隐藏 Skill 内容

### Requirement: 同 scope 同标识冲突是显式的

同一 scope 中具有相同 `capabilityId` 的候选 MUST NOT 相互静默覆写。

同一 scope 中具有相同 `capabilityId` 的候选仅当系统能够证明它们来自同一稳定 source 事实标识时才 MAY 被视为重复。仅匹配 `providerId`、`capabilityId` 和 `kind` 本身不构成充分证明。如果缺少稳定的 source 事实证明，系统 MUST 将其视为冲突。

#### Scenario: 无稳定标识证明的同 scope 重复被拒绝

- **WHEN** 两个同 scope 候选共享相同的 `capabilityId`
- **AND** 系统无法证明它们源自同一稳定 source 事实标识
- **THEN** 新候选 MUST 被视为冲突
- **AND** 系统 MUST NOT 静默覆写既有候选

#### Scenario: 带稳定标识证明的同 scope 重复保留一个候选

- **WHEN** 两个同 scope 候选共享相同的 `capabilityId`
- **AND** 系统能够证明它们源自同一稳定 source 事实标识
- **THEN** 这些候选 MAY 被视为重复事实
- **AND** 系统 MUST 保留一个稳定的胜者，而不为同一事实标识创建两个可执行条目

### Requirement: 跨 scope 名称冲突使用受治理的优先级与遮蔽

跨 scope 中具有相同 `capabilityId` 的候选 MUST 通过受治理的 scope 顺序和优先级解决。胜出的候选 MAY 保持可执行；较低优先级的候选 MUST 根据受治理的解决结果被标记为 shadowed 或以其他方式变为不可执行。

受治理的优先级 MUST 派生自可信的 request-scope 事实和 provider 身份。Agent 显式绑定和 Agent 作用域的 source 候选 MUST 排在 builtin 和 system-local 默认之前；builtin 候选 MUST 排在 system-local 默认之前；remote 或外部配置的 provider 候选 MUST NOT 静默覆盖 Agent 作用域、builtin 或 system-local 候选。

#### Scenario: 较低优先级的跨 scope 候选被遮蔽

- **WHEN** 来自不同 scope 的两个候选共享相同的 `capabilityId`
- **AND** 受治理的优先级选定一个候选作为胜者
- **THEN** 较低优先级的候选 MUST 被标记为 shadowed 或以其他方式变为不可执行
- **AND** 系统 MUST 保留解释该结果的安全诊断

### Requirement: 冲突候选对 model 不可见且不可直接执行

解决后仍处于冲突状态的候选 MUST NOT 进入 model 可见的 capability 清单。针对冲突 capability 的直接调用尝试 MUST 以冲突兼容的安全失败结果失败。

#### Scenario: 冲突 capability 无法被直接调用

- **WHEN** 一个 capability 候选被冲突解决标记为冲突
- **THEN** 该 capability MUST NOT 被包含在 model 可见的可用 capability 清单中
- **AND** 针对该 capability 的直接调用尝试 MUST 以冲突兼容的 `SafeError` 失败
- **AND** 该 `SafeError` MUST 只使用安全细节，并且 MUST NOT 暴露原始 source 细节

### Requirement: 冲突诊断是结构化、安全且可追溯的

冲突解决 MUST 产出可安全记录日志、观测和审计的结构化诊断。诊断 MAY 包含安全标识字段，例如 `capabilityId`、`providerId`、`providerKind`、可选 version、受治理的优先级和 reason code。

诊断 MUST NOT 包含原始本地路径、原始 manifest、隐藏 Skill 内容、secret、credential、原始 provider 响应或其他 adapter 私有的敏感字段。

#### Scenario: 冲突诊断排除敏感 source 细节

- **WHEN** 系统发出冲突或遮蔽诊断
- **THEN** 诊断 MUST 只包含可追溯性所需的安全标识与推理字段
- **AND** 它 MUST NOT 包含原始本地路径、原始 manifest、隐藏 Skill 内容、credential 或原始 provider 响应

### Requirement: 冲突解决通过统一边界支持 Skill 候选

Skill 候选一旦被组装成 capability descriptor，就 MUST 遵循与其他 capability 种类相同的统一冲突检测与解决边界。本 change MUST NOT 创建第二个 Skill 专用冲突引擎。

#### Scenario: Skill 候选使用与 tool 相同的冲突边界

- **WHEN** 一个已组装的 Skill capability 候选进入 request-scope catalog 治理
- **THEN** 系统 MUST 通过用于其他 capability 候选的同一内部冲突检测与解决路径评估它
- **AND** 它 MUST NOT 因该候选源自 Skill source 而绕过统一冲突处理
