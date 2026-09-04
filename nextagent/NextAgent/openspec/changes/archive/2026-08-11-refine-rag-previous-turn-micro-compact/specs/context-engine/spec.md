## Function

- **所属 Function**：`FN-4.5 压缩转储工具结果`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: History candidate selection remains separate from final context selection

Context Engine SHALL preserve the existing ownership split where history selection emits the full valid candidate set and downstream policy decides the final model-visible selection. Before budget evaluation, Context Engine SHALL deterministically replace every `Rag` capability result that belongs to any canonical completed turn before the current request with a bounded placeholder. Context Engine MAY apply the existing threshold-based micro-compact step to other eligible prior-turn capability results that are already inside the selected history candidate set. Both forms MUST operate only on model-visible representation, MUST NOT mutate user messages, assistant messages, current-request required context, canonical persisted messages, or conversation boundaries, and MUST NOT call a model.

**需求类别**：功能性需求

#### Scenario: 新问题压缩全部历史已完成轮次的 RAG 结果

- **WHEN** Context Engine 为一个新问题组装上下文，且当前问题之前一个或多个 canonical 已完成轮次包含 `Rag` capability results
- **THEN** Context Engine MUST 在预算评估前将这些历史轮次的全部 `Rag` capability result payloads 替换为有界确定性占位
- **AND** 替换数量 MUST NOT 受通用工具结果触发阈值或最近保留窗口影响
- **AND** 上一轮的 user 消息、assistant 消息及工具调用与结果顺序保持不变

#### Scenario: 当前问题的 RAG 结果始终保持完整

- **WHEN** 当前问题在一次或多次模型与工具迭代中产生任意数量的 `Rag` capability results
- **THEN** Context Engine MUST NOT 通过上一轮 RAG 微压缩规则替换这些当前问题结果
- **AND** 同一问题内后续上下文组装仍将这些结果作为当前请求必需上下文处理

#### Scenario: 没有上一已完成轮次时不产生 RAG 替换

- **WHEN** 当前问题之前不存在 canonical 已完成轮次，或紧邻的上一 canonical 已完成轮次不包含 `Rag` capability result
- **THEN** Context Engine MUST NOT 通过上一轮 RAG 微压缩规则替换任何消息
- **AND** 其他历史工具结果仍按既有下游策略处理

### Requirement: Micro-compaction only replaces safe whitelisted older tool results

Micro-compaction SHALL use two non-overlapping eligibility rules. For `Rag`, it SHALL consider every capability result in all canonical completed turns before the current request eligible and SHALL replace all such results without applying the generic trigger threshold or retained window. For other tools, it SHALL consider only prior-turn capability-result history for the existing explicit trusted whitelist of replayable or low-risk tools; when the count of those generic candidates exceeds the trigger threshold, it SHALL preserve the most recent retained window and replace only the older eligible results. Both rules SHALL NOT compact current-request results, user messages, assistant text replies, Agent orchestration tools, task tools, custom MCP tools, or tools outside their respective eligibility rules.

**需求类别**：功能性需求

#### Scenario: RAG 专用规则与通用数量规则互不影响

- **WHEN** 上一 canonical 已完成轮次同时包含 `Rag` results 和通用白名单工具 results
- **THEN** Context Engine MUST 替换上一轮的全部 `Rag` results
- **AND** 通用白名单工具 results MUST 继续按既有触发阈值和最近保留窗口进行判定
- **AND** `Rag` results MUST NOT 参与通用候选数量或最近保留窗口的计算

#### Scenario: 单条上一轮 RAG 结果也被替换

- **WHEN** 紧邻的上一 canonical 已完成轮次仅包含一条 `Rag` capability result，且通用触发阈值未达到
- **THEN** Context Engine MUST 替换该 `Rag` result
- **AND** 不得因通用触发阈值未达到而保留其原始 model-visible payload

#### Scenario: 非候选工具和当前请求内容保持不变

- **WHEN** 消息属于当前请求、不是 capability result，或来自两种 eligibility rules 均未允许的工具
- **THEN** Context Engine MUST NOT micro-compact 该消息
- **AND** 后续省略或降级仍由既有预算或压缩策略负责

### Requirement: Micro-compaction state is owner-scoped, idempotent, and cleared after summary compression

Context Engine SHALL persist micro-compaction state as owner-scoped active-context metadata so the same historical message is not repeatedly committed as newly compacted across repeated assembly of one request or later requests. If the state is missing or malformed, Context Engine SHALL safely degrade to an empty state and deterministically re-evaluate eligible model-visible history. When render reloads canonical message records, it SHALL re-apply every replacement identified by valid micro-compaction state. After summary compression commits a replacement active context, the micro-compaction state for the replaced history SHALL be cleared.

**需求类别**：功能性需求

#### Scenario: 同一问题反复组装保持幂等

- **WHEN** 一个问题因多次模型与工具迭代反复组装上下文，且上一轮 RAG message ids 已记录为 compacted
- **THEN** Context Engine MUST 继续输出相同的 model-visible placeholders
- **AND** MUST NOT 将这些 message ids 重复计为新压缩结果
- **AND** MUST NOT 压缩当前问题新产生的 `Rag` results

#### Scenario: 缺失或非法状态安全降级

- **WHEN** active-context metadata 不包含有效 micro-compaction state
- **THEN** Context Engine MUST 将状态视为空并重新评估当前可见历史
- **AND** MUST NOT 仅因状态缺失或非法而使请求失败

#### Scenario: 状态写入竞争不恢复本次上一轮 RAG

- **WHEN** Context Engine 在 assembly 中识别出上一已完成轮次 RAG，但 active-context metadata 写入发生版本冲突、记录不存在或 gateway 异常
- **THEN** 本次 assembly 后续 render MUST 仍将 selected history 中可确定识别的该上一轮 RAG 投影为相同占位符
- **AND** 当前问题的 RAG results MUST 保持完整
- **AND** metadata 写入失败 MUST NOT 使请求失败或触发无界重试

#### Scenario: 最终 TOOL message 不携带上一轮 RAG 原文

- **WHEN** 上一已完成轮次的 `Rag` capability result 被投影为最终 LLM `TOOL` message
- **THEN** 对应 `tool-result.output` MUST 是有界确定性占位且 MUST NOT 包含原始 `results`
- **AND** `toolCallId`、`toolName`、消息顺序和当前问题的 `tool-result.output` MUST 保持不变

#### Scenario: 第三轮重新计算全部历史 RAG 替换

- **WHEN** 第三轮问题组装时 micro-compaction state 缺失，且第一轮与第二轮均包含 `Rag` capability results
- **THEN** Context Engine MUST 从全部当前可见 canonical 已完成历史轮次重新计算 RAG 替换
- **AND** 第一轮与第二轮的 RAG 原始 `results` MUST 均不进入最终 LLM messages

#### Scenario: 摘要压缩清理失效状态

- **WHEN** summary compression 提交替换 prior history 的新 active-context view
- **THEN** 新 active-context metadata MUST NOT 携带已被替换历史的失效 micro-compaction state
- **AND** 下一次 assembly 从替换后的 active context 重新跟踪 micro-compaction

## Function 变更汇总

### 前置条件

- **变更类型**：修改
- **目标内容**：除超过内联阈值的工具结果外，紧邻当前问题的上一 canonical 已完成轮次中存在 RAG 结果时，也进入历史工具结果压缩边界。
- **依据 Requirements**：`History candidate selection remains separate from final context selection`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在每轮转换时替换上一已完成轮次的全部 RAG 模型可见结果，保护当前轮结果，并对其他工具继续使用既有数量阈值策略；重复组装保持相同投影。
- **依据 Requirements**：`History candidate selection remains separate from final context selection`、`Micro-compaction only replaces safe whitelisted older tool results`、`Micro-compaction state is owner-scoped, idempotent, and cleared after summary compression`

### 结果

- **变更类型**：修改
- **目标内容**：后续问题看到有界的历史 RAG 占位和完整的当前问题 RAG 结果；canonical 历史、消息顺序及工具调用配对保持不变。
- **依据 Requirements**：`History candidate selection remains separate from final context selection`、`Micro-compaction state is owner-scoped, idempotent, and cleared after summary compression`
