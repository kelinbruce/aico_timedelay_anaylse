## Function

- **所属 Function**：`FN-1.20 查看推荐问题`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Frontend Recommendation Trigger

前端 MUST 在收到 `REQUEST_COMPLETED` stream event、会话中最新的 turn 通过实时 stream 接收、且 runtime bootstrap 的 `portalAbilityConfig.suggestedQuestionsEnabled` 不为 `false` 时自动调用推荐接口。前端 MUST NOT 在 `REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` 事件后调用推荐接口。若推荐接口请求失败或返回空列表，前端 MUST 静默不展示推荐区域，MUST NOT 向用户报错。

前端 MUST 仅对会话中最新的 turn（`isLatest`）且该 turn 是通过实时 stream 接收的（`isLiveStreamed`，即 turn 的事件不包含 `history-load` transport hint）触发推荐接口调用。从会话历史加载的 turn MUST NOT 触发推荐接口调用。当 bootstrap 未返回 `portalAbilityConfig` 或该字段非法时，前端 MUST 使用默认值 `true` 判断是否展示下一步问题推荐组件。

**需求类别**：功能性需求

#### Scenario: 流式回答完成后触发推荐
- **WHEN** 前端收到 `REQUEST_COMPLETED` stream event 且该 turn 是会话中最新的 turn 且通过实时 stream 接收
- **AND** `portalAbilityConfig.suggestedQuestionsEnabled` 不为 `false`
- **THEN** 前端 MUST 自动调用 `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions`

#### Scenario: 推荐问题开关关闭时不调用接口
- **WHEN** 前端收到满足既有触发条件的 `REQUEST_COMPLETED` stream event
- **AND** `portalAbilityConfig.suggestedQuestionsEnabled === false`
- **THEN** 前端 MUST NOT 挂载推荐问题组件
- **AND** MUST NOT 调用推荐接口

#### Scenario: bootstrap 缺失 portalAbilityConfig 时使用默认开启
- **WHEN** runtime bootstrap response 未包含 `portalAbilityConfig`
- **AND** 前端收到满足既有触发条件的 `REQUEST_COMPLETED` stream event
- **THEN** 前端 MUST 按 `suggestedQuestionsEnabled=true` 处理
- **AND** MUST 保持既有推荐问题触发行为

#### Scenario: 失败的请求不触发推荐
- **WHEN** 前端收到 `REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` stream event
- **THEN** 前端 MUST NOT 调用推荐接口

#### Scenario: 历史加载的 turn 不触发推荐
- **WHEN** 前端从会话历史加载一个已完成的 turn（turn 事件包含 `history-load` transport hint）
- **THEN** 前端 MUST NOT 调用推荐接口

#### Scenario: 推荐接口失败时静默
- **WHEN** 推荐接口返回错误或返回 `{ questions: [] }`
- **THEN** 前端 MUST NOT 展示推荐区域且 MUST NOT 向用户显示错误

## ADDED Requirements

### Requirement: Suggested questions backend feature gate

当 effective `suggested-questions-enabled=false` 时，该功能开关 MUST 优先于推荐问题生成和 `No Caching` 的生成义务。系统 MUST 跳过 completed request terminal 后的推荐问题预计算，MUST NOT 发起推荐问题 model invocation。推荐问题 REST endpoint MUST 返回 HTTP 200 和 `{ questions: [] }`，且 MUST NOT 调用 `SuggestedQuestionPort.generate()` 或发起 model invocation。当开关为 `true` 时，既有推荐问题状态校验、生成、解析和失败降级行为 MUST 保持不变。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：`FN-1.20 查看推荐问题`

#### Scenario: 关闭开关时 terminal 后不预计算
- **WHEN** request run 成功 terminal commit
- **AND** effective `suggested-questions-enabled=false`
- **THEN** 系统 MUST NOT 执行推荐问题预计算
- **AND** MUST NOT 发起推荐问题 model invocation

#### Scenario: 关闭开关时 REST 返回空列表
- **WHEN** client 调用 suggested-questions REST endpoint
- **AND** effective `suggested-questions-enabled=false`
- **THEN** endpoint MUST 返回 HTTP 200 和 `{ questions: [] }`
- **AND** MUST NOT 调用 `SuggestedQuestionPort.generate()`
- **AND** MUST NOT 发起 model invocation

#### Scenario: 开启开关时保持既有行为
- **WHEN** effective `suggested-questions-enabled=true`
- **THEN** 系统 MUST 保持既有 terminal 状态校验、推荐生成和空结果降级行为

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：推荐问题在前端触发、terminal 后预计算和 REST 生成前均检查 effective 推荐问题开关；关闭时不挂载组件、不调用接口、不预计算、不调用模型。
- **依据 Requirements**：`Frontend Recommendation Trigger`、`Suggested questions backend feature gate`

### 规格

- **规格项**：推荐问题功能开关
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：默认开启；`suggested-questions-enabled=false` 时前端不调用、后端不预计算且 REST 返回空列表。
- **依据 Requirements**：`Frontend Recommendation Trigger`、`Suggested questions backend feature gate`
