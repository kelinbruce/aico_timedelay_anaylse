# web-channel-input-security Specification

## Purpose

定义跨 web 通道和 task 通道的输入安全边界契约：locale 参数安全模式和列表查询 limit DoS 上限。这些是跨多个 API 端点的非功能性安全约束，确保不可信输入不能触发路径穿越或无界资源消耗。

## ADDED Requirements

### Requirement: Locale 参数安全模式

Web channel 和 task channel 的所有 locale 输入参数 MUST 匹配固定 pattern `^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$`。该 pattern 允许单字母 locale、纯字母 locale 和 `language-Region` 形式（如 `zh`、`en`、`zh-CN`、`en-US`、`pt-BR`），首尾必须为字母，中间允许字母和连字符。pattern MUST 拒绝包含 `/`、`\`、`..`、空格、Unicode、数字或其他路径穿越/注入字符的 locale 输入。校验 MUST 在 Fastify schema 层通过 TypeBox `pattern` 约束执行，非法 locale MUST 在请求入口返回 HTTP 400 校验错误。

locale 参数安全模式 MUST 覆盖以下入口（同形同策）：`GET /api/v1/category-questions`、`GET /api/v1/frequent-questions`、`GET /api/v1/question-associations`、`POST /api/v1/sessions/:sessionId/requests`（submitBody）、`POST /api/v1/sessions/:sessionId/convenience-submit`（convenienceSubmitBody）、`POST /api/v1/sessions/:sessionId/requests/:requestId/edit-latest`（editLatestBody）、`POST /api/v1/sessions`（createSessionBody）、task channel createTask 和 editTask 请求体。

`normalizeLocale` 函数 MUST 包含深度防御：当 locale 字符串包含 `/`、`\` 或 `..` 时，MUST 直接返回 fallback 语言，不执行 `-` 分割和 `toLowerCase`。该防御作为 schema 层校验的兜底，防止未来新增 locale 入口遗漏 pattern 约束。

locale pattern 和 locale maxLength 为固定常量，系统 MUST NOT 从 client payload、client metadata、model output 或 capability arguments 读取或覆盖 pattern 约束。

#### Scenario: 合法 locale 通过校验

- **WHEN** 客户端发送 `GET /api/v1/category-questions?locale=zh-CN`
- **THEN** 系统 MUST 接受请求并使用 `zh-CN` 进行 locale 规范化后查询
- **AND** 系统 MUST NOT 返回校验错误

#### Scenario: 单字母 locale 通过校验

- **WHEN** 客户端发送 `GET /api/v1/category-questions?locale=en`
- **THEN** 系统 MUST 接受请求

#### Scenario: 路径穿越 locale 被拒绝

- **WHEN** 客户端发送 `GET /api/v1/category-questions?locale=/../../secret`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 系统 MUST NOT 使用该 locale 值进行文件路径拼接或查询

#### Scenario: 包含 `..` 的 locale 被拒绝

- **WHEN** 客户端发送 `GET /api/v1/category-questions?locale=..`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 系统 MUST NOT 读取 resource 目录外的文件

#### Scenario: 包含反斜杠的 locale 被拒绝

- **WHEN** 客户端发送 `GET /api/v1/category-questions?locale=zh\..`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误

#### Scenario: submit 请求体 locale 被校验

- **WHEN** 客户端发送 `POST /api/v1/sessions/:sessionId/requests` 且请求体 `locale` 为 `/../../etc/passwd`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 系统 MUST NOT 使用该 locale 值

#### Scenario: task channel locale 被校验

- **WHEN** task channel createTask 或 editTask 请求体 `locale` 为 `../malicious`
- **THEN** 系统 MUST 返回校验错误
- **AND** 系统 MUST NOT 使用该 locale 值

#### Scenario: normalizeLocale 深度防御兜底

- **WHEN** `normalizeLocale` 收到包含 `/`、`\` 或 `..` 的 locale 字符串（绕过 schema 校验的场景）
- **THEN** `normalizeLocale` MUST 返回 fallback 语言
- **AND** MUST NOT 使用该 locale 值进行文件路径拼接

### Requirement: 列表查询 limit 上限

Web channel 列表查询端点的 `limit` 参数 MUST 受固定上限约束，防止无界查询导致的 DoS。上限为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖上限值。

具体约束：

- `GET /api/v1/sessions` 非搜索路径：`limit` MUST 为正整数且 MUST NOT 超过 200。搜索路径（提供 `q` 参数）的 `limit` 上限保持既有 50 不变。
- `GET /api/v1/sessions/:sessionId/conversation`：`limit` MUST 为正整数且 MUST NOT 超过 500。
- `GET /api/v1/sessions/:sessionId/runs/:runId/annotations`（favorites）：`limit` MUST 在 1 到 100 之间（含边界）。`limit` 小于 1 或大于 100 MUST 返回校验错误。

超限 `limit` MUST 返回 HTTP 400 校验错误，系统 MUST NOT 执行降级的宽松查询。负数 `limit` MUST 被拒绝，不得通过 SQLite `LIMIT -1` 等价于无限制的语义绕过上限。

#### Scenario: session list 非搜索 limit 超过 200 被拒绝

- **WHEN** 客户端发送 `GET /api/v1/sessions?limit=201`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 系统 MUST NOT 返回未过滤或部分过滤的会话列表

#### Scenario: session list 非搜索 limit 等于 200 被接受

- **WHEN** 客户端发送 `GET /api/v1/sessions?limit=200`
- **THEN** 系统 MUST 接受请求并返回最多 200 条会话

#### Scenario: conversation limit 超过 500 被拒绝

- **WHEN** 客户端发送 `GET /api/v1/sessions/:sessionId/conversation?limit=501`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 系统 MUST NOT 返回未过滤或部分过滤的会话消息

#### Scenario: favorites limit 为负数被拒绝

- **WHEN** 客户端发送 `GET /api/v1/sessions/:sessionId/runs/:runId/annotations?limit=-1`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 系统 MUST NOT 返回无限制数量的收藏标注

#### Scenario: favorites limit 为 0 被拒绝

- **WHEN** 客户端发送 `GET /api/v1/sessions/:sessionId/runs/:runId/annotations?limit=0`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误

#### Scenario: favorites limit 等于 100 被接受

- **WHEN** 客户端发送 `GET /api/v1/sessions/:sessionId/runs/:runId/annotations?limit=100`
- **THEN** 系统 MUST 接受请求并返回最多 100 条收藏标注