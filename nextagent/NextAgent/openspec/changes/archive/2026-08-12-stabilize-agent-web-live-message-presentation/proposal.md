## Why

Agent Web 用户在模型流式输出期间可能遇到五类连续性问题：活动过程 Markdown 会把每个累计中间快照写入稳定缓存；浏览器会在后端逐帧投影之外再次逐字重放已经接收的正文；普通 live snapshot 会随历史长度重复扫描当前未启用的选择集合、同步未变化的 active root，并改变历史 Turn 的编辑/重试回调引用；待定过程正文转为最终答案时会先出现在右侧再横移到既有答案位置；用户正在回看较早消息时提交新消息会被强制拉回底部。前三者会随正文或历史增长放大重复渲染、瞬时内存和垃圾回收压力，后两者会破坏正文几何稳定性并抢占用户已经明确表达的历史阅读意图，因此需要在保持消息内容、顺序、终态和历史窗口语义不变的前提下修复。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 活动过程 Markdown 的累计中间快照不进入稳定缓存；同一内容转为 settled 时不为缓存强制重渲染，后续实际挂载时恢复稳定缓存能力。
- 最终答案正文只随已经合并的 Web stream 投影更新；前端不对已经接收的累计正文叠加独立逐字重放。
- 普通 live snapshot 不扫描关闭状态的报告/分享选择集合，不重复同步未变化的 active root，也不只因历史快照更新而改变编辑/重试回调引用。
- 待定过程正文与最终答案使用相同的公开正文排版；最终答案接管时直接使用既有答案位置，不发生横向位移、淡入淡出或重新打字。
- 用户在 recent 非跟随窗口或 anchored 历史窗口回看期间提交消息时，继续保持当前窗口、滚动位置和跟随策略。
- SSE、WebSocket、local、immersive 和 collaborative 宿主保持相同的消息内容、顺序、终态和交互结果。

**非目标：**

- 不修改 `StreamEnvelope`、Web API、backend lifecycle、canonical timeline、消息持久化或历史分页协议。
- 不合并或丢弃不同 invocation、attempt、sequence gap、结构化结果、Tool 生命周期或 terminal 事件。
- 不引入虚拟列表、新状态管理层、新配置项、第三方依赖或新的滚动状态机。
- 不改变置底按钮的显式返回最新能力、物理底部容差或既有平滑滚动时长。

## What Changes

- 复用 `MarkdownContent` 已有 cache policy：活动过程条目及其合并 explanation 使用 streaming policy，settled 内容在后续实际渲染时使用 stable policy，不因 policy 单独变化强制重渲染；不改变 Markdown 解析、清洗、DOM 或事件投影语义。
- 移除最终答案区域独立于 Web stream 的前端逐字重放，使每次可见正文更新只消费该帧已合并的累计投影；不改变 envelope 合并、顺序、terminal 或历史恢复语义。
- 收窄普通 live snapshot 的历史派生工作：只在报告/分享选择模式开启时计算候选集合，只在详情目标存在时查找目标，只在最新 root 变化时同步 active root；编辑/重试回调在调用时读取最新 Turn 快照，避免仅因快照替换而改变回调引用。
- 修改最终 Assistant 输出接管待定过程正文的可见行为：待定正文与最终答案使用相同公开正文排版，最终正文 MUST 直接使用既有答案左边界，不再通过横向位置动画完成对齐。
- 修复回看期间提交后的视口处理，使提交只在提交时和执行时仍允许跟随底部的窗口中请求置底；非跟随与 anchored 窗口保持当前阅读位置。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.1 查看会话消息流` → `specs/ts-web-sse-ws-transports/spec.md`
  - 功能边界：活动过程 Markdown 不保留瞬时累计快照；最终答案只随 Web stream 投影更新且不在浏览器内再次逐字重放；最终答案接管待定过程正文时直接稳定呈现于既有答案位置；回看期间提交继续保持当前阅读位置。
  - 系统质量属性：性能/容量、可靠性/恢复、可测试性。
  - 稳定约束：性能与 viewport 修复分别恢复 `e2e-ui-interaction` 已有的长会话响应性和回看位置要求，不新增该 capability 的黑盒行为。
  - 映射说明：`ts-web-sse-ws-transports` 是 canonical spec；本 change 不增加 legacy spec 映射。

## Feature 影响

### 修改的 Feature

- `F-1.1 实时查看处理过程`
  - 用户价值与质量保证：活动过程正文不再累计保留瞬时 Markdown 缓存；最终答案不再由前端计时器重复推进；处理过程转为最终答案时，正文直接稳定显示在既有答案位置；回看期间提交不再抢占阅读位置。
  - Function 组成：保持仅由 `FN-1.1 查看会话消息流` 承载，本 change 不新增或移除 Function。

## 影响范围（Impact）

- 用户：长过程正文减少由重复逐字渲染和瞬时快照缓存造成的主线程、内存与垃圾回收压力，终态正文不再横移，回看历史时提交不再抢占阅读位置。
- 外部系统、公共 API、配置和运维：无变化。
- 代码与测试：Agent Web 的 Markdown cache policy、消息 Turn 流式呈现、长历史派生与交互回调、发送后的 viewport 处理及对应组件、route-state 和浏览器旅程测试受到影响。
