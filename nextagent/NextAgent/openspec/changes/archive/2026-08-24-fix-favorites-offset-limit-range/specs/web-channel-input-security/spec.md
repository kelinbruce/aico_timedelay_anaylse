## Spec

- **spec**：`web-channel-input-security`（横切安全 spec，覆盖列表查询端点输入边界）
- **spec 角色**：主规格

## MODIFIED Requirements

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

## Spec 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：favorites handler 加 offset 长度守卫（5 位）+ 负数检查 + 数值上界（10000）；schema（annotation-dto + swagger）offset/limit 下沉移除 pattern/maxLength。
- **依据 Requirements**：`列表查询 limit 上限`

### 结果

- **变更类型**：修改
- **目标内容**：`GET /api/v1/favorites` 的 `offset` 范围 0–10000、`limit` 范围 1–100；非法值返回字段级消息（`offset must be an integer.`/`offset must be a non-negative integer.`/`offset must not exceed 10000.`/`limit must be a positive integer.`/`limit must not exceed 100.`），不再返回 `format is invalid.` 或 `WM_HTTP_ERROR`。
- **依据 Requirements**：`列表查询 limit 上限`
