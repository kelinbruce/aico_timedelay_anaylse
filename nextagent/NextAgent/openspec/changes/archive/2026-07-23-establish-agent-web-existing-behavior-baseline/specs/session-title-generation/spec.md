## ADDED Requirements

### Requirement: 被接受的普通提交 SHALL 在 session 标题解决之前启动非阻塞的标题尝试

在每个普通提交已持久化并发出 `REQUEST_ACCEPTED` 之后，runtime SHALL 使用该被接受命令的输入文本，以 fire-and-forget 工作方式启动自动标题生成，除非同一 runtime 实例已把该 session 记录为已生成，或因发现手动或既有标题而有意跳过。标题生成 MUST NOT 延迟 request 调度、执行、流式输出或 terminal commit。它 SHALL NOT 等待 request 终态，也 SHALL NOT 查询会话历史来选择不同的 prompt。重试和 edit-resubmit 的接受 SHALL NOT 启动该标题路径。

#### Scenario: 被接受的普通提交启动标题工作
- **GIVEN** 一个普通提交已持久化并发出 `REQUEST_ACCEPTED`
- **WHEN** 当前 runtime 尚未解决该 session 的标题生成
- **THEN** runtime SHALL 从该命令的输入文本启动自动标题生成
- **AND** SHALL 在不等待标题完成的情况下继续调度

#### Scenario: 失败或不合格的尝试可由稍后的提交重试
- **GIVEN** 一次尝试因输入为空、以 slash 为前缀、不安全、缺失或失败而未生成返回
- **WHEN** 稍后在同一 session 中接受了新的普通提交
- **THEN** runtime SHALL 从稍后命令的输入再次尝试标题生成

#### Scenario: 重试和编辑不启动标题工作
- **WHEN** 重试或 edit-resubmit 被接受
- **THEN** 该接受 SHALL NOT 调用自动标题生成路径

#### Scenario: 标题失败不使 request 失败
- **WHEN** 自动标题生成抛出异常或无法持久化标题
- **THEN** request 生命周期 SHALL 独立继续
- **AND** 该失败 SHALL NOT 改变 request 终态结果

### Requirement: 自动标题生成 SHALL 保留手动或既有标题

自动生成 SHALL 以可信的 owner 和 Agent 作用域加载 session。对缺失的 session、`titleSource` 为 `manual` 的 session，或当前标题长度非零的 session，它 SHALL 不做任何事。空白输入和 slash 命令输入 SHALL 不产生自动标题。

#### Scenario: 手动标题不被覆盖
- **GIVEN** 一个 session 的 `titleSource="manual"`
- **WHEN** 自动标题生成运行
- **THEN** 它 SHALL 保留既有标题及其来源

#### Scenario: 既有的非空标题不被覆盖
- **GIVEN** 一个 session 已有长度大于零的标题
- **WHEN** 自动标题生成运行
- **THEN** 它 SHALL 保留该标题

#### Scenario: Slash 命令不生成标题
- **GIVEN** 被接受的输入在修剪后以 `/` 开头
- **WHEN** 自动标题生成评估它
- **THEN** 它 SHALL 不持久化自动标题

### Requirement: 自动标题提取 SHALL 是确定性且有界的

自动标题提取 SHALL 规范化控制字符和空白、移除首尾标点、对较长的 prompt 优先选用早期句子或句子边界截断，并把持久化的标题限制在 40 个字符以内。若首选提取变得过短，实现 MAY 回退到规范化的原始输入，并仍持久化一个较短的非空标题。与已实现的敏感信息或 XSS 敏感模式匹配的自动标题输出 SHALL 被拒绝。

#### Scenario: 长 prompt 产生有界标题
- **WHEN** 被接受的输入超过首选标题长度
- **THEN** 提取 SHALL 优先选用早期句子或句子边界截断
- **AND** 持久化的自动标题 SHALL 至多包含 40 个字符

#### Scenario: 短的规范化回退仍合格
- **GIVEN** 首选提取产生少于四个字符但规范化的原始输入非空
- **WHEN** 回退提取运行
- **THEN** 该回退 MAY 被持久化，即使它短于四个字符

#### Scenario: 形似敏感内容的输出被拒绝
- **WHEN** 提取的输出匹配已实现的敏感信息或 XSS 敏感模式
- **THEN** 自动标题生成 SHALL NOT 持久化它

### Requirement: 自动标题持久化 SHALL 以 owner 和 Agent 为作用域

Runtime SHALL 通过 session owner 以可信的 owner 和 Agent 作用域以及 `titleSource="automatic"` 持久化自动标题。

#### Scenario: 自动标题写入使用可信作用域
- **WHEN** runtime 持久化一个合格的自动标题
- **THEN** session owner SHALL 接收可信的 owner 和 Agent 作用域
- **AND** 存储的标题来源 SHALL 为 `automatic`
