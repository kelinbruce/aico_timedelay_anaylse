## ADDED Requirements

### Requirement: 路由安全结果产生 evidence
每当路由选择路径、拒绝路径、请求澄清或移交时，Agent orchestration SHALL 记录安全的 outcome evidence。该 evidence SHALL 描述已做出的安全结果，且 SHALL NOT 重新定义路由算法。

#### Scenario: 选择了确定性路径
- **WHEN** Agent routing policy 选择一条确定性处理路径
- **THEN** 系统 MUST 记录带有稳定的 request/run/agent 引用、所选路径 kind、policy 结果和安全 reason 摘要的安全 outcome evidence
- **AND** 该 evidence MUST 可供 audit、结构化日志、trace 和 timeline-only 诊断使用
- **AND** 它 MUST NOT 暴露原始 prompt、原始 model 输出、原始 tool 参数、原始 provider 错误、本地路径、secret 或 policy 内部信息

### Requirement: 约束安全结果可以被记录为 evidence
当路由约束校验或定向 Skill 路由产生 accepted、rejected、ignored 或 degraded 安全结果时，routing evidence SHALL 记录这些结果，而不重新定义约束或首选 Skill 治理。

#### Scenario: 首选 Skill 结果被记录
- **WHEN** 定向 Skill 路由接受或拒绝 `targetSkill=alarm-diagnosis`
- **THEN** routing evidence MUST 记录最终的安全结果和 reason code
- **AND** 它 MUST NOT 重新定义该 Skill 是否被允许
- **AND** 它 MUST NOT 暴露原始 constraint payload

#### Scenario: 约束被校验拒绝
- **WHEN** 路由约束校验拒绝或忽略一个约束
- **THEN** routing evidence MUST 以安全的 reason code 记录 rejected 或 ignored 约束 evidence
- **AND** 它 MUST NOT 暴露 policy 内部信息或原始约束值

### Requirement: Agent Core 显式编排 model 回退
当所选 model profile 在 terminal commit 之前以安全失败语义失败时，Agent Core SHALL 决定是否应用、拒绝或耗尽 model 回退。该决策 SHALL 只消费冻结的 `modelProfileRegistry.fallbackEligibleProfileIds`、当前 `SafeError`、request/run/step 状态、可见输出状态、budget/deadline、cancellation 状态以及已尝试的 profile id。`agent-model` SHALL NOT 在内部执行该回退。

#### Scenario: 应用回退 profile
- **WHEN** 所选 model profile 在用户可见输出之前失败
- **AND** 冻结 registry 中仍存在一个尚未尝试的 fallback-eligible profile
- **AND** request deadline、budget 和 cancellation 状态允许再一次 model 调用
- **THEN** Agent Core MUST 通过 orchestration 按冻结 `fallbackEligibleProfileIds` 顺序选择第一个尚未尝试的 profile
- **AND** 它 MUST 以所选 profile 重新进入受治理的 model 调用路径
- **AND** 它 MUST 记录带有安全 reason code 的 fallback-applied evidence

#### Scenario: 可见输出阻止重放
- **WHEN** 所选 model profile 产生了用户可见输出然后失败
- **THEN** Agent Core MUST 拒绝同一步骤的回退重放
- **AND** 它 MUST 以安全的可见输出重放被阻止的 reason 记录 fallback-denied evidence
- **AND** 它 MUST NOT 为同一步骤静默调用另一个 model profile

#### Scenario: 回退候选被耗尽
- **WHEN** 所选 model profile 失败
- **AND** 不再存在尚未尝试的 fallback-eligible profile
- **THEN** Agent Core MUST 记录 fallback-exhausted evidence
- **AND** 在首个发布中它 MUST 通过显式的安全失败继续

### Requirement: Model 回退 evidence 被记录
回退决策 SHALL 被记录为 routing evidence，包括 fallback-applied、fallback-denied 和 fallback-exhausted 结果。

#### Scenario: 回退结果被记录
- **WHEN** Agent Core 产生 fallback-applied、fallback-denied 或 fallback-exhausted 结果
- **THEN** 系统 MUST 记录带有结果 kind 和安全 reason code 的回退 evidence
- **AND** 该 evidence MUST NOT 暴露原始 provider 错误、原始 model 输出、provider 私有引用、credential、本地路径或 policy 内部信息

### Requirement: Routing evidence 归 Agent orchestration 所有
业务 routing evidence SHALL 在 Agent orchestration 边界内部产生。Runtime 和 channel 层 SHALL NOT 创建与之竞争的业务 routing evidence 或业务路由决策。

#### Scenario: Runtime 接收一个请求
- **WHEN** runtime 接受一个请求并调用 Agent 边界
- **THEN** runtime MAY 将已接受的 request 事实和类型化约束传递给 Agent orchestration
- **AND** runtime MUST NOT 代表 Agent routing policy 选择业务 Skill、Tool、Agent capability、确定性流程或回退路径
- **AND** runtime MUST NOT 将 routing evidence 重新解释为路由状态源

#### Scenario: Channel 接收一个首选处理约束
- **WHEN** channel 接收一个类型化的用户或上游处理约束
- **THEN** channel MAY 通过已接受的请求边界转发该类型化约束
- **AND** channel MUST NOT 将该约束当作直接调用 capability 的授权

### Requirement: Routing evidence 不是新的公开核心 DTO
本 change SHALL NOT 新增公开的 routing evidence DTO、gateway Record、stream event 类型或 timeline event 词汇。Evidence 和回退决策 SHALL 使用脱敏的 audit/log/trace 投影和既有的 runtime timeline-only `POLICY_APPLIED` 事件。

#### Scenario: Evidence 被记录
- **WHEN** Agent orchestration 记录 routing evidence
- **THEN** 它 MUST 使用既有的 runtime timeline 边界和 `POLICY_APPLIED` 进行 timeline-only 诊断
- **AND** 它 MUST NOT 新增公开的用户可见 routing evidence DTO
- **AND** 它 MUST NOT 新增新的 `TimelineEventType`

### Requirement: Routing evidence 默认不对用户可见
详细 routing evidence SHALL NOT 被投影到用户可见的 stream 或 history 面。

#### Scenario: 用户打开会话历史
- **WHEN** 在一个经过路由的请求完成后读取会话历史
- **THEN** history MAY 展示最终答案、pending input 结果、移交状态或 `SafeError`
- **AND** 它 MUST NOT 暴露路由候选细节、policy 内部信息、回退候选列表、原始 prompt 或原始失败细节

### Requirement: Evidence 可观测性安全降级
Audit、结构化日志、trace、脱敏或 metric 失败 SHALL NOT 变更路由决策，并且 SHALL NOT 导致发出原始 evidence。

#### Scenario: Audit sink 不可用
- **WHEN** routing policy 已选择路径且 audit 写入失败
- **THEN** 已选择的路由结果 MUST 保持不变
- **AND** 系统 MUST 通过可用的日志或 metric 记录一个安全的可观测性降级
- **AND** 它 MUST NOT 通过写入原始 prompt、原始 model 输出、原始 tool 数据、原始错误、本地路径或 secret 来重试

#### Scenario: 脱敏失败
- **WHEN** routing evidence 无法为某个可观测性 sink 安全脱敏
- **THEN** 该 evidence 投影 MUST 降级为仅含 reason 的安全摘要，或对该 sink 跳过
- **AND** 系统 MUST 记录一个安全的脱敏失败诊断
- **AND** 它 MUST NOT 发出未脱敏的 evidence

### Requirement: Timeline 用法保持 timeline-only
Routing evidence SHALL 使用既有的 runtime timeline-only `POLICY_APPLIED` 事件承载诊断事实，但这些事件 SHALL NOT 成为默认的用户可见 stream 事件。

#### Scenario: 路由结果被记录
- **WHEN** Agent orchestration 记录一个路由、约束或回退安全结果
- **THEN** Agent orchestration MUST 通过 runtime timeline 边界发出一个 `POLICY_APPLIED` timeline-only 诊断事件
- **AND** channel MUST NOT 默认将该详细事件投影为用户可见的 stream 事件
- **AND** audit/log/trace 投影 MUST 使用脱敏的 evidence 语义
