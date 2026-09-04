# routing-evidence-and-fallback Specification

## Purpose
为 Agent 内部路由结果定义稳定的证据、observability 和显式 model fallback 编排规则。
## Requirements
### Requirement: 路由安全结果产生证据
Agent 编排 SHALL 在路由选择路径、拒绝路径、请求澄清或移交时记录安全结果证据。证据 SHALL 描述已作出的安全结果，SHALL NOT 重新定义路由算法。

#### Scenario: 选择确定性路径
- **WHEN** Agent routing policy 选择一个确定性的处理路径
- **THEN** 系统 MUST 记录安全结果证据，包含稳定的 request/run/agent 引用、所选路径 kind、policy 结果和安全 reason 摘要
- **AND** 证据 MUST 可供 audit、structured log、trace 和 timeline-only diagnostic 使用
- **AND** 它 MUST NOT 暴露原始 prompt、原始模型输出、原始 tool 参数、原始 provider 错误、本地路径、secret 或 policy 内部细节

### Requirement: 约束安全结果可以记录为证据
当路由约束校验或定向 Skill 路由产生 accepted、rejected、ignored 或 degraded 安全结果时，路由证据 SHALL 记录这些结果，而不重新定义约束或首选 Skill 治理。

#### Scenario: 记录首选 Skill 结果
- **WHEN** 定向 Skill 路由接受或拒绝 `targetSkill=alarm-diagnosis`
- **THEN** 路由证据 MUST 记录产生的安全结果和 reason code
- **AND** 它 MUST NOT 重新定义该 Skill 是否被允许
- **AND** 它 MUST NOT 暴露原始约束 payload

#### Scenario: 约束被校验拒绝
- **WHEN** 路由约束校验拒绝或忽略一个约束
- **THEN** 路由证据 MUST 以安全 reason code 记录被拒绝或被忽略的约束证据
- **AND** 它 MUST NOT 暴露 policy 内部细节或原始约束值

### Requirement: 记录 model fallback 证据
Fallback 决策 SHALL 记录为路由证据，包括 fallback-applied、fallback-denied 和 fallback-exhausted 结果。

#### Scenario: 记录 fallback 结果
- **WHEN** Agent Core 产生 fallback-applied、fallback-denied 或 fallback-exhausted 结果
- **THEN** 系统 MUST 记录 fallback 证据，包含结果 kind 和安全 reason code
- **AND** 证据 MUST NOT 暴露原始 provider 错误、原始模型输出、provider 私有引用、credential、本地路径或 policy 内部细节

### Requirement: 路由证据由 Agent 编排拥有
业务路由证据 SHALL 在 Agent 编排边界内产生。Runtime 和 channel 层 SHALL NOT 创建与之竞争的业务路由证据或业务路由决策。

#### Scenario: runtime 接收 request
- **WHEN** runtime 接受一个 request 并调用 Agent 边界
- **THEN** runtime MAY 把 accepted request facts 和 typed constraints 传递给 Agent 编排
- **AND** runtime MUST NOT 代表 Agent routing policy 选择业务 Skill、Tool、Agent capability、确定性 flow 或 fallback 路径
- **AND** runtime MUST NOT 把路由证据重新解释为路由状态来源

#### Scenario: channel 接收首选处理约束
- **WHEN** channel 接收一个 typed 的用户或上游处理约束
- **THEN** channel MAY 通过 accepted request 边界转发该 typed constraint
- **AND** channel MUST NOT 把该约束当作直接调用 capability 的授权

### Requirement: 路由证据不是新的公开核心 DTO
本 change SHALL NOT 新增公开的路由证据 DTO、gateway Record、stream event 类型或 timeline event 词汇。证据和 fallback 决策 SHALL 使用已脱敏的 audit/log/trace 投影和既有的 runtime timeline-only `POLICY_APPLIED` 事件。

#### Scenario: 记录证据
- **WHEN** Agent 编排记录路由证据
- **THEN** 它 MUST 使用既有 runtime timeline 边界，以 `POLICY_APPLIED` 提供 timeline-only diagnostic
- **AND** 它 MUST NOT 新增用户可见的公开路由证据 DTO
- **AND** 它 MUST NOT 新增新的 `TimelineEventType`

### Requirement: 路由证据默认不对用户可见
详细路由证据 SHALL NOT 投影到用户可见的 stream 或 history surface。

#### Scenario: 用户打开会话历史
- **WHEN** 已路由的 request 完成后读取会话历史
- **THEN** history MAY 展示最终回答、pending input 结果、handoff 状态或 `SafeError`
- **AND** 它 MUST NOT 暴露路由候选细节、policy 内部细节、fallback 候选列表、原始 prompt 或原始失败细节

### Requirement: 证据 observability 安全降级
Audit、structured log、trace、脱敏或 metric 失败 SHALL NOT 改变路由决策，且 SHALL NOT 导致发出原始证据。

#### Scenario: audit sink 不可用
- **WHEN** routing policy 已选择路径且 audit 写入失败
- **THEN** 已选择的路由结果 MUST 保持不变
- **AND** 系统 MUST 通过可用的 log 或 metric 记录一次安全的 observability 降级
- **AND** 它 MUST NOT 通过写入原始 prompt、原始模型输出、原始 tool 数据、原始错误、本地路径或 secret 来重试

#### Scenario: 脱敏失败
- **WHEN** 路由证据无法为某个 observability sink 安全脱敏
- **THEN** 证据投影 MUST 降级为只含 reason 的安全摘要，或对该 sink 跳过
- **AND** 系统 MUST 记录一次安全的脱敏失败 diagnostic
- **AND** 它 MUST NOT 发出未脱敏的证据

### Requirement: timeline 用途保持 timeline-only
路由证据 SHALL 使用既有的 runtime timeline-only `POLICY_APPLIED` 事件承载 diagnostic facts，但这些事件 SHALL NOT 成为默认的用户可见 stream event。

#### Scenario: 记录路由结果
- **WHEN** Agent 编排记录路由、约束或 fallback 安全结果
- **THEN** Agent 编排 MUST 通过 runtime timeline 边界发出一个 `POLICY_APPLIED` timeline-only diagnostic 事件
- **AND** channel 默认 MUST NOT 把该详细事件投影为用户可见的 stream event
- **AND** audit/log/trace 投影 MUST 使用已脱敏的证据语义
