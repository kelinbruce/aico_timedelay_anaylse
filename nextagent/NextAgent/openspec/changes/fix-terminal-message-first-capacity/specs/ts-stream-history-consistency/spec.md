## Function

- **所属 Function**：`FN-1.2 断线后从上次位置继续`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 终态回答通过唯一Message关联恢复

terminal composite 成功后，live stream、conversation history、run-event history、resume 和 cold refresh MUST 从同一满足既有可见性策略的 terminal Assistant Message 提供 canonical final answer projection。terminal Event MUST 通过非空 `terminalMessageId` 强关联该 Message，MUST NOT 自身持有回答正文；live terminal presentation MUST 只在 composite commit 成功后使用该已提交 Message 的相同 `content`。

Capability 来源大结果的 canonical projection MUST 是 terminal Message 中已提交的 `PERSISTED_PREVIEW` 与 ref，而不是物化前完整原文。系统 MUST NOT 只在 live stream 暴露完整原文后让 history 回退为 preview，也 MUST NOT 为使 history 自动展开全文而绕过 Message 读取 execution workspace 文件。50,000 字符以内 inline 结果与 LLM terminal answer 继续按 Message 原文呈现。

历史关联 MUST 验证可信 Owner Scope、Agent Scope、session、request、run、Message role、visibility 和 terminal metadata。关联目标缺失、隐藏、损坏、坐标不匹配或不可访问时，run history MUST 保留安全终态类型和顺序、返回空 `content` 与 `contentUnavailable=true`，MUST NOT 从 legacy Event body、客户端缓存、workspace 文件或其他 Message 猜测回答。

**需求类别**：功能性需求

#### Scenario: Capability大结果live与cold history一致

- **GIVEN** terminal Assistant Message 保存 Capability 大结果的 preview/ref projection
- **WHEN**用户先接收 live terminal，随后清空浏览器缓存并刷新 conversation 与 run history
- **THEN**两条路径 MUST 显示该 Message 的相同 preview/ref projection
- **AND** live MUST NOT 显示物化前完整原文
- **AND**系统 MUST 只显示一个 canonical final answer

#### Scenario: 边界内回答保持inline一致

- **GIVEN** terminal Message 保存 50,000 字符以内的 inline answer
- **WHEN**用户比较 live 与 cold history
- **THEN**两条路径 MUST 显示同一 inline content

#### Scenario: Workflow structured presentation与terminal answer保持独立

- **GIVEN** Workflow 同时产生 Event-owned completed product 与 Message-owned terminal answer
- **WHEN** settled live 或 cold history 恢复该运行
- **THEN** terminal answer durable body MUST 只从 terminal Message 取得
- **AND** Workflow structured product MUST 继续遵循独立 Event-owned presentation 契约
- **AND** Workflow `toolEventType=ANSWER` product MUST 投影到答案区，其他过程类型 MUST 保持在执行过程区域
- **AND**两者 MUST NOT 因正文相同而合并 durable owner

#### Scenario: Terminal Message关联失败不回退

- **GIVEN** terminal Event 的 `terminalMessageId` 缺失、损坏、越权或坐标不匹配
- **WHEN** authorized caller 读取 run history
- **THEN** history MUST 保留安全 terminal status 并返回空 `content`
- **AND** MUST 设置 `contentUnavailable=true`
- **AND** MUST NOT 返回 Event body、workspace 文件、其他 Message 或客户端缓存正文

#### Scenario: Composite commit失败不产生live终态

- **GIVEN** terminal composite write 失败
- **WHEN** live subscriber 等待终态
- **THEN**系统 MUST NOT 发布表示该次提交已成功的 terminal presentation
- **AND** cold history MUST NOT 观察到该次提交的部分 answer

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：live 与恢复路径都以 terminal Assistant Message 的 committed inline 或 preview/ref projection 作为 final answer 唯一正文。
- **依据 Requirements**：`终态回答通过唯一Message关联恢复`

### 处理过程

- **变更类型**：修改
- **目标内容**：live 只在 composite commit 成功后呈现 Message content；history 按可信关联恢复同一 content，关联失败显式省略。
- **依据 Requirements**：`终态回答通过唯一Message关联恢复`

### 规格

- **规格项**：Terminal answer恢复owner
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：terminal Assistant Message 的 committed projection；Event、workspace 文件和客户端缓存不得作为正文回退
- **依据 Requirements**：`终态回答通过唯一Message关联恢复`
