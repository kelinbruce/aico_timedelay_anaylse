# question-association-ui Specification

## Purpose
This specification defines the question association autocomplete panel UI in the message input composer.
## Requirements
### Requirement: 联想面板数据获取

联想面板 SHALL 通过 `GET /api/v1/question-association?keyword={trimmed_input}&locale={site.locale}` 获取联想结果。前端 MUST 对输入做 debounce（300ms）后再发送请求。请求时 MUST 携带 loading 状态。API 失败或返回空列表时，MUST 静默关闭联想面板，MUST NOT 向用户报错。

#### Scenario: debounce 后请求
- **WHEN** 用户连续打字
- **THEN** 前端 MUST 在停止打字 300ms 后才发送请求

#### Scenario: API 返回结果
- **WHEN** API 返回 `questions.length > 0`
- **THEN** 联想面板 MUST 渲染返回的问题列表

#### Scenario: API 返回空列表
- **WHEN** API 返回 `questions: []`
- **THEN** 联想面板 MUST 关闭

#### Scenario: API 请求失败
- **WHEN** API 请求失败或网络错误
- **THEN** 联想面板 MUST 关闭
- **AND** MUST NOT 向用户显示错误

### Requirement: 来源标签视觉展示

联想面板中每条结果 SHALL 展示来源分类标签，标签仅用于视觉提示，无交互语义。标签样式 SHALL 区分三种来源：
- `pinned`：表示用户已收藏的问题
- `high-frequency`：表示高频问题
- `static`：表示推荐问题

标签 MUST NOT 可点击，MUST NOT 触发任何操作。

#### Scenario: 展示来源标签
- **WHEN** 联想面板渲染结果
- **THEN** 每条结果 MUST 展示对应的来源标签
- **AND** 标签 MUST 不可点击

### Requirement: 联想面板键盘交互

联想面板 SHALL 支持以下键盘交互：
- `ArrowUp` / `ArrowDown`：在联想结果间导航，高亮当前项
- `Enter` / `Tab`：选中高亮项，填入 textarea，关闭联想面板
- `Escape`：关闭联想面板，保留当前输入

当联想面板打开时，`Enter` MUST 触发选中而非提交消息。

#### Scenario: 上下导航
- **WHEN** 联想面板打开且用户按 ArrowDown
- **THEN** 高亮 MUST 移动到下一项
- **AND** 面板 MUST 滚动到高亮项可见

#### Scenario: 选中填入
- **WHEN** 联想面板打开且用户按 Enter 或 Tab
- **THEN** 高亮项的 text MUST 填入 textarea
- **AND** 联想面板 MUST 关闭

#### Scenario: Escape 关闭
- **WHEN** 联想面板打开且用户按 Escape
- **THEN** 联想面板 MUST 关闭
- **AND** 当前输入 MUST 保留

### Requirement: 联想面板鼠标交互

联想面板 SHALL 支持鼠标点击选中：点击某条结果时，该结果的 text 填入 textarea，联想面板关闭。鼠标 hover 时高亮对应项。

#### Scenario: 点击选中
- **WHEN** 用户点击联想面板中的某条结果
- **THEN** 该结果的 text MUST 填入 textarea
- **AND** 联想面板 MUST 关闭

#### Scenario: 鼠标 hover 高亮
- **WHEN** 用户鼠标 hover 某条结果
- **THEN** 该项 MUST 高亮

### Requirement: 联想面板面板样式

联想面板 SHALL 浮于输入框上方（`position: absolute; bottom: 100%`），与斜杠命令面板使用相同的定位策略。面板 MUST 有最大高度限制和滚动支持。面板 MUST 使用与斜杠命令面板一致的视觉风格（背景、边框、圆角、阴影）。

#### Scenario: 面板定位
- **WHEN** 联想面板显示
- **THEN** 面板 MUST 浮于输入框上方
- **AND** MUST NOT 推开其他布局元素

