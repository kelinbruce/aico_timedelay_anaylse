## ADDED Requirements

### Requirement: Skill 选择栏组件位置

前端 SHALL 在聊天输入框上方 16px 处渲染 Skill 选择栏组件。Skill 栏的宽度 SHALL 与输入框宽度齐平。Skill 栏 SHALL 作为未来输入框上方可扩展自定义组件区的第一个 slot，允许后续变更在该区域添加更多组件。当当前 Agent Scope 下没有可用 Skill 时，Skill 栏 MUST NOT 渲染，且输入框上方 MUST NOT 保留空白间距。

#### Scenario: 有可用 Skill 时渲染选择栏
- **WHEN** `GET /api/v1/skills` 返回 `total > 0`
- **THEN** 前端 MUST 在输入框上方 16px 处渲染 Skill 选择栏
- **AND** Skill 栏宽度 MUST 与输入框宽度一致

#### Scenario: 无可用 Skill 时不渲染选择栏
- **WHEN** `GET /api/v1/skills` 返回 `total=0` 或请求失败
- **THEN** 前端 MUST NOT 渲染 Skill 选择栏
- **AND** 输入框上方 MUST NOT 出现额外空白间距

### Requirement: Skill 栏 Chip 展示行为

Skill 栏 SHALL 将可用 Skill 以圆角方块（chip）形式展示，每个 chip 显示 Skill 的 `displayName`，单行水平排列。鼠标悬浮在 chip 上时 SHALL 以 tooltip 形式展示该 Skill 的 `description`。Skill 栏 MUST 在输入框宽度内尽可能多地渲染 chip，MUST NOT 换行或出现水平滚动条。当可用 Skill 数量超过一行可展示的 chip 数量时，Skill 栏 SHALL 在行末渲染一个"全部"按钮。当所有 Skill 都能在一行内展示时，MUST NOT 渲染"全部"按钮。

chip 的未选中态 SHALL 使用统一中性色（border 使用 `--color-composer-border`，background 使用 `--color-composer-bg`，text 使用 `--color-text-secondary`），MUST NOT 按 chip 索引分配不同色彩。chip 的选中态 SHALL 统一使用 `--color-bg-active` 背景、`--color-primary` 边框和文字色。chip 的最大宽度 SHALL 限制为 400px，超出时隐藏溢出内容。chip wrapper MUST 设置 `flexShrink: 0` 以防止 flex 容器压缩 chip 宽度导致测量失真。

"全部"按钮 SHALL 跟随 chip 流式排列（与 chip 使用相同 gap），MUST NOT 使用 `marginLeft: auto` 固定在右侧。"全部"按钮的视觉样式 SHALL 与未选中 chip 保持一致。

#### Scenario: Skill 数量少时全部展示
- **WHEN** 可用 Skill 数量小于等于一行可展示的数量
- **THEN** Skill 栏 MUST 在单行内展示所有 Skill chip
- **AND** 行末 MUST NOT 出现"全部"按钮

#### Scenario: Skill 数量多时显示全部按钮
- **WHEN** 可用 Skill 数量超过一行可展示的数量
- **THEN** Skill 栏 MUST 在单行内展示尽可能多的 Skill chip
- **AND** 行末 MUST 渲染"全部"按钮
- **AND** 未展示的 Skill MUST NOT 出现在 Skill 栏中

#### Scenario: chip 使用统一中性色
- **WHEN** Skill 栏渲染多个 chip
- **THEN** 所有未选中 chip MUST 使用相同的中性 border、background 和 text 色
- **AND** MUST NOT 出现按索引变化的色彩差异

#### Scenario: 选中 chip 使用统一选中色
- **WHEN** 用户选中一个 Skill chip
- **THEN** 选中 chip MUST 使用 `--color-bg-active` 背景和 `--color-primary` 边框/文字色
- **AND** 其他未选中 chip MUST 保持中性色

#### Scenario: chip 超长名称被截断
- **WHEN** 某个 Skill 的 `displayName` 超过 chip 最大宽度
- **THEN** chip MUST 隐藏溢出内容
- **AND** MUST NOT 换行或撑开容器

#### Scenario: 全部按钮跟随 chip 流式排列
- **WHEN** Skill 栏需要显示"全部"按钮
- **THEN** "全部"按钮 MUST 与最后一个可见 chip 保持相同 gap 排列
- **AND** MUST NOT 固定在容器右侧

#### Scenario: 悬浮显示 Skill 描述
- **WHEN** 用户将鼠标悬浮在某个 Skill chip 上
- **THEN** 前端 MUST 显示包含该 Skill `description` 的 tooltip
- **AND** tooltip MUST NOT遮挡输入框或其他交互元素

### Requirement: 全部 Skill 列表 Modal

点击"全部"按钮 SHALL 打开一个 Skill 列表 Modal 对话框。Modal 的宽度 SHALL 为 328px。Modal 的定位 SHALL 使其右下角与"全部"按钮的右上角右侧对齐。Modal 标题 SHALL 为"全部skill"。Modal SHALL 在标题下方包含一个搜索输入框，搜索输入框下方为可滚动的 Skill 列表。Skill 列表中每一行 SHALL 显示一个 Skill 的 `displayName`。Modal 高度 SHALL 随 Skill 数量增长，MUST 有最小高度和最大高度限制；当 Skill 超过最大高度时，列表区域 MUST 支持垂直滚动。Modal MUST NOT 渲染"全部"按钮。

Modal 标题字号 SHALL 为 14px，标题底部与搜索框间距 SHALL 为 12px。Modal 打开时 SHALL 自动聚焦搜索输入框。Modal 列表项 MUST NOT 显示左侧色条，未选中项背景为透明，选中项 SHALL 统一使用 `--color-bg-active` 背景和 `--color-primary` 文字色。

#### Scenario: 点击全部打开 Modal
- **WHEN** 用户点击 Skill 栏中的"全部"按钮
- **THEN** 前端 MUST 打开 Skill 列表 Modal
- **AND** Modal 宽度 MUST 为 328px
- **AND** Modal 右下角 MUST 与"全部"按钮右上角右侧对齐
- **AND** Modal 标题 MUST 为"全部skill"

#### Scenario: Modal 打开时自动聚焦搜索框
- **WHEN** 用户点击"全部"按钮打开 Modal
- **THEN** 搜索输入框 MUST 自动获得焦点

#### Scenario: Modal 高度在最小和最大之间
- **WHEN** Modal 打开且 Skill 数量较少
- **THEN** Modal 高度 MUST 不低于最小高度
- **AND** Modal 高度 MUST 随 Skill 数量适当增长

#### Scenario: Modal 列表超出最大高度时滚动
- **WHEN** Skill 数量导致列表区域超过最大高度
- **THEN** 列表区域 MUST 出现垂直滚动条
- **AND** Modal 整体高度 MUST NOT 超过最大高度

#### Scenario: 关闭 Modal
- **WHEN** 用户点击 Modal 外部区域或按 Escape 键
- **THEN** Modal MUST 关闭
- **AND** 关闭 Modal MUST NOT 清除已选中的 Skill

### Requirement: Modal 搜索与分页加载

Modal 搜索输入框 SHALL 执行服务端关键字搜索，通过调用 `GET /api/v1/skills?keyword=xxx&pageNum=1&pageSize=50` 实现。搜索输入 MUST 应用防抖机制，MUST NOT 在每次按键时都发起 API 请求。Skill 列表 SHALL 以每页 50 条的方式分页加载。当用户滚动到列表底部时，前端 MUST 请求下一页并将结果追加到现有列表。当搜索关键字变化时，前端 MUST 重置到第 1 页并清空之前的列表结果。分页加载和搜索 MUST NOT 在列表中产生重复的 Skill。

#### Scenario: 搜索输入防抖
- **WHEN** 用户在搜索框中连续输入文字
- **THEN** 前端 MUST 在用户停止输入一段时间（防抖延迟）后才发起 API 请求
- **AND** 前端 MUST NOT 对每次按键都发起 API 请求

#### Scenario: 无限滚动加载下一页
- **WHEN** 用户滚动到 Skill 列表底部
- **AND** 当前已加载的 Skill 数量小于 `total`
- **THEN** 前端 MUST 请求下一页（`pageNum` 递增）
- **AND** 新加载的 Skill MUST 追加到现有列表末尾
- **AND** 列表中 MUST NOT 出现重复的 Skill

#### Scenario: 搜索关键字变化重置列表
- **WHEN** 用户修改搜索框中的关键字
- **THEN** 前端 MUST 清空当前列表
- **AND** 前端 MUST 从第 1 页开始重新查询
- **AND** `pageNum` MUST 重置为 1

#### Scenario: 所有 Skill 已加载
- **WHEN** 已加载的 Skill 数量等于 `total`
- **THEN** 前端 MUST NOT 发起额外的分页请求
- **AND** 滚动到底部时 MUST NOT 触发加载

### Requirement: Modal 键盘导航

Modal 打开且搜索输入框聚焦时，用户 SHALL 可以通过键盘上下键在 Skill 列表项之间导航，通过回车键确认选择。按下 `ArrowDown` SHALL 将键盘焦点移到下一个列表项（循环到第一项）；按下 `ArrowUp` SHALL 将键盘焦点移到上一个列表项（循环到最后一项）。键盘焦点项 SHALL 自动滚动到列表可视区域。按下 `Enter` SHALL 选中当前键盘焦点项的 Skill 并关闭 Modal。键盘导航 MUST NOT 干扰搜索输入框的文字输入；`ArrowUp`/`ArrowDown`/`Enter` 在搜索输入框聚焦时也 MUST 生效。当列表为空时，`ArrowUp`/`ArrowDown`/`Enter` MUST NOT 产生任何效果。

键盘焦点项的背景 SHALL 使用 `--color-bg-hover`，与选中项的 `--color-bg-active` 区分。当键盘焦点项同时也是选中项时，选中态优先。

#### Scenario: ArrowDown 移动到下一项
- **WHEN** Modal 打开且列表有内容，用户按下 `ArrowDown`
- **THEN** 键盘焦点 MUST 移到当前焦点项的下一项
- **AND** 若当前已是最后一项，焦点 MUST 循环到第一项

#### Scenario: ArrowUp 移动到上一项
- **WHEN** Modal 打开且列表有内容，用户按下 `ArrowUp`
- **THEN** 键盘焦点 MUST 移到当前焦点项的上一项
- **AND** 若当前已是第一项，焦点 MUST 循环到最后一项

#### Scenario: Enter 确认选择
- **WHEN** 键盘焦点在某个列表项上，用户按下 `Enter`
- **THEN** 该 Skill MUST 被选中
- **AND** Modal MUST 关闭

#### Scenario: 键盘焦点项自动滚动到可视区域
- **WHEN** 键盘焦点移动到当前可视区域之外的列表项
- **THEN** 列表 MUST 自动滚动使焦点项可见

#### Scenario: 空列表时键盘导航无效
- **WHEN** 列表为空，用户按下 `ArrowUp`、`ArrowDown` 或 `Enter`
- **THEN** MUST NOT 产生任何效果

### Requirement: 选中 Skill 在输入框内展示

从 Skill 栏或 Modal 中选中一个 Skill 后，前端 SHALL 在输入框内以圆角 chip 形式展示选中 Skill 的 `displayName`，chip 位于输入文字前方。chip SHALL 包含一个"x"按钮用于取消选中。chip MUST NOT 遮挡输入框的文字输入功能、placeholder 或已有内容。同一时间最多只能选中一个 Skill；选中新 Skill SHALL 替换之前的选中。当没有 Skill 被选中时，输入框内 MUST NOT 渲染 chip。

#### Scenario: 选中 Skill 后显示 chip
- **WHEN** 用户从 Skill 栏或 Modal 中点击一个 Skill
- **THEN** 输入框内 MUST 渲染包含该 Skill `displayName` 的圆角 chip
- **AND** chip MUST 位于输入文字前方
- **AND** chip MUST 包含"x"按钮

#### Scenario: 选中新 Skill 替换旧 Skill
- **WHEN** 用户已选中一个 Skill，随后选中另一个 Skill
- **THEN** 输入框内的 chip MUST 更新为新选中 Skill 的 `displayName`
- **AND** 同一时间 MUST 只有 一个 chip

#### Scenario: 点击 x 按钮取消选中
- **WHEN** 用户点击输入框内 chip 的"x"按钮
- **THEN** 输入框内的 chip MUST 消失
- **AND** 输入框 MUST 恢复到无选中 Skill 的状态
- **AND** 输入框的文字输入功能 MUST 不受影响

### Requirement: Skill 选中状态与请求集成

选中的 Skill `capabilityId` SHALL 存储在前端组件 state 中。当用户提交请求且 state 中有选中 Skill 时，请求 body MUST 包含 `routingConstraints: { targetSkill: "<capabilityId>" }`。当 state 中无选中 Skill（值为 null）时，请求 body MUST NOT 包含 `routingConstraints.targetSkill`。点击 chip 的"x"按钮 SHALL 将 state 置为 null，后续请求 body MUST NOT 携带 `targetSkill`。前端 MUST NOT 发送不在当前 Skill 列表 API 返回结果中的 `targetSkill` 值。

#### Scenario: 选中 Skill 后提交请求
- **WHEN** 用户选中 Skill `alarm-diagnosis` 并提交请求
- **THEN** 请求 body MUST 包含 `routingConstraints: { targetSkill: "alarm-diagnosis" }`
- **AND** 请求 body 仍 MUST 包含 `inputText` 和 `idempotencyKey`

#### Scenario: 未选中 Skill 时提交请求
- **WHEN** 用户未选中任何 Skill（state 为 null）并提交请求
- **THEN** 请求 body MUST NOT 包含 `routingConstraints.targetSkill`
- **AND** 请求 body MUST 包含 `inputText` 和 `idempotencyKey`

#### Scenario: 取消选中后提交请求
- **WHEN** 用户先选中 Skill，点击"x"取消选中，然后提交请求
- **THEN** 请求 body MUST NOT 包含 `routingConstraints.targetSkill`
- **AND** state 中的选中 Skill 值 MUST 为 null

#### Scenario: 选中 Skill 提交后 state 保持
- **WHEN** 用户选中 Skill 并成功提交请求
- **THEN** 前端 state 中的选中 Skill MAY 保持不变
- **AND** 后续请求 MAY 继续携带相同的 `targetSkill`，直到用户主动取消
