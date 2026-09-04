# web-channel-input-security Specification

## Purpose
定义 Web channel 请求输入的安全校验、拒绝行为和边界约束，确保不可信请求参数在进入运行时或持久化路径前被统一验证和限制。
## Requirements
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
- `GET /api/v1/favorites`：`limit` MUST 在 1 到 100 之间（含边界），`offset` MUST 在 0 到 10000 之间（含边界）。`limit` 小于 1 或大于 100 MUST 返回校验错误；`offset` 小于 0 或大于 10000 MUST 返回校验错误。超大 digit string（长度超过 5 位，如 `9999999`）MUST 在数值解析前被长度守卫拒绝，MUST NOT 漏到 backing memory 服务。

超限 `limit`/`offset` MUST 返回 HTTP 400 校验错误，系统 MUST NOT 执行降级的宽松查询。负数 `limit` MUST 被拒绝，不得通过 SQLite `LIMIT -1` 等价于无限制的语义绕过上限。

`GET /api/v1/favorites` 的 `offset`/`limit` 校验 MUST 在路由 parser 层执行字段级校验并返回确定消息：非法值（负数、小数、越界）MUST 返回字段级 `REQUEST_VALIDATION_FAILED` 消息，MUST NOT 返回笼统的 `<field> format is invalid.`；schema 层 MUST NOT 用 `pattern`/`maxLength` 提前拦截这些值（校验下沉到 parser，确保部署版 schema 与本仓 schema 行为一致）。

**需求类别**：安全性需求

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

- **WHEN** 客户端发送 `GET /api/v1/favorites?limit=-1`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 错误消息 MUST 为 `limit must be a positive integer.`
- **AND** 系统 MUST NOT 返回无限制数量的收藏标注

#### Scenario: favorites limit 为 0 被拒绝

- **WHEN** 客户端发送 `GET /api/v1/favorites?limit=0`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误

#### Scenario: favorites limit 等于 100 被接受

- **WHEN** 客户端发送 `GET /api/v1/favorites?limit=100`
- **THEN** 系统 MUST 接受请求并返回最多 100 条收藏标注

#### Scenario: favorites limit 为小数返回字段级消息

- **WHEN** 客户端发送 `GET /api/v1/favorites?limit=1.5`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 错误消息 MUST 为 `limit must be a positive integer.`
- **AND** 错误消息 MUST NOT 为 `limit format is invalid.`

#### Scenario: favorites offset 超过 10000 被拒绝且不漏到 backing service

- **WHEN** 客户端发送 `GET /api/v1/favorites?offset=9999999`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 错误消息 MUST 为 `offset must not exceed 10000.`
- **AND** 系统 MUST NOT 调用 backing favorite/memory 服务（MUST NOT 产生 `WM_HTTP_ERROR`）

#### Scenario: favorites offset 等于 10000 被接受

- **WHEN** 客户端发送 `GET /api/v1/favorites?offset=10000&limit=20`
- **THEN** 系统 MUST 接受请求并返回对应分页

#### Scenario: favorites offset 为负数返回字段级消息

- **WHEN** 客户端发送 `GET /api/v1/favorites?offset=-1`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 错误消息 MUST 为 `offset must be a non-negative integer.`
- **AND** 错误消息 MUST NOT 为 `offset format is invalid.`

#### Scenario: favorites offset 为小数返回字段级消息

- **WHEN** 客户端发送 `GET /api/v1/favorites?offset=1.5`
- **THEN** 系统 MUST 返回 HTTP 400 校验错误
- **AND** 错误消息 MUST 为 `offset must be an integer.`
- **AND** 错误消息 MUST NOT 为 `offset format is invalid.`
