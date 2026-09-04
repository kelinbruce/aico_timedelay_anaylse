## Function

- **所属 Function**：`FN-1.20 查看推荐问题`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Model Invocation for Recommendations

推荐生成 MUST 通过 `ModelSelectionService.select(request, signal)` 为当前 accepted Agent 和已完成 request/run 的可信 Owner/Agent scope 选择一个 `AVAILABLE` model configuration，再通过 `ModelInvocationService.complete()` 调用该 canonical `modelId`。Model invocation request MUST 满足：

- `SuggestedQuestionRequest` MUST 保持既有 closed fields `tenantId`、`subjectId`、`agentId`、`sessionId`、`requestId` 和 `runId`，MUST NOT 增加由 Web/client 或上游 lifecycle 提供的 operation identity。
- suggested-question service MUST 在每次实际启动推荐模型调用前通过 service-owned cryptographically secure UUID generator 建立 fresh `operationId`；App composition MUST NOT 注入或感知该 generator。该 identity MUST NOT 接受 Web/client、模型输出、Capability 参数或其他不可信 metadata 提供或覆盖。缓存命中且未启动模型调用时 MUST NOT 生成 operation identity。
- `tools` 数组 MUST 为空。
- `modelId` MUST 来自同一次 `ModelSelectionResult.status="SELECTED"` 的 configuration。
- `messages` MUST 包含组装后的 prompt（system message + user message）。
- `invocationScope` MUST 使用模型调用契约定义的 closed scope；tenant/subject、agent/version/assembly MUST 来自已完成 accepted run，scope `operationId` MUST 等于系统为本次实际推荐模型调用建立的 identity。completed run 的 session/request/run coordinates MUST 作为 all-or-none 的真实 causal correlation 进入 scope；这些坐标不成为 lifecycle authority，MUST NOT 使推荐进入 run-bound timeline。
- 推荐 Port MUST 以 closed `ModelInvocationRequest` 交付 canonical `modelId`、scope、messages 和空 tools。locale 只供 recommendation model selection 和 prompt assembly 使用；provider access、header 和 transport 由模型边界拥有。adapter 发起 outbound model HTTP request 时，framework-owned correlation header 集合 MUST 恰好为既有 Agent/Session/Request/Run 四个 headers。background invocation MUST NOT 产生 request-run 模型调用时间线事实。
- 推荐调用 MUST 与其他 concrete provider invocation 使用同一个 `ModelInvocationService`，并执行当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook。合法 model mutation MUST 生效；background `BEFORE_MODEL_INVOKE` hook 返回 `DENY`、`BLOCK` 或 `PEND` 时 MUST 沿用推荐失败/空结果语义且不得启动 provider。推荐 hook MUST NOT 创建 pending input、synthetic run coordinates 或 request-run hook/model timeline。

terminal 后预计算与 Web cache miss/on-demand 生成 MUST 遵守上述相同 selection、identity 和 invocation contract。`RequestLifecycleDependencies.postTerminalCallback` MUST 保持既有 `(command, run, status)` contract；attachment cleanup、非 completed terminal status 和其他 callback consumer MUST NOT 因推荐模型 identity 发生签名或调用语义变化。

推荐 Port MUST NOT 自行读取主/default/first model profile、全局目录或 provider binding，也 MUST NOT 使用 `ModelInvocationService.stream()`。对一次 logical invocation，它 MUST 只调用一次 `ModelInvocationService.complete()`，MUST NOT 包裹同模型 retry 或重置 timeout。Selection、prompt assembly 和 invocation MUST 共享 required cancellation signal；selection failure、cancellation、identity 建立失败或模型调用安全失败 MUST 沿用既有推荐失败/空结果语义，MUST NOT 选择其他 Agent、全局默认或未激活模型。

**需求类别**：功能性需求

#### Scenario: 调用已选择模型生成推荐
- **WHEN** Port 执行推荐生成
- **THEN** MUST 先通过 `ModelSelectionService` 获得当前 accepted Agent 的 selected configuration
- **AND** MUST 以该 configuration 的 canonical `modelId` 调用 `ModelInvocationService.complete()`
- **AND** `tools` MUST 为空数组

#### Scenario: Terminal commit 后生成推荐
- **WHEN** completed run 的 terminal commit 后发起推荐生成
- **THEN** `postTerminalCallback` MUST 继续只接收 `command`、`run` 和 `status`
- **AND** 系统 MUST 在实际模型调用前建立 fresh trusted `operationId`
- **AND** model invocation scope MUST 使用该 identity
- **AND** scope MUST 包含 completed run 的完整 `sessionId`、`requestId` 和 `runId` causal correlation
- **AND** scope MUST 通过 `ModelInvocationScope` closed schema validation
- **AND** adapter 发起 outbound model HTTP request 时，framework-owned correlation header 集合 MUST 恰好为既有 Agent/Session/Request/Run 四个 headers

#### Scenario: Web 按需生成推荐
- **WHEN** Web 推荐请求未命中可用缓存并进入实际模型生成
- **THEN** Web request MUST NOT 提供 operation identity
- **AND** 系统 MUST 按与 terminal 预计算相同的规则建立 fresh trusted `operationId`
- **AND** scope MUST 保留对应 completed run 的真实 causal correlation

#### Scenario: 推荐 operation identity 无法建立
- **WHEN** suggested-question service 的 UUID generator 无法建立合法 `operationId`
- **THEN** provider execution MUST NOT 启动
- **AND** 推荐生成 MUST 沿用既有失败或空结果语义

#### Scenario: Post-terminal callback 的其他责任不受影响
- **WHEN** terminal status 不是 `COMPLETED` 或 callback 执行 attachment cleanup 等既有责任
- **THEN** callback MUST 继续遵守既有三参数 contract 和状态语义
- **AND** 系统 MUST NOT 为没有实际推荐模型调用的路径生成 recommendation operation identity

#### Scenario: 推荐消费者不自行选择主模型
- **WHEN** Agent assembly 有多个 activated models
- **THEN** 推荐 Port MUST NOT 自行读取 default/first profile 或按 display name 选择
- **AND** final model MUST 由 `ModelSelectionService` 唯一决定

#### Scenario: 不使用流式模型调用
- **WHEN** Port 执行推荐生成
- **THEN** MUST NOT 调用 `ModelInvocationService.stream()`

#### Scenario: 推荐模型选择被取消或失败
- **WHEN** selection 被取消或返回 `FAILED`
- **THEN** 推荐 Port MUST NOT 启动 provider execution
- **AND** MUST NOT 回退到全局默认、其他 Agent 或未激活模型

#### Scenario: 推荐调用执行 model hook

- **WHEN** 推荐 Port 通过统一 `ModelInvocationService.complete()` 启动实际 background 模型调用
- **THEN** 当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook MUST 执行
- **AND** background hook MUST NOT 创建 request-run hook/model timeline
- **AND** background `PEND` MUST 在 provider execution 前安全失败并沿用推荐空结果语义

## Function 变更汇总

### 输入

- **变更类型**：保持
- **目标内容**：`SuggestedQuestionRequest` 与 `postTerminalCallback(command, run, status)` 保持既有 closed contract，不新增 operation identity 输入；completed run coordinates 继续作为可信 causal correlation。
- **依据 Requirements**：`Model Invocation for Recommendations`

### 处理过程

- **变更类型**：修改
- **目标内容**：terminal 预计算与 Web 按需生成遵守同一 selection、identity 和 invocation contract；每次实际模型调用使用 suggested-question service 建立的 fresh trusted `operationId`，再以 selected `modelId` 执行非流式、无工具模型调用。
- **依据 Requirements**：`Model Invocation for Recommendations`

### 结果

- **变更类型**：修改
- **目标内容**：推荐内容与清洗/解析行为不变；推荐 Port 通过统一 selection service 选择模型，provider descriptors/access 保持由模型边界拥有。
- **依据 Requirements**：`Model Invocation for Recommendations`
