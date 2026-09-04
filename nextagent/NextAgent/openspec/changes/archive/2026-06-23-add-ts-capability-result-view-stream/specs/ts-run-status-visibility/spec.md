## ADDED Requirements

### Requirement: Capability result stream payload MUST 只暴露安全的结果投影

当 Web channel 投影一个 `CAPABILITY_RESULT_DELTA` stream envelope 时，它 MAY 包含 `payload.safeResult` 作为 capability 结果的有界、用户可见投影。`safeResult` MUST 只从允许清单内的结果字段派生，并且 MUST NOT 暴露隐藏的 assistant tool-use message、原始 tool 参数、原始 command/code 输入、runtime 关联 id 或任意 capability 元数据。

`payload.safeSummary` SHOULD 携带从上游 `safeSummary` 或 `safeResult` 派生的简短安全摘要。诸如 `Capability result is available.` 之类的通用技术占位符 MUST NOT 作为有效的 `safeSummary` 传播。`payload.text` 和 `payload.content` MUST 在有安全细节文本可用时包含它，否则为空字符串。它们 MUST NOT 包含通用技术占位符。

当 Web channel 在 `CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED` 上投影 Web 可见的 capability 失败时，它 MUST 只保留安全失败事实，例如 `safeErrorCode`、`safeErrorCategory`、`status` 和具体的安全摘要。它 MUST NOT 把原始 `safeError.message`、tool 参数、原始结果字段、runtime 关联 id 或任意失败元数据复制到用户可见的 payload 字段中。

#### Scenario: 命令输出被投影为有界的安全结果

- **WHEN** 一个 capability 结果包含命令式输出字段，例如 `stdout`、`stderr` 和退出码
- **THEN** stream 投影 MAY 包含一个带有退出状态和有界 stdout/stderr 预览的命令输出 `safeResult`
- **AND** stream 投影 MAY 包含从该允许清单输出派生的 `safeSummary` 和安全细节 `text`/`content`
- **AND** 该投影 MUST NOT 包含原始命令或调用参数
- **AND** 当安全 stderr 呈现为 `CODE: message` 形状时，用户可见细节 SHOULD 把 error code 与安全 error 信息分开呈现
- **AND** 单行的安全 error 信息 SHOULD 以本地化标签标点内联渲染，而多行 error 信息 MAY 渲染为带标签的块
- **AND** 被 policy 阻止的命令结果 SHOULD 使用被阻止命令的摘要/状态，而不是把结果呈现为普通命令完成

#### Scenario: 文件读取、写入和列表结果被投影为有界的安全结果

- **WHEN** 一个 capability 结果包含允许清单内的文件读取、文件写入或文件列表字段
- **THEN** stream 投影 MAY 包含一个类型化的 `safeResult`，按需包含有界内容预览、所选读取范围、续读位置、文件名、操作、截断状态或计数
- **AND** 文件读取结果 MAY 在该路径属于所选读取结果展示的一部分时暴露被读取的文件路径
- **AND** 文件写入结果 MUST 只暴露写入操作状态，不暴露被写入的文件路径
- **AND** 未知结果字段 MUST NOT 被复制进 `safeResult`
- **AND** 前端文件读取细节 SHOULD 以面向用户的语言解释所选行范围和任何被省略的续读内容，而不要求用户理解 `offset`、`limit` 或 `nextOffset` 字段名

#### Scenario: Skill 内容不被暴露为结果细节

- **WHEN** 一个 Skill capability 结果包含已加载的 Skill 内容
- **THEN** stream 投影 MAY 在 `safeResult` 中包含 Skill 名称和加载状态
- **AND** Skill 内容正文 MUST NOT 被复制进用户可见的 `safeResult`、`safeSummary`、`text` 或 `content`

#### Scenario: 未知结果形状保持安全的非特定性

- **WHEN** 一个 capability 结果不匹配任何允许清单的安全投影形状
- **THEN** stream 投影 MUST NOT 把原始结果字段复制进 `safeResult`、`safeSummary`、`text` 或 `content`
- **AND** 前端 MUST 渲染一个非特定的"已返回结果"摘要，而不暴露原始 payload 内容

#### Scenario: 历史 capability-result message 在展示前被净化

- **WHEN** 前端从一个已存储的会话 `CAPABILITY_RESULT` message 重建一个历史加载的 `CAPABILITY_RESULT_DELTA`
- **THEN** 重建的 payload MUST NOT 把已存储的原始 message 内容复制进用户可见的 `text` 或 `content`
- **AND** 允许清单内的历史 `safeResult` 或 `safeSummary` 字段 MAY 仍然驱动与实时 stream envelope 相同的执行细节渲染路径
- **AND** 历史 `safeSummary` 回退 MUST NOT 使已存储的原始 capability payload 内容可展开或可见

#### Scenario: 失败的 capability 完成携带安全失败事实

- **WHEN** Web channel 为一次失败的 capability 调用投影一个 `CAPABILITY_COMPLETED` 事件
- **THEN** stream envelope payload MUST 在存在时保留安全失败 code、安全失败 category 和调用 status
- **AND** 前端 SHOULD 以用户可读的失败摘要渲染相应的 tool 行，并将 code/category/status 保留在二级细节中
- **AND** 降级通知 MAY 作为次要系统通知保持可见，但它们 MUST NOT 是失败 tool 的唯一用户可读解释
- **AND** 原始 safe error message、原始结果 payload 字段、tool 参数和 runtime 关联 id MUST NOT 被暴露

#### Scenario: 历史失败的 capability 结果保持用户可读

- **WHEN** 前端渲染一个带有安全 error code 或 category 字段的历史加载 `CAPABILITY_RESULT_DELTA`
- **THEN** tool 摘要 SHOULD 使用映射后的用户可读失败原因，而不是通用技术失败标签
- **AND** 二级细节 MAY 包含安全 error code、安全 category 和调用 status
- **AND** 原始结果 payload 字段、原始 safe error message、tool 参数和 runtime 关联 id MUST NOT 被暴露

#### Scenario: 历史重放为带 timeline 引用的过程事件保持全流程入口

- **WHEN** 前端收到携带真实 timeline 事件引用的历史加载过程 envelope
- **THEN** 执行细节摘要和全流程 timeline 入口 SHOULD 使用与实时过程事件相同的渲染规则
- **AND** 不带 timeline 事件引用的会话历史 capability-result message 自身 MUST NOT 被当作完整的过程 timeline

#### Scenario: 失败终端历史只保留真实的部分答案内容

- **WHEN** 前端从历史加载的终端事件重建答案内容
- **THEN** 一个 `REQUEST_FAILED` 终端事件只在其内容不是安全失败占位符时才 MAY 用作部分答案回退
- **AND** 诸如 `Request failed`、`Request failed: ...` 或 `Request failed safely: CODE` 之类的安全失败占位符 MUST NOT 被渲染为 assistant 答案内容
- **AND** 失败轮次通知 SHOULD 区分恢复了部分答案内容的轮次和没有答案内容的轮次

#### Scenario: 执行细节展开与收起不产生视觉重叠

- **WHEN** 前端在存在流式内容时展开或收起执行细节面板
- **THEN** 面板 SHOULD 使用实测高度和不透明度进行过渡，而不是突然切换
- **AND** 面板内容 MUST 在过渡期间保持裁剪，使执行细节不能在视觉上与其下方的答案正文重叠
- **AND** 执行细节摘要行与展开细节面板之间的间距 MUST 为 12px

### Requirement: 前端本地 view state MUST 保持视觉与导航稳定

前端 MUST 对 chat viewport 和侧边栏 session-list viewport 应用相同的主题化滚动条处理。在暗色主题下，预留的滚动条 gutter 和轨道区域 MUST 使用主题化的页面背景，并且 MUST NOT 回退到浅色的浏览器默认轨道。

侧边栏 session-list 的展开/收起状态 MUST 存储为 sessionStorage 支持的本地 UI 偏好。当该偏好在同一浏览器 tab 中刷新后恢复为展开时，session-list 刷新入口 MUST 保持已展开的 history 数据窗口，而不是收起到最近 session 页大小。这包括挂载时的刷新以及后续不带显式分页而重新加载 session history 的 request-control 或 stream recovery 刷新。

普通模式 composer 草稿 MUST 在浏览器 tab 存活期间按 session 缓存。当用户切换离开一个 session 后再返回时，composer MUST 恢复该 session 未发送的输入。编辑模式替换文本和活跃 pending-input 响应 MUST NOT 覆盖普通的按 session 草稿。

#### Scenario: 侧边栏 session list 使用与 chat 相同的主题化滚动条

- **WHEN** 侧边栏 session list 处于展开且可滚动状态
- **THEN** 其滚动条 thumb、track、gutter 和暗色模式 color-scheme SHOULD 与主 chat viewport 的滚动条处理匹配
- **AND** 该样式 MUST NOT 在滚动可用或不可用时引起任一 viewport 中的水平内容偏移

#### Scenario: 恢复的展开 session list 请求展开的页大小

- **GIVEN** 用户先前展开了侧边栏 session list
- **WHEN** 前端再次加载
- **THEN** 侧边栏 MUST 从 sessionStorage 恢复展开状态
- **AND** 挂载时的 session-list 刷新请求 MUST 使用展开的 history 页大小
- **AND** 后续非分页的 session-list 刷新 MUST 保持当前展开的 history 数据窗口
- **AND** 收起 MUST 更新已存储的偏好，使下一次刷新回到最近 session 页大小

#### Scenario: 所选 session 的 composer 草稿被恢复

- **GIVEN** 用户在 session A 中输入了未发送的普通模式草稿
- **WHEN** 用户切换到 session B 后又在同一浏览器 tab 中返回 session A
- **THEN** composer MUST 恢复 session A 的未发送草稿
- **AND** session B 的草稿 MUST 与 session A 的草稿保持隔离
- **AND** 从 session A 切换到 session B MUST NOT 在 session B 完成注水之前，将 session A 当前可见的输入发布为 session B 的普通草稿
- **AND** 成功提交的草稿 MUST 为该 session 清除
- **AND** 编辑模式文本和 pending-input 响应文本 MUST NOT 被存储为普通的 session 草稿
