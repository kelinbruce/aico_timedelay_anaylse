## Function

- **所属 Function**：`FN-1.22 展示会话消息正文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 外置终态结果以用户语言展示部分内容

当 terminal Assistant Message 正文是 `large-content-references` 定义的完整合法 canonical `PERSISTED_PREVIEW` 时，`agent-web` MUST 在答案区使用当前 locale 告知用户“结果内容较长，以下展示部分内容”，MUST 显示原始字符数与该 Message 中已持久化的有界 preview，并 MUST 告知用户完整结果已保存且可继续提问按需查看。

页面 MUST NOT 直接显示 `<persisted-content>` 协议标记、replacement reason、`ContentRef` type/id、workspace 内部路径或给模型的 Read 工具指令。该用户投影 MUST NOT 改写 terminal Message、replacement evidence、timeline、Task 或 Cron read model，MUST NOT 自动读取 workspace 全文，且 MUST 对 live terminal 与 cold history 使用同一规则。不完整或不合法的协议形态 MUST 按普通正文显示，MUST NOT 仅根据单个标记猜测为外置结果。

**需求类别**：功能性需求

#### Scenario: Live 超长 Capability 回答显示友好预览

- **GIVEN** live terminal content 是已提交 terminal Message 的 canonical `PERSISTED_PREVIEW`
- **WHEN** `agent-web` 显示该答案
- **THEN**页面 MUST 以当前 locale 显示部分内容说明、原始字符数、有界 preview 和继续提问提示
- **AND** MUST NOT 显示 replacement reason、ref、内部路径或 Read 指令

#### Scenario: Cold history 与 live 显示一致

- **GIVEN**同一 terminal Message 通过 cold history 恢复
- **WHEN** `agent-web` 再次显示该答案
- **THEN**友好说明、原始字符数与 preview MUST 与 live 相同
- **AND** MUST NOT 依赖 history-only Message metadata 或 workspace 读回

#### Scenario: 普通正文和不完整协议不被误投影

- **GIVEN** terminal answer 是普通 inline 正文，或只包含部分 `<persisted-content>` 形状文本
- **WHEN** `agent-web` 显示该答案
- **THEN**页面 MUST 保持原正文语义
- **AND** MUST NOT 伪造部分内容说明或原始字符数

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：terminal `PERSISTED_PREVIEW` 保留持久化协议，但答案区仅呈现本地化说明和有界 preview。
- **依据 Requirements**：`外置终态结果以用户语言展示部分内容`

### 处理过程

- **变更类型**：修改
- **目标内容**：live/history 共享完整 canonical 形态识别和 i18n 投影，不读取 workspace。
- **依据 Requirements**：`外置终态结果以用户语言展示部分内容`

### 规格

- **规格项**：外置终态结果前端投影
- **变更类型**：新增
- **原规格值**：技术协议文本直接作为普通 Markdown 正文
- **目标规格值**：本地化部分内容说明 + 原始字符数 + 有界 preview + 继续提问提示
- **依据 Requirements**：`外置终态结果以用户语言展示部分内容`
