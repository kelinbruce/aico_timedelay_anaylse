## Function

- **所属 Function**：`FN-8.1 持久化运行数据`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 终态复合提交使用唯一Message正文

系统 MUST 在既有原子 terminal composite write 中持久化 RequestRun terminal state、terminal Assistant Message 和 terminal timeline Event。terminal Assistant Message MUST 是最终回答唯一 durable body owner；terminal Event MUST 保留非空 `terminalMessageId`、终态类型、适用安全失败字段和有界终态附注，MUST NOT 保存最终回答正文副本。

对于 Capability 来源 terminal answer，terminal Assistant Message MUST 保存 `large-content-references` 已确定的 inline 或 `PERSISTED_PREVIEW` projection 及 replacement evidence。对于 LLM 来源 terminal answer，Message MUST 保存 `model-invocation-contract` 已在 Agent Core 形成且不超过 50,000 字符的原样或带固定标记正文。系统 MUST NOT 在 terminal commit 内建立独立截断、文件或 BlobStore 规则；任何绕过 producer 保护而仍超过 50,000 字符的 terminal 正文 MUST 在提交超限 Message 前发布不含原始正文的 `DEGRADATION_NOTICE(code=TERMINAL_MESSAGE_LIMIT_EXCEEDED)`，并以 safe `REQUEST_FAILED` 和有界失败 Message 结束，MUST NOT 把该失败伪装为 `REQUEST_COMPLETED`。

系统 MUST 只在 composite write 返回成功后发布对应 live terminal presentation，并 MUST 使用已提交 Message 的相同 projection。任一组成写入失败时，系统 MUST NOT 发布表示提交成功的 live terminal Event；幂等重放 MUST 复用首次已提交事实，MUST NOT 通过独立 Message 或 Event write 补齐或重复终态。

**需求类别**：功能性需求

#### Scenario: Terminal composite提交唯一回答projection

- **WHEN** Runtime 成功提交 terminal result
- **THEN** terminal Assistant Message MUST 持有唯一回答正文 projection
- **AND** terminal Event MUST 通过 `terminalMessageId` 关联该 Message
- **AND** terminal Event MUST NOT 保存回答正文副本

#### Scenario: Capability大结果提交preview与ref

- **GIVEN** Capability 来源 terminal answer 已被物化为 `PERSISTED_PREVIEW`
- **WHEN** Runtime 提交 terminal composite
- **THEN** terminal Message MUST 保存 preview 与 replacement evidence
- **AND** terminal Message `content` MUST 不超过 50,000 个字符
- **AND** terminal Event MUST NOT 复制 preview 或完整原文

#### Scenario: Terminal commit失败不发布伪终态

- **GIVEN** terminal composite write 的任一组成写入失败
- **WHEN** Runtime 处理该失败
- **THEN**系统 MUST 保持原子失败结果
- **AND** MUST NOT 发布仅存在于内存的 terminal Event

#### Scenario: Terminal commit幂等重放不产生第二终态

- **GIVEN**同一 terminal idempotency key 已成功提交
- **WHEN**系统再次提交相同 terminal result
- **THEN**系统 MUST 复用首次已提交事实
- **AND** MUST NOT 写入或发布第二个 terminal Message 或 Event

#### Scenario: 正常模型超限输出提交有界成功正文

- **GIVEN** Agent Core 已按 `model-invocation-contract` 把超过 50,000 字符的模型输出转换为不超过 50,000 字符的带标记正文
- **WHEN** Runtime 提交 terminal composite
- **THEN** terminal Assistant Message MUST 保存该有界正文
- **AND**请求 MUST 保持 `REQUEST_COMPLETED`
- **AND**系统 MUST NOT 对该正文调用 Capability externalizer

#### Scenario: 绕过模型producer保护的超限正文安全失败

- **GIVEN**测试 adapter 或其他非正常生产路径直接向 Runtime terminal boundary 提交 50,001 字符正文
- **WHEN** Runtime 准备 terminal composite
- **THEN**系统 MUST 在提交超限 Message 前发布 `DEGRADATION_NOTICE(code=TERMINAL_MESSAGE_LIMIT_EXCEEDED)`
- **AND**请求 MUST 以 safe `REQUEST_FAILED` 和有界失败 Message 结束
- **AND** MUST NOT 写入超限 terminal Message 或伪造 `REQUEST_COMPLETED`

### Requirement: 终态timeline Event在复合提交前保持有界

系统 MUST 在提交 terminal composite write 前，确保 terminal timeline Event 的完整 `inlinePayload` 经 `JSON.stringify` 后不超过 49,000 UTF-8 bytes。该边界 MUST 同时适用于 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED`，并对 Model Loop、Direct Workflow、Workflow-as-Tool 最终请求与 local/remote Working Memory provider 使用同一规则。

系统 MUST 保留 `terminalMessageId` 和适用安全失败字段。可选终态附注的完整表示会使 Event 超限且 owning contract 定义显式不可用表示时，系统 MUST 使用该不可用表示，MUST NOT 返回部分附注、修改 terminal Message 或改变 request terminal status。仅保留必需 shell 与全部适用不可用表示后仍超限时，terminal commit MUST 在 provider 调用前显式失败。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: Capability大结果不扩大Event

- **GIVEN** Capability 原始 terminal answer 超过 50,000 个字符
- **WHEN**系统组装 terminal composite write
- **THEN** terminal Message MUST 使用已物化的有界 preview/ref projection
- **AND** terminal Event `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND** Event MUST NOT 包含 preview 或原文副本

#### Scenario: 四类终态使用同一Event边界

- **WHEN**任一 terminal Event 进入 Working Memory provider
- **THEN**其完整 `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND**适用 `terminalMessageId` 与安全失败字段 MUST 保持不变

#### Scenario: 可选附注超出Event预算

- **GIVEN**可选终态附注完整表示会使 Event 超过 49,000 UTF-8 bytes
- **AND** owning contract 定义显式不可用表示
- **WHEN**系统提交终态
- **THEN** Event MUST 使用该不可用表示
- **AND** MUST NOT 返回部分附注或改变 Message projection

#### Scenario: 必需Event shell自身超限

- **GIVEN**移除可选附注后必需 terminal Event shell 仍超过 49,000 UTF-8 bytes
- **WHEN**系统尝试提交终态
- **THEN**系统 MUST 在调用 provider 前显式失败
- **AND** MUST NOT 发送超限 Event 或伪造成功终态

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统原子持久化 RequestRun 终态、唯一 terminal Message projection 和 body-free 有界 terminal Event。
- **依据 Requirements**：`终态复合提交使用唯一Message正文`、`终态timeline Event在复合提交前保持有界`

### 结果

- **变更类型**：修改
- **目标内容**：Capability 大结果以 workspace 全文加 Message preview/ref 成功提交；真实 composite failure 不产生部分事实或伪终态。
- **依据 Requirements**：`终态复合提交使用唯一Message正文`、`终态timeline Event在复合提交前保持有界`

### 规格

- **规格项**：Terminal Event inline payload 上限
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：四类 terminal Event 完整 `inlinePayload` 经 JSON 序列化后不超过 49,000 UTF-8 bytes
- **依据 Requirements**：`终态timeline Event在复合提交前保持有界`

- **规格项**：最终回答 durable body owner
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：terminal Assistant Message 唯一持有已物化回答 projection；Event 不保存正文副本
- **依据 Requirements**：`终态复合提交使用唯一Message正文`
