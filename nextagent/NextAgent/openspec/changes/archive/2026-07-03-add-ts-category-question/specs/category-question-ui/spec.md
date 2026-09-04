## ADDED Requirements

### Requirement: 分类问题 Chip 区域组件位置

前端 SHALL 在聊天输入框上方渲染分类问题 chip 区域。chip 区域的宽度 SHALL 与输入框宽度齐平。chip 区域 SHALL 作为输入框上方可切换组件容器的默认渲染内容。当当前 Agent Scope 下没有分类问题数据时，chip 区域 MUST NOT 渲染，且输入框上方 MUST NOT 保留空白间距。

#### Scenario: 有分类问题时渲染 chip 区域
- **WHEN** `GET /api/v1/category-questions` 返回 `categories.length > 0`
- **THEN** 前端 MUST 在输入框上方渲染分类问题 chip 区域
- **AND** chip 区域宽度 MUST 与输入框宽度一致

#### Scenario: 无分类问题时不渲染
- **WHEN** `GET /api/v1/category-questions` 返回 `categories.length === 0` 或请求失败
- **THEN** 前端 MUST NOT 渲染分类问题 chip 区域
- **AND** 输入框上方 MUST NOT 出现额外空白间距

### Requirement: 分类问题 Chip 渲染复用 Skill Chip 逻辑

分类问题 chip SHALL 复用 Skill 选择栏 chip 的完全相同的渲染逻辑，包括：图标选择（按 index 取模 4 选择 `index1.png` 到 `index4.png`）、chip 样式（`border-radius: 16px`、`height: 32px`、`padding: 7px 12px`、统一中性色 border/background/text）、选中态样式（`--color-bg-active` 背景、`--color-primary` 边框和文字色）、chip 最大宽度 400px 且 `flexShrink: 0`。"全部"按钮 SHALL 使用 `all.png` 图标，样式与未选中 chip 一致，跟随 chip 流式排列。当分类数量超过一行可展示时 SHALL 在行末渲染"全部"按钮，否则 MUST NOT 渲染。

#### Scenario: chip 图标选择
- **WHEN** 渲染分类问题 chip 区域
- **THEN** 每个 chip MUST 包含一个 `img` 元素显示对应图标
- **AND** 图标按 chip index 取模 4 选择

#### Scenario: chip 样式与 Skill chip 一致
- **WHEN** 渲染分类问题 chip
- **THEN** chip MUST 使用 `border-radius: 16px`、`height: 32px`、`padding: 7px 12px`
- **AND** 未选中 chip MUST 使用 `--color-composer-border`、`--color-composer-bg`、`--color-text-secondary`
- **AND** 选中 chip MUST 使用 `--color-bg-active`、`--color-primary`

#### Scenario: 全部按钮跟随流式排列
- **WHEN** 分类数量超过一行可展示
- **THEN** "全部"按钮 MUST 与最后一个可见 chip 保持相同 gap 排列
- **AND** MUST NOT 固定在容器右侧

### Requirement: 点击 Chip 后弹出 Modal

用户点击一级分类 chip 后 SHALL 在输入框上方 4px 位置弹出 modal。modal 宽度 SHALL 与输入框等长。modal SHALL 设置 `padding: 16px`、`border-radius: 16px`、`max-height: 516px`。chip 区域在 modal 打开时 SHALL 被覆盖或消失。modal 标题 SHALL 为"分类问题推荐"。

#### Scenario: 点击 chip 弹出 modal
- **WHEN** 用户点击某个一级分类 chip
- **THEN** 前端 MUST 在输入框上方 4px 弹出 modal
- **AND** modal 宽度 MUST 与输入框等长
- **AND** modal MUST 设置 `padding: 16px`、`border-radius: 16px`、`max-height: 516px`
- **AND** modal 标题 MUST 为"分类问题推荐"

#### Scenario: chip 区域被覆盖
- **WHEN** modal 打开
- **THEN** chip 区域 MUST 被覆盖或消失
- **AND** MUST NOT 同时显示 chip 区域和 modal

### Requirement: Modal Tab 结构与滚动

Modal 标题下方 SHALL 包含 tab 组件。第一个 tab 的 title SHALL 为"全部"，其后为各一级分类的 `name` 作为 tab title。tab 数量较多时 SHALL 支持鼠标滚轮横向滚动。tab content 区域 SHALL 支持 vertical scroll，受 modal `max-height: 516px` 约束。"全部" tab 的 content SHALL 展示所有分类的问题混合在一起，每个问题块仍展示其所属的二级分类名（如有）。

#### Scenario: 全部 tab 为第一个
- **WHEN** modal 打开
- **THEN** 第一个 tab 的 title MUST 为"全部"
- **AND** 其后各 tab 的 title MUST 为各一级分类的 `name`

#### Scenario: tab 横向滚动
- **WHEN** 一级分类数量较多导致 tab 超出 modal 宽度
- **THEN** tab 区域 MUST 支持鼠标滚轮横向滚动
- **AND** MUST NOT 出现水平滚动条

#### Scenario: 全部 tab 展示所有问题
- **WHEN** 用户点击"全部" tab
- **THEN** content 区域 MUST 展示所有分类的所有问题
- **AND** 每个问题块 MUST 展示其所属二级分类名（如有）

#### Scenario: content 区域垂直滚动
- **WHEN** 某个 tab 的问题数量超过 modal max-height 可展示范围
- **THEN** content 区域 MUST 支持 vertical scroll

### Requirement: 问题块展示与交互

每个问题块 SHALL 设置 `height: 64px`、`border-radius: 12px`。问题块左侧 SHALL 显示统一的 `collecting-files.svg` 图标，不区分分类、不区分深色/浅色模式。问题块右侧上方 SHALL 显示二级分类名（当问题属于二级分类时），下方 SHALL 显示问题文本。当问题属于无二级分类的一级分类时，右侧 SHALL 只显示问题文本，MUST NOT 显示二级分类名。用户点击问题块后 SHALL 将问题文本直接写入输入框，等价于用户在输入框输入该文本。写入后 modal SHALL 关闭。

#### Scenario: 有二级分类的问题块
- **WHEN** 问题属于某个二级分类
- **THEN** 问题块右侧上方 MUST 显示二级分类名
- **AND** 右侧下方 MUST 显示问题文本
- **AND** 块高度 MUST 为 64px，border-radius MUST 为 12px

#### Scenario: 无二级分类的问题块
- **WHEN** 问题属于无二级分类的一级分类
- **THEN** 问题块右侧 MUST 只显示问题文本
- **AND** MUST NOT 显示二级分类名

#### Scenario: 点击问题块写入输入框
- **WHEN** 用户点击某个问题块
- **THEN** 问题文本 MUST 被写入输入框
- **AND** 行为 MUST 等价于用户在输入框输入该文本
- **AND** modal MUST 关闭

### Requirement: 问题块响应式列数

问题块布局 SHALL 根据前端模式和输入框宽度决定每行展示的列数。在 immersive 和 local 模式下 SHALL 每行展示 2 列，列间距 8px。在 collaborative 模式下，当输入框宽度 < 1080px 时 SHALL 每行展示 1 列；当输入框宽度 >= 1080px 时 SHALL 每行展示 2 列，列间距 8px。

#### Scenario: immersive 模式 2 列
- **WHEN** 前端处于 immersive 模式
- **THEN** 问题块 MUST 每行展示 2 列
- **AND** 列间距 MUST 为 8px

#### Scenario: local 模式 2 列
- **WHEN** 前端处于 local 模式
- **THEN** 问题块 MUST 每行展示 2 列
- **AND** 列间距 MUST 为 8px

#### Scenario: collaborative 模式窄宽度 1 列
- **WHEN** 前端处于 collaborative 模式且输入框宽度 < 1080px
- **THEN** 问题块 MUST 每行展示 1 列

#### Scenario: collaborative 模式宽宽度 2 列
- **WHEN** 前端处于 collaborative 模式且输入框宽度 >= 1080px
- **THEN** 问题块 MUST 每行展示 2 列
- **AND** 列间距 MUST 为 8px

### Requirement: 分类问题 chip 选中态写入输入框

用户点击一级分类 chip 后 SHALL 在输入框内显示选中分类名称，样式与 Skill 选中态完全一致（`background: var(--bg-input-context)`、`color: var(--color-chat-answer)`、`border-radius: 4px`、`height: 28px`），包含图标和分类名称。用户再次点击已选中的 chip 或点击 chip 的关闭按钮 SHALL 清除输入框中的选中分类。

#### Scenario: 点击 chip 显示选中态
- **WHEN** 用户点击一个未选中的分类 chip
- **THEN** 输入框内 MUST 显示选中分类名称
- **AND** 选中态样式 MUST 与 Skill 选中态完全一致

#### Scenario: 再次点击清除选中
- **WHEN** 用户点击已选中的分类 chip
- **THEN** 输入框内的选中分类 MUST 被清除
