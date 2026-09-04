## ADDED Requirements

### Requirement: 附件选择器与文件拖放 SHALL 共享同一条受权限控制的接入路径

Agent Web SHALL 通过文件选择器和文件拖放以相同的客户端接入行为接受附件。非文件拖拽数据 SHALL 被忽略。没有 `AICOService.Write` 时，附件按钮 SHALL 被禁用，隐藏的 file input SHALL 不渲染，文件拖放 SHALL 不添加附件。

#### Scenario: 选择器与文件拖放通过同一队列添加
- **WHEN** 用户从选择器选择受支持的文件，或在 Composer 上拖放受支持的文件
- **THEN** Agent Web SHALL 应用相同的批次校验和队列行为

#### Scenario: 非文件拖拽被忽略
- **WHEN** 用户把不包含文件的数据拖到 Composer 上
- **THEN** Agent Web SHALL NOT 显示文件拖放接入，也不添加附件

#### Scenario: 缺少 Write 权限阻止附件接入
- **GIVEN** 一个远程用户缺少 `AICOService.Write`
- **WHEN** Composer 被渲染或有文件被拖放
- **THEN** 附件按钮 SHALL 可见但被禁用
- **AND** file input SHALL 不渲染
- **AND** 拖放的文件 SHALL 不进入队列

### Requirement: 客户端附件预检 SHALL 原子性地拒绝非法批次

在更改本地队列之前，Agent Web MUST 对照当前队列校验完整的选择批次。合并后的队列 SHALL 至多包含 3 个文件。每个文件名 SHALL 不区分大小写地以 `.md` 或 `.markdown` 结尾，每个文件 SHALL 至多 5 MiB。重复身份 SHALL 是小写化的文件名加上大小和 `lastModified`，并同时对照现有队列和同一批次检查。任何一项检查失败时，Agent Web SHALL 拒绝完整的新批次，保留现有队列，并显示警告。此客户端预检 SHALL NOT 取代权威的服务器附件校验。

#### Scenario: 一个非法文件使完整新批次被拒绝
- **GIVEN** 一个选择批次同时包含合法与非法文件
- **WHEN** 该批次被添加
- **THEN** 新文件中没有一个 SHALL 进入队列
- **AND** 现有队列 SHALL 保持不变
- **AND** Agent Web SHALL 显示校验警告

#### Scenario: 重复身份包含元数据
- **GIVEN** 一个现有或同批次的文件具有相同的忽略大小写文件名、大小和 `lastModified`
- **WHEN** 该重复文件被选择
- **THEN** Agent Web SHALL 把完整的新批次作为重复项拒绝

#### Scenario: 服务器仍是文件内容的权威
- **GIVEN** 一个文件通过文件名、大小、数量和重复预检，但违反服务器内容校验
- **WHEN** 用户提交它
- **THEN** Agent Web SHALL 呈现映射后的安全服务器警告
- **AND** SHALL 保留消息和附件队列以供修正

### Requirement: 根路由上的首个合法附件 SHALL 在入队前建立其 session

当在 pre-session 根路由上选择了一个合法附件批次时，Agent Web SHALL 创建一个 session，用该 session 替换路由，将其激活，然后把文件加入绑定该 session 的本地队列。未通过客户端校验的批次 SHALL NOT 创建 session。

#### Scenario: 根路由合法附件创建并绑定 session
- **GIVEN** 用户位于 pre-session 根路由
- **WHEN** 用户选择一个合法附件批次
- **THEN** Agent Web SHALL 在将文件入队前创建并激活一个 session

#### Scenario: 根路由非法附件不创建 session
- **GIVEN** 用户位于 pre-session 根路由
- **WHEN** 附件预检拒绝了所选批次
- **THEN** Agent Web SHALL 保持在根路由而不创建 session

### Requirement: 附件队列 SHALL 表示本地待提交文件

附件队列 SHALL 显示每个已接受本地文件的文件名、大小、就绪状态和移除操作。未通过客户端预检的文件 SHALL 以校验提示呈现，而不是以持久的错误条目留在队列中。通过客户端预检的文件 SHALL 被视为本地就绪、可用于普通 request 提交；Agent Web SHALL NOT 把该状态描述为已完成服务器上传的证明。只有当用户发起普通提交后，Agent Web 才 SHALL 把队列中的文件交给当前的 normal-request 附件流程；传输端点和临时引用契约由该 frontend 队列能力之外拥有。当前浏览器 edit-resubmit 路径是纯文本的：非空的本地附件队列 SHALL 在 Web edit 路由被调用之前失败，并 SHALL 保持可用以供修正或稍后的普通提交。移除一个附件 SHALL 同时清除当前的附件校验提示。Composer SHALL 要求消息文本非空且所有已排队附件在本地就绪后才启用提交。

#### Scenario: 就绪附件在普通提交前保持本地状态
- **WHEN** 一个文件通过客户端预检并进入队列
- **THEN** Agent Web SHALL 将其显示为待提交就绪
- **AND** 只有在用户发起普通提交后才 SHALL 把它交给 normal-request 附件流程

#### Scenario: 浏览器编辑不接受已排队附件
- **GIVEN** 编辑模式下有非空的本地附件队列
- **WHEN** 用户确认 edit-resubmit
- **THEN** Agent Web SHALL 在调用 Web edit 路由之前失败
- **AND** SHALL 保留已编辑的文本和附件队列

#### Scenario: 仅附件提交不可用
- **GIVEN** 队列包含就绪文件但消息文本为空
- **WHEN** Composer 评估提交资格
- **THEN** 提交 SHALL 保持禁用

#### Scenario: 移除清除附件提示
- **GIVEN** 附件校验提示可见
- **WHEN** 用户移除一个已排队附件
- **THEN** Agent Web SHALL 移除该附件并清除提示

### Requirement: 附件队列清理 SHALL 跟随 request 与路由结果

一次成功的普通提交 SHALL 清空附件队列及其提示。失败的普通提交或被阻止/失败的 edit-resubmit SHALL 保留相关消息或已编辑文本以及队列。取消编辑模式 SHALL 保留当前队列供普通 Composer 使用。当活动路由 session 变化时，Agent Web SHALL 清空属于另一个 session 的队列。

#### Scenario: 成功提交清空附件
- **WHEN** 一次普通提交被成功接受
- **THEN** Agent Web SHALL 清空附件队列和提示

#### Scenario: 失败提交保留附件
- **WHEN** 普通提交或 edit-resubmit 在接受之前失败
- **THEN** Agent Web SHALL 保留相关文本和已排队附件

#### Scenario: Session 切换移除外来队列
- **GIVEN** 已排队附件绑定到某一个 session
- **WHEN** 活动路由变更为另一个 session
- **THEN** Agent Web SHALL 清空该外来 session 的附件队列
