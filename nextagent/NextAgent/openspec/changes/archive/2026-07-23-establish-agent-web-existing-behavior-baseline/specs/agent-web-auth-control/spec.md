## MODIFIED Requirements

### Requirement: useUserOps hook SHALL 提供带 local/remote 语义的 user ops

一个 `useUserOps()` hook SHALL 创建于 `frontend/agent-web/src/features/auth/useUserOps.ts`。它 SHALL 通过 `useContext(AppHostContext)` 读取当前宿主上下文并返回 `readonly string[] | null`。Local 模式 SHALL 返回 `null`（无限制）。Immersive 或 PIU 模式下，SHALL 按提供的值返回 ops 数组，缺失或 `undefined` 的 ops SHALL 返回 `[]`，显式 `ops: null` SHALL 返回 `null`，即当前受信任的 standalone 宿主全访问语义。不可用的 `AppHostContext` 也 SHALL 返回 `null`。该 hook SHALL NOT 发起 API 调用、变更状态或抛出异常。此行为意味着 `null` 不是 fail-closed，只有当提供它的 host/provider 边界受信任时才是安全的。

#### Scenario: useUserOps 在 local 模式下返回 null
- **GIVEN** `AppHostContext` 带有 `mode="local"`
- **WHEN** 调用 `useUserOps()`
- **THEN** 它 SHALL 返回 `null`

#### Scenario: useUserOps 在 remote 模式下返回 ops 数组
- **GIVEN** `AppHostContext` 带有 `mode="immersive"` 和 `site.user.ops=["AICOService.View", "AICOService.Write"]`
- **WHEN** 调用 `useUserOps()`
- **THEN** 它 SHALL 返回 `["AICOService.View", "AICOService.Write"]`

#### Scenario: useUserOps 在 remote ops 缺失时返回空数组
- **GIVEN** `AppHostContext` 带有 `mode="piu"` 和 `site={}`（无 user 对象）
- **WHEN** 调用 `useUserOps()`
- **THEN** 它 SHALL 返回 `[]`

#### Scenario: 显式 null 授予 standalone 宿主语义
- **GIVEN** `AppHostContext` 带有 `mode="immersive"` 或 `mode="piu"` 且 `site.user.ops=null`
- **WHEN** 调用 `useUserOps()`
- **THEN** 它 SHALL 返回 `null`
- **AND** 下游 AuthGate/AuthWrapper SHALL 把该值视为无限制

#### Scenario: useUserOps 在 AppHostContext 不可用时返回 null
- **GIVEN** `useUserOps()` 在 `AppProviders` 之外被调用
- **WHEN** 该 hook 执行
- **THEN** 它 SHALL 返回 `null`（回退到 local/standalone 语义）

### Requirement: ChatPage SHALL 通过 useUserOps hook 读取 userOps 并保持语义等价

`ChatPage.tsx` SHALL 使用 `useUserOps()`，而不是自行拥有第二个 host-ops 解析器。Local 模式和显式的 remote `ops:null` 返回 `null`；remote 模式带数组时返回该数组；remote 模式缺失或 `undefined` 的 ops 返回 `[]`。传给 `ShareSettingsModal` 的 `userOps` 值 SHALL 保留这些现有语义。

#### Scenario: ChatPage 的 userOps 在 local 模式下为 null
- **GIVEN** `AppHostContext` 带有 `mode="local"`
- **WHEN** `ChatPageCore` 渲染
- **THEN** `useUserOps()` SHALL 返回 `null`
- **AND** `ShareSettingsModal` SHALL 接收到 `userOps={null}`

#### Scenario: ChatPage 的 userOps 在 remote 模式下返回 ops
- **GIVEN** `AppHostContext` 带有 `mode="immersive"` 和 `site.user.ops=["AICOService.View", "AICOService.Write"]`
- **WHEN** `ChatPageCore` 渲染
- **THEN** `useUserOps()` SHALL 返回 `["AICOService.View", "AICOService.Write"]`
- **AND** `ShareSettingsModal` SHALL 接收到相同的 ops 数组

### Requirement: 用户缺少 AICOService.Write 时写操作入口 SHALL 被禁用

在当前已受门控的 `MessageInput`、Sidebar、turn-action 和 suggested-question 界面中，以下写操作 UI 元素 MUST 要求 `AICOServiceOperation.Write`。当远程用户缺少该操作时，可见控件 SHALL 带既有的权限说明被禁用，隐藏的纯写输入 SHALL 不渲染。本需求并不主张 Immersive RIGHT header/search 或 PIU header 已经采用同一门控。

1. `MessageInput` 中的 Composer 文本区和发送按钮 SHALL 被禁用。
2. 编辑确认和取消控件 SHALL 被禁用。
3. request 执行期间，替换发送控件的停止控件 SHALL 被禁用。
4. 附件按钮 SHALL 被禁用，隐藏的 file input SHALL 不渲染，文件拖放 SHALL 被忽略。
5. more-menu 的 reload 操作 SHALL 被禁用。
6. Slash 命令目录中的 `/retry` 和 `/edit` 条目 SHALL 带权限相关原因被禁用；`/help` 目录条目 SHALL 保持启用，而实际的 Slash 提交仍受被禁用的 Composer 提交路径约束。
7. Sidebar 的新建 session、session 重命名和 session 删除控件 SHALL 被禁用。
8. Turn 的重试、user 消息编辑、点赞、点踩、收藏、fork、分享和 pin-question 控件 SHALL 被禁用。
9. 点击即提交 request 的 suggested-question 项 SHALL 不可操作。

当用户拥有 View 但没有 Write 时，只读操作 SHALL 保持可用，包括 session 浏览和切换、历史和收藏浏览、消息与会话预览阅读、Run Graph 查看、推荐展示、复制、主题和语言切换、侧栏布局控件，以及通过全局帮助快捷键打开的快捷键帮助。本需求 SHALL NOT 主张 `/help` 可以通过被禁用的 Composer 提交。

#### Scenario: 无 Write 权限时 Composer 被禁用
- **GIVEN** 一个远程用户拥有 `AICOService.View` 但缺少 `AICOService.Write`
- **WHEN** `MessageInput` 以空闲状态渲染
- **THEN** Composer 文本区和发送控件 SHALL 存在但被禁用

#### Scenario: 无 Write 权限时 stop 替换 send 且被禁用
- **GIVEN** 一个远程用户缺少 `AICOService.Write` 且一个 request 正在执行
- **WHEN** `MessageInput` 渲染其主操作
- **THEN** 停止控件 SHALL 替换发送控件
- **AND** 停止控件 SHALL 被禁用

#### Scenario: 无 Write 权限时附件接入被禁用
- **GIVEN** 一个远程用户缺少 `AICOService.Write`
- **WHEN** `MessageInput` 渲染或收到文件拖放
- **THEN** 附件按钮 SHALL 被禁用
- **AND** 隐藏的 file input SHALL 不渲染
- **AND** 拖放的文件 SHALL 不进入附件队列

#### Scenario: 已实现的 slash 命令反映 Write 权限
- **GIVEN** 一个远程用户缺少 `AICOService.Write`
- **WHEN** slash 命令目录被展示
- **THEN** `/retry` 和 `/edit` SHALL 带权限相关原因被禁用
- **AND** `/help` 目录条目 SHALL 保持启用
- **AND** 该目录状态 SHALL NOT 意味着 `/help` 绕过被禁用的 Composer 提交守卫
- **AND** 本权限契约 SHALL 不要求任何 `/clear` 命令

#### Scenario: Session 和 turn 写操作被禁用
- **GIVEN** 一个远程用户缺少 `AICOService.Write`
- **WHEN** session 和 turn 操作被渲染
- **THEN** 新建 session、重命名、删除、重试、编辑、点赞、点踩、收藏、fork、分享、pin-question 以及触发提交的建议操作 SHALL 被禁用

#### Scenario: 拥有 Write 权限时当前已门控的写控件可用
- **GIVEN** 一个远程用户同时拥有 `AICOService.View` 和 `AICOService.Write`
- **WHEN** Agent Web 在其他条件合格的状态下渲染本需求列出的已门控控件
- **THEN** 这些控件 SHALL 不因权限门控而被禁用
- **AND** `/help`、`/retry` 和 `/edit` SHALL 反映其非权限的资格条件

#### Scenario: 未门控的宿主特有入口不在本保证范围内
- **WHEN** Immersive RIGHT header/search 或 PIU header 渲染其当前宿主特有的 session 操作
- **THEN** 本需求 SHALL NOT 主张那些入口实施了相同的 Write 门控
