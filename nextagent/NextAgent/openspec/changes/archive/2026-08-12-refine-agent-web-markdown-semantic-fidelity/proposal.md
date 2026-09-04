## Why

查看会话内容的用户当前会遇到三类可稳定复现的正文失真：点分标识符 `A.1.a` 被错误拆成两个块，任务列表把 checkbox 标签显示成普通字符串，GFM 表格声明的列对齐丢失。初步修复后，窄视口表格虽已出现内部滚动，但最小内容宽度仍不足，长行仍会被压缩；Mermaid 图也会整体缩小到标签难以辨认。同时，不同 Markdown 子类型若分别设置固定宽度，会形成不一致的内容右边界。这些问题会改变模型消息的原意或降低电信运维数据的可读性，因此需要在同一消息展示边界内修复。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 已完成普通 assistant 正文中的点分标识符保持在所属文本或列表项内。
- GFM 任务列表显示为不可交互的选中或未选中状态，不暴露标签字符串，也不扩大不可信 HTML 的可执行能力。
- GFM 表格按分隔行保留列对齐，并在窄视口下保持列结构和正文可访问性。
- 消息正文保持统一的标题、段落和块间距节奏；消息滚动 viewport 覆盖完整 main，浮动置底入口在正文列水平居中且不扩大全宽遮罩，布局只按包含 Skill 选择器和 composer 的 footer surface 真实高度为滚动内容预留安全区并遮住其下方历史文字。
- 窄视口表格与 Mermaid 分别在自身容器内横向滚动，并保留至少 `560px` 的可读内容宽度。
- 不为模型返回内容新增 `820px` 或其他内容类型级固定最大宽度；所有内容继续使用现有共享消息列的响应式可用宽度。
- Composer 可见外边界直接使用共享 footer 内容列的可用宽度，不再形成第二层水平缩进。

**非目标：**

- 不改变模型输出、stream event、会话历史或 request lifecycle 契约。
- 不承诺完整 CommonMark/GFM 语法兼容，不新增任意 HTML 输入能力。
- 不替换现有 Markdown 渲染组件，不引入新依赖，也不修改未完成 live tail 行为。
- 不以缩小正文字号或全局压缩列表、引用缩进作为窄视口修复手段。
- 不新增数学公式语法或公式渲染能力。

## What Changes

- 新增会话消息正文展示 Function，将现有普通 assistant Markdown 规格作为唯一主规格，并补齐任务列表、点分标识符、表格列对齐和窄视口可读性行为。
- 修改“查看会话内容”Feature，使其同时包含消息读取与消息正文语义展示两个 Functions。
- 对不可信 HTML 继续 fail closed；仅由任务列表语法产生的不可交互 checkbox 可作为受控语义显示。
- 统一表格片段与后续正文块的间距；当内容宽度不足时，表格与 Mermaid 通过各自内部横向滚动保留 `560px` 可读结构；宽屏下所有模型返回内容继续使用现有共享消息列宽度，不新增 `820px` 固定上限。
- 消除 composer 在共享 footer 内容列内的第二层水平缩进，使其可见外边界与该内容列对齐。
- 恢复消息滚动 viewport 对完整 main 的覆盖；只测量 Skill 选择器和 composer 所在 footer surface 的高度并用于滚动内容底部安全区，不再缩短 viewport。footer surface 使用页面背景遮罩历史消息，浮动置底入口保持独立透明浮层，避免回看历史时出现约一个按钮高度的全宽遮挡。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-1.4 查看会话内容`：在既有会话消息读取能力之外，增加可依赖的消息正文语义展示和窄视口可读性保证；组成 Functions 增加 `FN-1.22 展示会话消息正文`。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-1.22 展示会话消息正文` → `specs/agent-web-assistant-markdown-rendering/spec.md`
  - 功能边界：系统把已完成普通 assistant 正文展示为安全、语义一致且在宽窄视口下可读的 Markdown 内容。
  - 系统质量属性：安全。

### 修改的 Function

无。

## 影响范围（Impact）

- 最终用户会看到完整的点分标识符、受控任务 checkbox 和正确对齐的表格列；窄视口下宽表与 Mermaid 改为各自内容区域内横向滚动，宽屏下各类模型返回内容继续使用同一响应式消息列宽度。
- local、immersive、collaborative 三种宿主复用的消息区域需要保持相同语义和响应式行为。
- 不影响后端 Web API、stream schema、持久化、模型调用、运行时配置或公共 package contract。
- 前端 Markdown 预处理、清洗、表格投影、消息滚动 viewport、footer overlay 样式及对应组件、浏览器测试会受到影响。
