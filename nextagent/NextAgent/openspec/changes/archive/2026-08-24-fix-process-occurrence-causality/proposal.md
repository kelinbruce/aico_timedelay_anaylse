## Why

用户在一次包含补充信息交互和命令执行的请求中，会观察到两类与真实执行事实不一致的过程呈现：新的模型执行说明会覆盖暂停前已经显示的执行说明，并继承旧说明的位置；命令执行期间产生的“任务进展”会脱离对应的“执行命令”卡片，成为位置更高的独立步骤。刷新后的历史仍可能重复这些错误，因为 live 与 history 使用了相同的错误合并身份。

这两类问题都破坏了同一个用户可依赖不变量：不同发生实例不得因复用相关字段而被合并，同一发生实例的生命周期与过程输出不得被拆成互相竞争的顶层事实。当前错误会让电信网络运维人员误判 Agent 先做了什么、哪个命令产生了哪些进展，以及失败或完成发生在何处，因此需要同时修正 live、重连和历史回显。

本 change 使用“发生实例”表示一次可独立排序、完成和恢复的模型步骤片段或 runtime Capability 调用。模型步骤片段由稳定步骤身份和最近一次已接受用户输入边界共同标识；runtime Capability 调用由非空 `toolCallId` 标识。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 暂停恢复前后的模型输出必须形成不同发生实例；两条执行说明即使正文相同或合法复用同一 `stepId`，也必须按真实时序分别显示，后出现的说明不得覆盖前一条或占据前一条的位置。
- 同一 `toolCallId` 的“执行命令”开始、结构化任务进展、普通安全结果和终态必须形成一张卡片；任务进展按产生顺序位于卡片内部，普通结果位于任务进展之后。
- 执行中的命令卡片默认展开；成功完成后默认折叠详情但保留“执行命令 · 已完成”；失败、超时或被阻止时默认保持展开；用户手动选择始终优先。
- live、SSE、WebSocket、重连和 run-event history 对相同事实形成相同顺序、归属和 disclosure 结果。
- 已解析为结构化任务进展的协议帧只呈现一次；同一次命令通过独立安全结果投影提供的普通输出仍可在“命令结果”中呈现。

**非目标：**

- 不新增 stream event type、公共 Web 字段、Gateway contract、持久化表或通用父子执行树。
- 不根据正文相等、关键词、相邻位置或字符串相似度推断发生实例或去重。
- 不把 Skill 解释为执行容器，也不改变 Workflow inner product、最终 Assistant answer、PIU/DSL/FILE 等既有专用呈现 owner。
- 不迁移或重写已经持久化且缺少充分发生实例证据的旧历史数据。
- 不把任务进展、卡片层级或其他 UI 结构额外披露给模型；canonical Capability Result 的模型上下文语义保持不变。

## What Changes

- 修改模型执行说明的发生实例契约：`USER_INPUT_RECEIVED` 将同一 `stepId` 分成前后两个发生实例；累计正文只允许替换同一输入分段内的先前快照。
- 修改过程面板对 runtime Capability 的结构化输出仲裁：具有合法 `toolCallId` 的 `CAPABILITY_STARTED`、`TOOL_STRUCTURED_DELTA`、普通安全结果和 `CAPABILITY_COMPLETED` 必须聚合为一个 Capability 卡片，不再由结构化标题抑制或替换该卡片。
- 修改命令卡片内部呈现：结构化 `TITLE`/`SUB_TITLE` 及其 detail/conclusion 按事件顺序成为卡片内部过程区；普通安全结果成为其后的结果区；已被结构化解析的协议帧不得作为普通结果重复显示。
- 修改终态 disclosure：运行中默认展开，成功终态默认折叠，失败、超时和阻止终态默认展开；显式用户选择继续覆盖自动行为。
- 修改排序与恢复保证：Capability 卡片使用 `CAPABILITY_STARTED` 的顺序锚点，后续内容和终态只更新原卡片；live 与 history 必须复用同一投影语义。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.1 实时查看处理过程`：用户看到的执行说明和命令过程按真实发生实例、因果归属和时序稳定呈现，刷新或补充信息恢复不改变既有事实的位置。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.1 查看会话消息流` → `specs/ts-web-sse-ws-transports/spec.md`
  - 功能边界：模型步骤累计正文的发生实例身份、暂停恢复后的独立说明，以及 live/history 的顺序一致性。
  - 系统质量属性：可靠性/恢复、可审计/可追溯性、可测试性。
  - 映射说明：canonical spec。
- `FN-10.6 前端定制` → `specs/agent-web-process-panel/spec.md`
  - 功能边界：同一 runtime Capability 调用的 lifecycle、结构化过程、普通结果和终态形成同一卡片，并按真实状态执行默认 disclosure。
  - 系统质量属性：可靠性/恢复、可维护性、可测试性。
  - 映射说明：`agent-web-process-panel` 为 canonical spec；本 change 同时触及 legacy spec `agent-web-structured-message-rendering` 中的结构化过程条目生成规则，并在同一 change 中原子收敛被修改行为。

## 影响范围（Impact）

- 最终用户会看到暂停恢复前后的执行说明同时保留；命令任务进展不再作为独立顶层步骤出现。
- Web stream payload shape、`stepId` producer 语义、公共 API、配置和运维部署方式保持兼容；浏览器对现有用户输入边界的发生实例解释会更精确。
- 过程面板 live/history projection、结构化消息渲染、Capability 结果卡片和 disclosure 测试需要同步调整。
- 前端需要覆盖相同 `stepId` 在用户输入边界前后保持独立，以及同一 `toolCallId` 的混合过程/结果、成功折叠、失败展开和三种宿主一致性。
