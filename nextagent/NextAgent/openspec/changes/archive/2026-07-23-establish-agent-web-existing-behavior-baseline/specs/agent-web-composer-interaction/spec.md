## ADDED Requirements

### Requirement: Composer SHALL 保留提交、换行和 IME 语义

Agent Web Composer MUST 只提交非空文本。当没有更高优先级的 Composer overlay 正在处理该按键时，不带 `Shift` 的 `Enter` SHALL 提交当前文本，`Shift+Enter` SHALL 保留浏览器换行行为，而 IME 组合输入期间的 `Enter` SHALL NOT 提交。

#### Scenario: Enter 提交非空文本
- **GIVEN** Composer 包含非空文本且没有命令或关联面板正在处理该按键
- **WHEN** 用户在 IME 组合之外按下不带 `Shift` 的 `Enter`
- **THEN** Agent Web SHALL 提交当前文本

#### Scenario: Shift Enter 插入换行
- **WHEN** 用户在 Composer 中按下 `Shift+Enter`
- **THEN** Agent Web SHALL NOT 提交
- **AND** textarea SHALL 保留其原生换行行为

#### Scenario: IME 的 Enter 不提交
- **WHEN** 用户在 IME 组合处于活动状态时按下 `Enter`
- **THEN** Agent Web SHALL NOT 提交 Composer 文本

### Requirement: Composer 键盘处理 SHALL 遵循可见上下文优先级

Composer MUST 给打开的 slash 命令面板高于打开的问题关联面板的优先级，并 MUST 给任一面板高于历史导航和普通提交的优先级。活动面板 SHALL 消费其支持的 `ArrowUp`、`ArrowDown`、`Enter`、`Tab` 和 `Escape` 操作。用 `Enter` 或 `Tab` 选择一个启用的命令或关联问题 SHALL 更新 Composer 文本并关闭面板。选择一个 Skill SHALL 更新独立的 Skill 选择状态并关闭其 picker，而不是把 Skill 名称作为问题文本插入。这些选择动作 SHALL NOT 触发提交，直到稍后显式的提交动作。

#### Scenario: 打开的命令面板消费 Enter
- **GIVEN** slash 命令面板打开且选中了一个启用项
- **WHEN** 用户按下 `Enter`
- **THEN** Agent Web SHALL 把该项填入 Composer 并关闭面板
- **AND** Agent Web SHALL NOT 因该按键提交 request

#### Scenario: 打开的关联面板消费导航键
- **GIVEN** 问题关联面板处于打开状态
- **WHEN** 用户按下 `ArrowUp`、`ArrowDown`、`Enter`、`Tab` 或 `Escape`
- **THEN** 该面板 SHALL 在 Composer 历史或提交处理之前处理该操作

### Requirement: 普通 Composer 模式 SHALL 提供浏览器会话内的 request 历史回溯

在普通模式下，不带 Alt、Ctrl 或 Meta 且 textarea 选区折叠时，`ArrowUp` 或 `ArrowDown` SHALL 导航 Composer request 历史。Shift 不排除当前历史路径。第一次 `ArrowUp` SHALL 只在当前 Composer 为空时进入历史，导航 SHALL 从最新到较旧条目进行，用 `ArrowDown` 越过最新条目 SHALL 恢复历史导航之前存在的草稿。编辑回溯文本 SHALL 退出历史导航模式。Edit-resubmit 模式 SHALL NOT 启用此历史导航。

#### Scenario: Arrow Up 回溯最新 request
- **GIVEN** 普通 Composer 模式、空输入、折叠选区和非空 request 历史
- **WHEN** 用户按下不带 Alt、Ctrl 或 Meta 的 `ArrowUp`
- **THEN** Agent Web SHALL 把最新的历史条目放入 Composer

#### Scenario: Arrow Down 恢复导航前草稿
- **GIVEN** 用户已带着已保存的导航前草稿进入历史导航
- **WHEN** 用户用 `ArrowDown` 导航越过最新条目
- **THEN** Agent Web SHALL 恢复该已保存的草稿

#### Scenario: 编辑模式不回溯普通历史
- **GIVEN** Composer 处于 edit-resubmit 模式
- **WHEN** 用户按下 `ArrowUp` 或 `ArrowDown`
- **THEN** Agent Web SHALL NOT 用 Composer request 历史替换已编辑的文本

### Requirement: Escape SHALL 先关闭临时 UI 再停止执行中的 request

`Escape` MUST 先被提供给可见的 dialog、drawer、popover、dropdown、select、命令面板和关联面板。在非执行状态的编辑模式下，`Escape` SHALL 取消编辑模式。当 request 正在执行且没有可关闭界面消费该按键时，第一次 `Escape` SHALL 预备一个短暂的停止确认并显示其提示；在当前确认窗口内第二次按下 `Escape` SHALL 请求停止。即使 textarea 本身没有焦点，只要焦点仍在 Agent Web 内，同样的两步停止行为 SHALL 生效。

#### Scenario: 关闭 overlay 不会预备 request 停止
- **GIVEN** 一个 request 正在执行且一个可关闭的 Composer overlay 可见
- **WHEN** 用户按下 `Escape`
- **THEN** Agent Web SHALL 关闭该 overlay
- **AND** SHALL NOT 因该按键预备或调用 request 停止

#### Scenario: 两次 Escape 停止当前 request
- **GIVEN** 一个 request 正在执行且没有可关闭界面消费 `Escape`
- **WHEN** 用户按下 `Escape` 并在确认窗口内再次按下
- **THEN** 第一次按键 SHALL 显示停止确认提示
- **AND** 第二次按键 SHALL 对执行中的 request 调用停止

#### Scenario: 非执行状态下 Escape 退出编辑模式
- **GIVEN** Composer 处于 edit-resubmit 模式且没有 request 在执行
- **WHEN** 用户按下 `Escape`
- **THEN** Agent Web SHALL 把该动作路由到编辑取消
- **AND** 产生的草稿恢复 SHALL 遵循 `request-edit-resubmit` 契约

### Requirement: Composer SHALL 只暴露已实现的 slash 命令目录

内建命令目录 MUST 包含 `/help`、`/retry` 和 `/edit`。`/help` 的目录条目 SHALL 独立于 Write 权限保持启用，而 Slash 命令执行仍经过当前可写的 Composer 提交守卫。`/retry` 和 `/edit` SHALL 只在用户拥有 Write 权限、存在最新目标且会话不在执行时启用。第一个以空白分隔的 token SHALL 决定精确命令，因此尾部文本 SHALL NOT 把已识别的命令变成普通消息。当一个精确命令到达可写提交处理器时，执行被禁用的命令或未知的 slash 前缀 token SHALL 清空该命令文本、显示安全警告，并 SHALL NOT 把它作为 user 消息提交。

#### Scenario: 带尾部文本的 help 命令打开帮助
- **GIVEN** Composer 可写
- **WHEN** 用户提交 `/help explain alarms`
- **THEN** Agent Web SHALL 打开命令帮助
- **AND** SHALL NOT 把该文本作为 user 消息发送

#### Scenario: 未知的 slash 文本不被发送
- **WHEN** 用户提交一个未知的 slash 前缀 token
- **THEN** Agent Web SHALL 清空该命令文本并显示警告
- **AND** SHALL NOT 提交 request

#### Scenario: Retry 和 edit 反映当前资格
- **GIVEN** 拥有 Write 权限、存在最新目标且没有执行中的 request
- **WHEN** 命令目录被展示
- **THEN** `/retry` 和 `/edit` SHALL 被启用
- **AND** 若任一前提缺失，受影响的命令 SHALL 带原因被禁用

### Requirement: 快捷键帮助 SHALL 与已实现的公开快捷键一致

Agent Web SHALL 为聚焦 Composer、打开帮助、导航相邻 session、提交、输入换行、取消编辑或确认停止以及导航 session 列表暴露快捷键帮助。`Mod+K` SHALL 在 chat root 上聚焦 Composer，或先导航到 root 再聚焦。`Mod+/` SHALL 打开快捷键帮助。在可编辑目标之外，`Mod+[` 和 `Mod+]` SHALL 分别导航到上一个和下一个相邻 session。Session 列表的 `ArrowUp`、`ArrowDown` 和 `Enter` SHALL 导航并激活选中的 session。

#### Scenario: Mod K 聚焦 Composer
- **WHEN** 用户按下 `Mod+K`
- **THEN** Agent Web SHALL 聚焦 Composer
- **AND** 必要时 SHALL 先导航到 chat root

#### Scenario: 相邻 session 快捷键避开可编辑目标
- **GIVEN** 焦点不在可编辑目标内
- **WHEN** 用户按下 `Mod+[` 或 `Mod+]`
- **THEN** Agent Web SHALL 分别导航到上一个或下一个相邻 session
