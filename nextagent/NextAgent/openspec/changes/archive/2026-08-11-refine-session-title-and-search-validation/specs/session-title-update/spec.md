## MODIFIED Requirements

### Requirement: 标题内容校验

提交的标题 SHALL 在持久化之前通过强制性
内容校验。校验失败 SHALL 向调用方产生明确的
SafeError 响应。系统 SHALL 在校验前
去除提交标题的首尾空白，并 SHALL
持久化去除空白后的标题。

#### Scenario: 标题长度在 1-100 字符以内

- **WHEN** 提交的标题在去除首尾空白后长度介于 1 到 100
  个字符之间（含边界）
- **THEN** 该标题 SHALL 通过长度检查

#### Scenario: 去除空白后为空的标题被拒绝

- **WHEN** 提交的标题是空字符串或仅包含
  空白字符（空格、制表符或其他空白）
- **THEN** 系统 SHALL 以 SafeError 拒绝该请求，
  指明标题必须为 1-100 个字符
- **AND** 系统 SHALL NOT 修改已持久化的会话标题

#### Scenario: 超过最大长度的标题被拒绝

- **WHEN** 提交的标题在去除首尾空白后严格超过 100
  个字符
- **THEN** 系统 SHALL 以 SafeError 拒绝该请求，
  指明标题超过最大长度

#### Scenario: 标题在持久化前被去除首尾空白

- **WHEN** 提交的标题通过校验且包含首部
  或尾部空白
- **THEN** 系统 SHALL 将去除空白后的标题持久化到
  `SessionRecord.title`

#### Scenario: 标题包含被禁止的内容模式

- **WHEN** 提交的标题通过长度和字符校验，
  但 redaction policy 检测到被禁止的内容模式
  （secret、credential、token、file path、environment variable
   reference）
- **THEN** 系统 SHALL 以 SafeError 拒绝该请求，
  指明标题包含不安全内容
- **AND** 该错误 SHALL NOT 包含不安全的标题内容
