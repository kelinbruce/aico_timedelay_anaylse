## ADDED Requirements

### Requirement: 收藏数量上限
系统 MUST 对每个 `(tenantId, subjectId)` scope（即单用户，跨所有 agent）的收藏数量强制执行固定上限：同一 scope 下最多存在 100 个 `isFavorited=true` 的标注行。local 宿主上限 MUST 在 annotation save 事务内原子 enforce：gateway MUST 在同一事务中统计当前 scope 下 `is_favorited=1` 的现有行数，当计数已达到 100 且本次写入为净新增收藏时，MUST 在 INSERT 或 UPDATE 之前拒绝写入。remote 宿主无 gateway 事务 enforce 能力，前端 MUST 在净新增收藏前查询 `listFavoriteTurns(limit=100)`，若 `entries.length >= 100` 则 MUST NOT 发送 upsert 请求并 MUST 展示专门的数量超限提示。上限 MUST 只对净新增收藏生效：INSERT 且 `isFavorited=true`、或 UPDATE 将 `isFavorited` 从 false 翻转为 true 时校验；取消收藏（true→false）、对已收藏行重新收藏（true→true）、单独更新 sentiment 或 comment MUST NOT 触发上限校验。supersede 清理和会话删除级联删除 `is_favorited=1` 行后 MUST 自然释放配额，无需额外配额返还机制。上限值是固定常量 100，系统 MUST NOT 从 client payload、client metadata、model output 或 capability arguments 读取上限或计数。当上限被超出时，gateway MUST 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`；Web channel MUST 将其投影为 HTTP `400` 且 MUST NOT 暴露 tenant、subject、storage、SQL、stack trace 或 hidden resource existence；前端 MUST 回滚乐观收藏状态并展示专门的数量超限提示，而非通用标注错误文案。`isQuestionFavorited` 不受本上限约束。

#### Scenario: 第 100 个收藏被接受
- **WHEN** scope `(T1, U1)` 下已有 99 个 `is_favorited=1` 的标注行
- **AND** 用户收藏一个新 run（该 run 无既有标注，`isFavorited=true`）
- **THEN** gateway MUST 接受写入并创建 `is_favorited=1` 行
- **AND** 该 scope 下 `is_favorited=1` 行数变为 100

#### Scenario: 第 101 个收藏被拒绝
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户收藏一个新 run（该 run 无既有标注，`isFavorited=true`）
- **THEN** gateway MUST 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`
- **AND** gateway MUST NOT 插入新行、修改既有行或改变 scope 内 `is_favorited=1` 行数

#### Scenario: 取消收藏不受上限影响
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户取消其中一个已收藏 run 的收藏（`isFavorited=false`）
- **THEN** gateway MUST 接受写入，将该行 `is_favorited` 置为 0
- **AND** 该 scope 下 `is_favorited=1` 行数变为 99

#### Scenario: 已收藏行重新收藏不触发上限
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户对其中一个已收藏 run 再次发送 `isFavorited=true`（true→true）
- **THEN** gateway MUST 接受写入，不触发计数校验
- **AND** 该 scope 下 `is_favorited=1` 行数保持 100

#### Scenario: 已收藏行更新 sentiment 不触发上限
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户对其中一个已收藏 run 设置 `sentiment="UP"`（不修改 `isFavorited`）
- **THEN** gateway MUST 接受写入，不触发计数校验
- **AND** 该 scope 下 `is_favorited=1` 行数保持 100

#### Scenario: 跨 agent 共享配额
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行（分布在 agent A1 和 A2 的 run 上）
- **AND** 用户在 agent A2 的一个新 run 上收藏（`isFavorited=true`）
- **THEN** gateway MUST 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`
- **AND** 配额按用户 `(T1, U1)` 聚合，不按 agent 隔离

#### Scenario: supersede 清理释放配额
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 其中一个被收藏的 run 被 retry/edit 取代，supersede 清理删除其标注行
- **AND** 用户随后收藏一个新 run
- **THEN** gateway MUST 接受写入
- **AND** 该 scope 下 `is_favorited=1` 行数恢复为 100

#### Scenario: 幂等重放不受上限影响
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 一个收藏操作在达到上限前已被 accepted 并锚定 idempotency key
- **AND** client 以相同 idempotency key 重放该收藏操作
- **THEN** gateway MUST 返回首次 accepted 的结果
- **AND** gateway MUST NOT 因当前已达上限而拒绝该幂等重放

#### Scenario: 超限安全错误的 Web 投影
- **WHEN** `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 因收藏上限被拒绝
- **THEN** Web channel MUST 返回 HTTP `400`
- **AND** 响应 body MUST 包含稳定错误码 `FAVORITE_LIMIT_EXCEEDED`
- **AND** 响应 MUST NOT 暴露 raw tenant、subject、storage、SQL、stack trace 或 hidden resource existence

#### Scenario: local 前端超限回滚与提示
- **WHEN** local 宿主 agent-web 收到 `FAVORITE_LIMIT_EXCEEDED` 错误
- **THEN** agent-web MUST 回滚乐观收藏状态至操作前
- **AND** agent-web MUST 展示专门的数量超限提示
- **AND** agent-web MUST NOT 展示通用标注错误文案

#### Scenario: remote 前端前置检查
- **WHEN** remote 宿主（`immersive`/`piu` 模式）用户尝试净新增收藏（`isFavorited` 从 false→true）
- **AND** 当前用户收藏列表 `listFavoriteTurns(limit=100)` 返回 `entries.length >= 100`
- **THEN** agent-web MUST NOT 发送 upsert 请求
- **AND** agent-web MUST 回滚乐观收藏状态至操作前
- **AND** agent-web MUST 展示专门的数量超限提示
- **AND** agent-web MUST NOT 展示通用标注错误文案
