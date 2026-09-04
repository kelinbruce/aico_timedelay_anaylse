## Function

- **所属 Function**：`FN-4.3 装配上下文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 首轮用户 Query 主动记忆召回进入最终模型输入

当当前 Agent 已激活 `user-query-memory-recall` 的 `BEFORE_MODEL_INVOKE` 阶段时，系统 MUST 只在 `ModelInvokeBoundary.stepId` 为 `turn-1` 的首轮模型调用前执行主动召回。Hook MUST 在同一进程内以有界的 `requestRunId` 尝试集合原子判断该 RequestRun 是否已经尝试；已尝试的 fallback、续写或后续 tool round MUST 跳过读取。召回 MUST 以请求接受时已经确认的根用户消息正文作为唯一 `queryText`，执行一次不带记忆类型过滤、`limit=10`、`minConfidence=0.3` 的 L1 查询，并对全部 L1 候选读取 L2 详情。

只有 L1 与全部 L2 均成功时，系统才可将召回内容作为一条来源明确、USER 权限的请求私有背景消息加入本次最终模型输入。主动召回 MUST NOT 改写或持久化根用户消息、历史消息、`SessionMessage`、`ActiveContextView`、`ContextAssembly` 或模型工具调用记录，也 MUST NOT 替代模型后续自主调用 memory tools 的能力。

`flowVariables`、Hook config、Agent YAML、客户端 metadata、历史消息、模型输出和 capability 参数 MUST NOT 提供或覆盖 `queryText`。恢复、重放或跨实例执行重新开始首轮模型调用时，可以重新执行主动召回。

**需求类别**：功能性需求

#### Scenario: 首轮问题命中相关长期记忆
- **GIVEN** 当前 Agent 激活了 `user-query-memory-recall`，且 RequestRun 具有非空根用户消息
- **WHEN** 首个 `BEFORE_MODEL_INVOKE` 处理已完成装配和 render 的最终模型输入
- **THEN** 系统 MUST 使用根用户消息正文执行一次不带类型过滤、`limit=10`、`minConfidence=0.3` 的 L1 查询
- **AND** 系统 MUST 对全部 L1 候选各读取一次 L2 详情
- **AND** 全部读取成功且 L2 整体准入时，最终模型输入 MUST 只加入完整 L2 背景消息

#### Scenario: 检索词只来自可信根用户消息
- **GIVEN** 当前请求的 `flowVariables`、Hook config 或客户端 metadata 包含与根用户消息不同的文本
- **WHEN** 系统构造 L1 查询
- **THEN** 系统 MUST 仍使用已接受根用户消息正文作为唯一 `queryText`
- **AND** 其他字段 MUST NOT 改变该查询

#### Scenario: 非首次模型调用不重复主动召回
- **GIVEN** 当前 `ModelInvokeBoundary.stepId` 不为 `turn-1`，或该 RequestRun 已存在于当前进程的主动召回尝试集合
- **WHEN** 请求进入 fallback、续写或后续 tool round
- **THEN** 系统 MUST NOT 再执行 L1 或 L2
- **AND** 该次模型调用 MUST 使用不含本次临时召回消息的原有模型输入

#### Scenario: 未启用或根消息无效
- **GIVEN** 当前 Agent 未激活该 Hook，或可信根用户消息不存在、作用域不一致、角色不是 USER 或正文为空
- **WHEN** 系统准备最终模型输入
- **THEN** 系统 MUST 不调用 L1/L2
- **AND** 最终模型输入 MUST 保持原有内容

### Requirement: 主动记忆召回使用最终输入预算整体降级

系统 MUST 在既有上下文装配、历史压缩、large-content 处理和 render 完成后，使用本次最终模型消息、工具、模型上下文窗口和预留输出预算评估召回内容。系统 MUST 先整体评估完整 L2 背景消息；L2 超出可用输入预算时 MUST 整体评估同批完整 L1 摘要消息；L1 仍超限时 MUST 使用 `NO_CONTEXT`。L1/L2 MUST NOT 被截断、拆分、部分注入或触发第二次上下文装配、render 或历史压缩。

L1 未命中，或者 L1/任一 L2 发生失败、超时、取消、不可用、权限拒绝或不可披露时，系统 MUST 使用 `NO_CONTEXT`，不得使用部分结果。任一降级结果 MUST NOT 阻断模型调用、用户可见回复或 RequestRun 终态提交。

主动召回产生的诊断 MUST NOT 包含 Query、Owner Scope、记忆正文、记忆 ID 或模型消息；系统不得为区分召回结果新增包含受保护内容或高基数字段的观测事实。

**需求类别**：系统质量属性
**质量属性**：性能/容量、可靠性/恢复、审计/可追溯性
**适用范围**：该 Function

#### Scenario: L2 超限时整体降级为 L1
- **GIVEN** L1 与全部 L2 均成功，且既有上下文已经完成压缩和 render
- **WHEN** 完整 L2 消息超出模型窗口减预留输出预算后的剩余输入预算
- **THEN** 系统 MUST 整体评估同批完整 L1 摘要消息
- **AND** L1 可纳入时 MUST 只加入完整 L1 消息

#### Scenario: L1 仍超限
- **GIVEN** 完整 L2 消息不能纳入
- **WHEN** 同批完整 L1 摘要消息仍不能纳入
- **THEN** 最终模型输入 MUST 不含任何本次主动召回内容

#### Scenario: 任一读取失败时零注入且不重试
- **GIVEN** 当前 RequestRun 的主动召回已经开始
- **WHEN** L1 或任一 L2 失败、超时、取消、不可用、权限拒绝或不可披露
- **THEN** 系统 MUST 保留原最终模型输入
- **AND** 同一 RequestRun MUST NOT 重试 L1 或 L2
- **AND** 模型调用和终态提交 MUST 仍可完成

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：首个最终模型调用可使用已接受根用户消息触发的受控长期记忆召回，并以最终模型消息、工具、窗口和预留输出预算作为准入输入。
- **依据 Requirements**：`首轮用户 Query 主动记忆召回进入最终模型输入`、`主动记忆召回使用最终输入预算整体降级`

### 输出

- **变更类型**：修改
- **目标内容**：最终模型输入只可能增加完整 L2 背景、完整 L1 摘要背景或不增加内容；临时召回消息不进入持久化上下文。
- **依据 Requirements**：`首轮用户 Query 主动记忆召回进入最终模型输入`、`主动记忆召回使用最终输入预算整体降级`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在既有装配和压缩完成后整体评估 L2，再整体评估 L1；任何读取或预算失败均零注入且不重试。
- **依据 Requirements**：`主动记忆召回使用最终输入预算整体降级`

### 量化指标

- **指标名称**：单个 RequestRun 的主动记忆读取次数
- **变更类型**：新增
- **原值或原口径**：不适用（新增）
- **目标值或目标口径**：每个首轮模型调用至多 1 次 L1 查询和至多 10 次 L2 详情读取；L2 最大并发为 3，任一结果均不触发重试。
- **单位与测量边界**：按首轮模型调用计数；不统计模型自主 memory tool 调用。
- **依据 Requirements**：`首轮用户 Query 主动记忆召回进入最终模型输入`、`主动记忆召回使用最终输入预算整体降级`
