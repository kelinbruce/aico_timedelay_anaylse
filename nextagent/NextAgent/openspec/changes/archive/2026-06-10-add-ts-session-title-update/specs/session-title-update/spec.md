## ADDED Requirements

### Requirement: 由 session owner 更新会话标题

session 领域 SHALL 允许 session owner 通过 Web Channel 命令
手动修改会话标题。该操作是同步的——
调用方在请求完成之前收到更新后的标题
或 SafeError。

只有 session owner（`tenantId + subjectId` 与 session 的
owner scope 匹配）SHALL 被授权修改标题。更新后的
`SessionRecord.titleSource` SHALL 被设为 `"manual"`，该值 SHALL
永久阻止自动标题生成覆盖
该 session 的标题（如 `session-title-generation` 所定义）。

#### Scenario: session owner 成功更新标题

- **WHEN** session owner 通过 Channel 入口提交一个
  包含有效标题字符串的标题更新命令
- **AND** 来自可信 `IdentityContext` 的 `tenantId` 和 `subjectId`
  与目标 session 的相匹配
- **AND** 提交的标题通过全部内容校验规则
- **THEN** 系统 SHALL 把新标题持久化到
  `SessionRecord.title`
- **AND** 系统 SHALL 把 `SessionRecord.titleSource` 设为
  `"manual"`
- **AND** 系统 SHALL 写入一个 `session.title.updated` audit 事件
- **AND** 调用方 SHALL 收到一个包含已更新
  `sessionId` 和新标题的响应

#### Scenario: 非 owner 被拒绝

- **WHEN** 某 `tenantId` 或 `subjectId` 与目标 session 的
  owner scope 不匹配的用户提交标题更新命令
- **THEN** 系统 SHALL 以 SafeError 拒绝该请求
- **AND** SafeError SHALL NOT 泄露目标 session 是否
  对另一个 owner scope 存在
- **AND** 不写入任何 audit 事件

#### Scenario: session 不存在

- **WHEN** 某个标题更新命令指向一个不存在
  或对当前 owner scope 不可见的 session
- **THEN** 系统 SHALL 返回安全的 "not found" 错误
- **AND** 该错误 SHALL NOT 区分 "session 不存在" 和
  "session 属于另一个 owner"

### Requirement: 标题内容校验

提交的标题 SHALL 在持久化之前通过强制性内容校验。
校验失败 SHALL 向调用方产生显式的
SafeError 响应。

#### Scenario: 标题长度在 4-100 字符内

- **WHEN** 提交的标题在含 4 和 100 的范围内
- **THEN** 标题 SHALL 通过长度检查

#### Scenario: 低于最小长度的标题被拒绝

- **WHEN** 提交的标题在去除首尾空白后严格
  少于 4 个字符
- **THEN** 系统 SHALL 以 SafeError 拒绝该请求，
  指示标题过短

#### Scenario: 超过最大长度的标题被拒绝

- **WHEN** 提交的标题严格超过 100 个字符
- **THEN** 系统 SHALL 以 SafeError 拒绝该请求，
  指示标题超过最大长度

#### Scenario: 标题为空——清空标题

- **WHEN** 提交的标题是空字符串
- **THEN** 系统 SHALL 清空会话标题并把 `titleSource` 设为 `"manual"`
- **AND** 该 session SHALL 在 UI 中以默认占位标题显示

#### Scenario: 标题包含被禁止的内容模式

- **WHEN** 提交的标题通过长度和字符校验，
  但脱敏策略检测到被禁止的内容模式
  （secret、credential、token、文件路径、环境变量
   引用）
- **THEN** 系统 SHALL 以 SafeError 拒绝该请求，
  指示标题包含不安全内容
- **AND** 该错误 SHALL NOT 包含不安全的标题内容

### Requirement: 标题更新的 audit 事件

每次成功的标题更新 SHALL 产生一个 audit 事件。被拒绝的
更新尝试 SHALL NOT 为标题变更产生 audit 事件
（失败仍可能通过结构化日志或可观测性层
产生 diagnostic 事件）。

#### Scenario: 成功更新时写入 audit 事件

- **WHEN** 某次标题更新被成功持久化
- **THEN** 系统 SHALL 通过 `AuditEventWriter` 写入一个 audit 事件，
  其 `eventName` 设为 `session.title.updated`
- **AND** 该 audit 事件 SHALL 包含 `sessionId`、`tenantId`、
  `subjectId`、`requestRunId`（如在请求上下文中触发）、
  `oldTitle` 引用或安全摘要、`newTitle` 引用或安全
  摘要、以及 `occurredAt`
- **AND** 该 audit 事件 SHALL 包含 `operator` 身份
  （从可信 `IdentityContext` 派生）
- **AND** 该 audit 事件 SHALL NOT 包含原始 secret、credential、
   或已脱敏内容

#### Scenario: 被拒绝的更新不产生标题 audit 事件

- **WHEN** 某次标题更新因任何原因被拒绝（owner
  不匹配、校验失败、脱敏拒绝）
- **THEN** 系统 SHALL NOT 写入 `session.title.updated`
  audit 事件
- **AND** 该拒绝 SHALL 可通过 SafeError
  响应和结构化错误日志追溯

### Requirement: 更新时 titleSource 被设为 manual

系统 SHALL 在每次成功的标题更新时把 `SessionRecord.titleSource` 设为
`"manual"`。一旦被设为 `"manual"`，自动
标题生成系统 SHALL NOT 覆盖该标题。

#### Scenario: 用户更新后 titleSource 被设为 manual

- **WHEN** 某次标题更新被成功持久化
- **THEN** 已持久化记录中的 `SessionRecord.titleSource` SHALL
  为 `"manual"`
- **AND** 同一 session 之后的自动标题生成尝试 SHALL 检测到
  `titleSource === "manual"` 并跳过标题
  生成

#### Scenario: 手动标题在多个 terminal 事件之间保持不变

- **WHEN** 某 session 具有 `titleSource = "manual"`
- **AND** 多个后续请求在该 session 中到达 terminal
  commit
- **THEN** 自动标题生成订阅者 SHALL 跳过每一个
  触发事件
- **AND** `title` 和 `titleSource` SHALL 保持不变

### Requirement: 标题更新是原子的

标题更新操作 SHALL 是原子的：`title` 和
`titleSource` 字段 SHALL 在单次
`SessionStoreGateway.saveSession` 调用中使用 CAS 版本语义写入。

#### Scenario: 并发标题更新安全解决

- **WHEN** 两个标题更新命令竞争同一个 session
- **THEN** 第一个成功调用 `saveSession` 的命令
  SHALL 持久化其标题并写入 audit 事件
- **AND** 第二个命令 SHALL 在 `saveSession` 上遇到版本冲突，
  并 SHALL 返回一个 SafeError，指示该 session
  已被另一个请求修改
- **AND** 第二个命令 SHALL NOT 覆盖第一个命令的
  标题

### Requirement: 失败与 SafeError 传播

所有标题更新校验失败 SHALL 产生显式的 SafeError
响应。Gateway 失败 SHALL 通过错误 normalization 边界
被 normalize 为 SafeError。原始异常、adapter 私有
错误和内部状态 SHALL NOT 被传播到 session
领域边界之外。

#### Scenario: session store 不可用

- **WHEN** `SessionStoreGateway.loadSession` 或 `saveSession` 返回
  gateway 错误或 `UNAVAILABLE` SafeError
- **THEN** 系统 SHALL 返回一个 category 为
  `UNAVAILABLE` 的 SafeError
- **AND** 原始的 gateway 异常 SHALL NOT 被暴露给
  调用方

#### Scenario: 保存时版本冲突

- **WHEN** `SessionStoreGateway.saveSession` 返回一个
  版本冲突结果
- **THEN** 系统 SHALL 返回一个 SafeError，指示该 session
  已被另一个请求修改
- **AND** 调用方 SHALL 能够以新鲜的 session
  状态重试
