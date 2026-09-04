## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.22 展示会话消息正文` | 补齐点分标识符、任务列表、表格对齐和窄视口可读性 | `agent-web-assistant-markdown-rendering` | `FN-1.22 展示会话消息正文` |

## `FN-1.22 展示会话消息正文`

### 目标与规范依据

本设计在既有 completed ordinary assistant Markdown 路径上完成最小增量，使消息内容保持原始语义、安全边界和宽窄视口可读性，不替换渲染组件或改变上游会话事实。

#### 本 Function 的目标 Requirements

canonical spec：`agent-web-assistant-markdown-rendering`

- `ADDED`：`点分标识符保持所属正文结构`
- `ADDED`：`任务列表以受控不可交互状态展示`
- `ADDED`：`GFM 表格保留列对齐语义`
- `ADDED`：`消息正文在宽窄视口保持可读`

### 当前实现

- `TurnBlockComponent -> MarkdownContent -> MarkdownWithTables` 是三种宿主共享的 completed ordinary assistant 正文路径。
- `normalizeMarkdownBlockSpacing` 使用通用句末标点与块起始标记正则补空行；ASCII `.` 分支会把 `A.1.a` 的第一个句点误识别为正文边界。
- `marked` 能把 GFM task list 解析为 checkbox `input`，但默认 `xss` allowlist 会把该标签转义为普通字符串。
- `MarkdownWithTables` 为异常 pipe table 提供确定性修复和分段渲染；当前 `TableSegment` 只保存 header/rows，解析时跳过 divider，因此丢失列对齐。
- 表格外层支持 `overflowX: auto`，但内部 `table` 固定为 `width: 100%`，同时通用正文样式对 `td/th` 使用 `overflow-wrap: anywhere`，导致窄视口优先压缩和逐字符换行。
- 表格自身拥有 `marginBottom: 16`，紧随的标题拥有 `marginTop: 16`，跨分段 wrapper 后形成约 `32px` 间隔。
- local 和 immersive 的 Sidebar 默认展开为 `250px`，没有窄视口自动收起；浮动置底入口位于 overlay footer 右侧，scroll viewport 只为 composer 高度留出空间。
- 第一轮修复后的 `360px` 实测中，表格容器为 `233px`、表格内容仅为 `259px`，长描述行高达约 `401px`；Mermaid SVG 被缩至约 `209px`，标签难以辨认。
- `1280px` 实测中普通 Markdown 正文片段宽度约 `951px`。用户明确否定新增 `820px max-width`；宽度继续由 `RightPaneLayout` 现有 `1080px` 响应式消息列及当前 viewport 决定，Markdown 子类型不再引入第二套固定宽度。
- `RightPaneLayout` 的 footer overlay 已负责共享列的水平 inset，`chat-composer-dock` 仍额外设置 `0 4px` padding，使输入区域左右各再次缩进 `4px`。
- 当前 `RightPaneLayout` 把完整 footer overlay 高度设置为 scroll viewport 的 `bottom`。实际会话中，main 底边为约 `685.6px`，普通 composer 状态下 viewport 底边停在约 `557.6px`；用户从底部回滚后浮动置底入口出现，overlay 高度由约 `127.6px` 增至 `183.6px`，viewport client height 同步由约 `510px` 降至 `454px`。这会在同一次回看操作中改变滚动容器高度和滚动条范围。
- footer overlay 与 `chat-composer-dock` 当前均为透明背景。若 viewport 恢复覆盖完整 main 而不增加遮罩，历史消息会透过 Skill 选择器、composer 与浮动入口之间的空隙显示。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 点分标识符保持所属正文结构 | ASCII 句点可触发数字列表边界修复 | 缺少点分标识符否定条件 |
| 任务列表安全显示 | parser 生成 `input`，sanitizer 将其转义 | 缺少不扩大 `input` allowlist 的受控任务状态投影 |
| 表格保留列对齐 | divider 只参与识别，不进入 `TableSegment` | 缺少 alignment 私有数据和 th/td 投影 |
| 窄视口保持表格列结构 | table 强制铺满且任意字符可断行 | 缺少内容最小宽度与内部滚动策略 |
| 窄视口保持 Mermaid 标签可读 | SVG 使用 `max-width: 100%` 整体缩小 | 缺少图形最小宽度与内部滚动策略 |
| 宽屏内容保持共享消息列边界 | 临时实现给 prose segment 增加 `820px max-width` | 子类型级固定上限与现有消息列 owner 重复，并形成不一致右边界 |
| 单一章节间隔 | 表格和标题各提供 `16px` 外边距 | 缺少跨分段首块间距归一化 |
| 浮动入口和 Skill 区域不显示历史文字 | 完整 overlay 高度直接缩短 viewport，且 overlay 背景透明 | viewport 高度会随浮动入口显隐改变；恢复完整 viewport 后还缺少滚动内容安全区和 footer 遮罩 |
| 窄视口正文保留有效宽度 | Sidebar 始终按用户初始状态展开 | 缺少窄视口首次进入或 resize 时的自动收起 |
| Composer 使用共享 footer 内容列宽度 | composer 可见外边界在 footer 已有 inset 内再次向两侧各缩进 `4px` | 存在重复水平缩进 |

### 修改方案

`frontend/agent-web` 继续作为唯一 owner，保持 `marked + xss + MarkdownWithTables` 路径和现有表格修复能力。唯一实施路径如下：

1. 在 Markdown 预处理正则的 ASCII `.` 分支增加否定条件：当句点后形如 `数字.字母或数字` 时不建立块边界。全角标点以及真实 `数字.空格` 有序列表保持原行为。
2. 为当前 Markdown renderer 定义受控 `checkbox` 输出，生成不可交互的 `span[role=checkbox]`、`aria-checked` 和 `aria-disabled`，而不是允许 `input`。`xss` 只增加这些不可执行的 span 属性；原始 `input`、事件属性和脚本继续被拒绝或转义。
3. 为 `TableSegment` 增加 `alignments: ('left' | 'center' | 'right' | null)[]`。对 divider cell 使用唯一映射：首尾冒号为 center，仅末尾冒号为 right，仅首部冒号为 left，无冒号为 null；alignment 纳入稳定 key，并在追加修复行时沿用。
4. `TableBlock` 把 alignment 同时投影到同列 th/td。表格使用 `width: max-content` 与 `min-width: max(100%, 560px)`，外层负责水平滚动；表头和 right/center 短列不逐字符换行，普通描述列保持正常换行。
5. 表格 wrapper 使用稳定 class，并拥有单一 `16px` 底部间距；紧随 Markdown wrapper 的首个块清除顶部外边距，避免表格与标题间距叠加。通用 `overflow-wrap: anywhere` 不再作用于 table cell。
6. Sidebar 在 `max-width: 720px` 的 viewport 首次挂载或进入该断点时切换为既有 collapsed 状态，继续复用现有展开按钮与 `48px` collapsed 布局，不创建抽屉或第二套导航。
7. overlay footer 在浮动入口可见时把入口放在正文列水平中心；`RightPaneLayout` 的 scroll viewport 使用 `inset: 0` 覆盖完整 main，不再用 footer 高度改变 viewport 底边。浮动入口保留为独立透明浮层；布局只测量包含 Skill 选择器和 composer 的 footer surface，并把该真实高度设置为滚动内容列的 bottom safe area，使入口显隐不改变 safe area、scrollHeight 或 viewport client height。footer surface 使用 `var(--color-chat-pane-bg)` 的不透明背景遮住其下方历史文字，并在右侧为实际 scrollbar gutter 留出透明通道，因此 Skill 选择器与 composer 之间不会透出正文，滚动条轨道仍覆盖完整 main。不改变点击、滚动、following 或 anchored 语义。
8. Mermaid 外层容器负责水平滚动，内部图形容器使用 `width: 100%` 与 `min-width: 560px`；SVG 不再使用 `max-width: 100%` 把图形压缩到窄容器，而是跟随内部图形容器宽度。
9. 移除普通 Markdown segment 的 `820px max-width`，不按正文、代码、表格或 Mermaid 新建内容类型级固定宽度。所有外层使用共享消息列的 `width: 100%`；只有表格与 Mermaid 的窄屏内部内容保留 `560px` 最小可读宽度和各自滚动容器。
10. 删除 `chat-composer-dock` 自身的 padding；footer overlay 继续作为水平 inset 的唯一布局 owner，不改变 composer 内部控件样式和 overlay 高度测量。

不修改后端、stream、history、request lifecycle、数学公式、live tail 或公共 package contract。表格 alignment、任务状态和本轮宽度约束都是 render-only 私有投影，不新增持久化状态。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `任务列表以受控不可交互状态展示` | 使用受控非 input checkbox 投影，只允许不可执行的 span accessibility attributes | 原始 input、事件属性和脚本不能形成可交互或可执行节点 |
| 可测试性 | 无新增黑盒质量目标 | 将正则边界、task list、table alignment、responsive inset 分别放入 focused test | 每个稳定复现场景先失败再实施，三宿主共享入口无分叉 |

## 验证策略（Verification Strategy）

- unit/component tests 覆盖点分标识符与真实有序列表边界、任务状态和 negative security inputs、table alignment 与异常表格追加、表格 `560px` 最小宽度、Markdown 子类型无额外固定最大宽度、Mermaid `560px` 最小宽度和内部滚动、Sidebar breakpoint、完整 main viewport、动态内容 bottom safe area、footer overlay 遮罩和 composer dock 无额外 padding。
- frontend TypeScript build 验证 renderer、sanitizer options、alignment 私有类型和 React styles。
- browser QA 使用同一 session 和相同 `1280px`、`600px`、`360px` viewport 对比修改前后；检查 `A.1.a`、任务列表、表格列对齐、表格后标题间隔、正文片段宽度、表格和 Mermaid 内部内容宽度、Sidebar 宽度、页面横向溢出、viewport/main 底边一致、浮动入口显隐不改变 viewport client height 或 scrollHeight、内容 bottom safe area 跟随 footer surface 高度，以及 Skill 选择器与 composer 之间不透出历史文字。
- 三宿主 artifact build 验证 shared `ChatWorkspace` 路径没有 host-specific 分叉。
- negative case 必须实际注入原始 input、事件属性或脚本载荷并断言不产生可交互/可执行节点。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-assistant-markdown-rendering/spec.md`：增加 Function 元数据和本 change 的四个 Requirements。
- `openspec/designs/functions/D1-会话与流式交互/D1.2-会话生命周期管理/FN-1.22-展示会话消息正文.md`：新增 Function 文档。
- `openspec/designs/features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.4-查看会话内容.md`：增加 `FN-1.22` 组成和消息正文展示摘要。
- `openspec/overview.md`：补充 Function 导航摘要。
- architecture：无。
- `openspec/designs/modules/agent-web.md`：刷新 assistant Markdown 渲染范围和验证关注点。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：将 stable spec 导航到新增 Function 和现有 module/test 入口。

## 风险与取舍（Risks / Trade-offs）

- 宽表在窄视口会出现内部横向滚动；这是保留列结构、数字和状态可读性的显式取舍。
- Mermaid 在窄视口会出现内部横向滚动；这是保留节点标签可读性的显式取舍。
- 所有模型返回内容继续使用共享消息列的响应式宽度；不新增 `820px` 阅读列，因此宽屏长行由既有 `RightPaneLayout maxWidth={1080}` 统一控制。
- 进入窄视口会自动收起 Sidebar；用户仍可使用既有按钮展开，但展开后可用正文宽度会减少。
- scroll viewport 始终覆盖完整 main；footer surface 区域中的消息节点仍存在于滚动内容后方，但由不透明页面背景遮住，footer surface 实际高度同时作为 bottom safe area，保证滚到底时最后内容可完全移动到 Skill/composer 上方。
- 浮动入口保持在正文列水平中心并独立于 footer surface；入口显隐不改变 bottom safe area、scrollHeight、viewport 高度或滚动条轨道长度。入口自身仍占用 `44px × 44px` 的局部浮层，但不形成全宽遮罩带。
- 任务状态使用受控 ARIA span 而非原生 input，避免扩大 sanitizer 的 input surface；交互能力明确不在本 change 范围内。

## 待确认问题（Open Questions）

无。
