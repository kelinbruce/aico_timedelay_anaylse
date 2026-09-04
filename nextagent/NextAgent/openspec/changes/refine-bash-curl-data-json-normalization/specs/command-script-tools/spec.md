所属 Function：`FN-5.5 执行命令和脚本`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: Bash command-string tokenizer 正确处理双引号转义

Bash command-string mode 的 deterministic tokenization MUST 按 POSIX 双引号语义处理转义字符：双引号串内的 `\"` MUST 消费反斜杠并保留引号字符且不关闭字符串；`\\` MUST 消费为单个反斜杠；`\$` 和 `` \` `` MUST 消费为对应字面字符；`\` 后接换行 MUST 作为行续接被丢弃。双引号串内 `\` 后接其它字符时 MUST 保留反斜杠原样，以保护 JSON 等 payload 自身的转义序列（如 `\n`、`\t`）。单引号串 MUST 保持全字面量语义，反斜杠无特殊含义。引号闭合检测 MUST 与 tokenizer 转义语义一致，使含 `\"` 转义的未闭合命令仍被正确识别为 `balancedQuotes` 违规。

**需求类别**：功能性需求

#### Scenario: 双引号内转义引号保持为同一 token

- **WHEN** 模型提交 `curl -d "{\"k\":\"v\"}" http://x` 形式的 command-string
- **THEN** tokenizer MUST 把 `-d` 后的 payload 解析为一个完整 token `{"k":"v"}`
- **AND** MUST NOT 在 `\"` 处拆分 token

#### Scenario: JSON 转义序列在双引号内被保留

- **WHEN** 模型提交包含 `\"a\\nb\"` 的双引号 payload
- **THEN** tokenizer MUST 保留反斜杠和 `n`，输出包含 `a\nb` 的 token
- **AND** MUST NOT 消费 JSON 自身的 `\n` 转义

#### Scenario: 含转义引号的未闭合命令返回 balancedQuotes 诊断

- **WHEN** 模型提交双引号串内含 `\"` 转义但整体未闭合的 command
- **THEN** Bash MUST 返回 `balancedQuotes` violation 和 `BASH_COMMAND_UNCLOSED_QUOTE` reasonCode
- **AND** MUST NOT 因转义引号误判为已闭合而返回泛化 `tokenizable` 错误

### Requirement: Bash 为 curl data payload 做合法 JSON 校验与 best-effort 修复

当 Bash 的 executable 为 `curl` 时，Bash MUST 在 sandbox 提交前对 `-d`、`--data`、`--data-raw`、`--data-binary` 和 `--data-ascii` flag 的 payload（含 `-dvalue` 粘连形式和 `--data=value` 长形式）执行 JSON 合法性校验。已经是合法 JSON 的 payload MUST 原样透传，包括 JSON 字符串值中合法出现的单引号。不合法的 payload MUST 依次尝试 best-effort 修复：先把所有单引号替换为双引号，再尝试 `JSON.parse`；若仍不合法则删除所有单引号后再尝试 `JSON.parse`。修复成功时 MUST 输出 `JSON.stringify` 规范化后的 JSON。所有修复尝试均无法产生合法 JSON 时 MUST 原样返回 payload，让 curl 自行报错。非 JSON 类型的 payload（表单数据、XML、`@file` 语法、纯文本）MUST 原样透传。

该校验 MUST 在 command-string mode 和 argv mode 下均生效。校验 MUST NOT 绕过 `--max-time` 注入或其它既有 curl 参数处理。校验 MUST NOT 修改非 curl 命令的参数。

**需求类别**：功能性需求

#### Scenario: 合法 JSON payload 原样透传

- **WHEN** 模型提交 `curl -d "{\"k\":\"v\"}" http://x`
- **THEN** sandbox request MUST 收到 payload `{"k":"v"}` 作为完整 argv entry
- **AND** payload MUST NOT 被修改

#### Scenario: 合法 JSON 中值内含单引号保持不变

- **WHEN** 模型提交 payload `{"q":"x'y"}`
- **THEN** sandbox request MUST 收到原样 payload `{"q":"x'y"}`
- **AND** 单引号 MUST NOT 被删除或替换

#### Scenario: 单引号定界 JSON 被修复为合法 JSON

- **WHEN** 模型提交 `curl -d "{'k':'v'}" http://x`
- **THEN** sandbox request MUST 收到 payload `{"k":"v"}`
- **AND** payload MUST 为合法 JSON

#### Scenario: argv mode 下单引号定界 JSON 被修复

- **WHEN** 模型以 argv mode 提交 `command: "curl"`, `args: ["-d", "{'k':'v'}", "http://x"]`
- **THEN** sandbox request MUST 收到 payload `{"k":"v"}`

#### Scenario: 非 JSON payload 原样透传

- **WHEN** 模型提交 `curl -d "key=value&foo=bar" http://x`
- **THEN** sandbox request MUST 收到原样 payload `key=value&foo=bar`
- **AND** payload MUST NOT 被修改

#### Scenario: 无法修复的 payload 原样返回

- **WHEN** 模型提交的 `-d` payload 不是合法 JSON 且任何修复尝试都无法使其合法
- **THEN** Bash MUST 原样返回 payload 提交给 sandbox
- **AND** MUST NOT 静默丢弃或截断 payload 内容

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：Bash command-string tokenizer 在双引号串内按 POSIX 语义处理 `\"`、`\\`、`\$`、`` \` `` 转义和行续接，保留 JSON 自身的反斜杠转义序列（如 `\n`）；`hasUnclosedQuote` 与 tokenizer 转义语义一致。curl 的 `-d`/`--data*` payload 在 sandbox 提交前做合法 JSON 校验，合法 JSON 原样透传（包括值内单引号），不合法时 best-effort 修复（单引号换双引号→删单引号→失败原样返回）。
- **依据 Requirements**：`Bash command-string tokenizer 正确处理双引号转义`、`Bash 为 curl data payload 做合法 JSON 校验与 best-effort 修复`

### 规格

- **规格项**：curl data payload JSON 校验
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：仅 `executable === 'curl'` 时触发；覆盖 `-d`、`--data`、`--data-raw`、`--data-binary`、`--data-ascii`（含粘连和长形式）；合法 JSON 原样透传；不合法依次尝试单引号换双引号、删单引号；修复成功输出 `JSON.stringify` 结果；无法修复原样返回；非 JSON payload 原样透传。
- **依据 Requirements**：`Bash 为 curl data payload 做合法 JSON 校验与 best-effort 修复`

### 主规格

- **变更类型**：修改
- **目标内容**：`command-script-tools`
- **依据 Requirements**：`Bash command-string tokenizer 正确处理双引号转义`、`Bash 为 curl data payload 做合法 JSON 校验与 best-effort 修复`
