## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.4 查看请求状态` | 普通 Agent Web 以固定、事实性业务语言呈现三类系统过程事件，并闭合 durable event 的 live/history 语义与既有 live-only 例外 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-2.4 查看请求状态`

### 目标与规范依据

本设计闭合 proposal 中“系统事件只陈述已有事实，不推断执行结果”的黑盒目标。实现范围限于普通 Agent Web 的浏览器投影；stream event、timeline、history、request lifecycle、持久化与公共 contract 保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`Agent Web 系统过程事件必须使用事实性业务语言`
- `ADDED`：`系统过程事件普通界面必须限制技术信息披露`
- `ADDED`：`系统过程事件的实时与历史语义必须闭合`

本设计采用三层呈现模型：固定本地化标题与基础摘要表达事件事实；`DEGRADATION_NOTICE` 的显式安全技术码仅作为默认收起的技术证据；请求最终结果继续由终态呈现 owner 根据 terminal fact 动态生成。三层之间不得互相推断或复制。

### 当前实现

#### 事件范围审计

权威 channel vocabulary 当前包含 23 类事件，另有一个前端兼容事件。按用户界面责任分组后，只有下表中的三类属于本 change 要统一的“系统过程提示”；其余事件已有不同的事实、生命周期或安全 owner，合并处理会破坏职责边界。

| 事件组 | 事件 | 当前呈现 owner | 本 change 结论 |
|---|---|---|---|
| 请求受理 | `REQUEST_ACCEPTED` | 请求/用户消息状态 | 排除；现有“已受理”是业务语言 |
| 模型内容 | `LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA` | 思考与答复内容 | 排除；内容动态生成 |
| Capability | `CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED` | Capability 过程与结果 presenter | 排除；名称事实、locale 选择与 fallback 由 Capability 目录及其后续前端消费 change 独立治理，结果安全投影继续由 Capability presenter 负责 |
| Workflow/Tool 结构内容 | `TOOL_STRUCTURED_DELTA` | 结构化业务内容 presenter | 排除；正文由受控结构事件决定 |
| 系统过程提示 | `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` | 当前分散在过程、运行图和短暂提示 | 纳入 |
| 请求终态 | `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` | terminal/failure presenter | 排除；结果必须根据 terminal fact 动态生成 |
| Pending Input | `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED` | Pending Input presenter | 排除；问题、状态与结果动态变化 |
| 附件 | `ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED` | 附件 presenter | 排除；保留现有 live/history 边界 |
| 后台任务 | `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` | 后台任务 monitor | 排除；身份、状态、输出动态变化 |
| 输出安全阻断 | `OUTPUT_GUARD_BLOCKED` | output guard terminal presenter | 排除；另立安全呈现 change，不能用普通降级语义弱化 |
| 前端兼容系统提示 | `HOOK_DEGRADED` | 前端兼容路径 | 纳入固定业务语言，但不改变其非 canonical、live-only 身份 |

因此，本 change 不声称治理“全部系统事件”；它治理的是普通 Agent Web 中当前同形的两类 canonical 系统过程提示与一类前端兼容提示。完整事件集合与排除结论作为范围门禁，防止实现时凭名称把终态、安全阻断或业务内容纳入通用 resolver。

#### 三类事件的触发与现有呈现

- `DEGRADATION_NOTICE` 由多种独立路径产生，包括 Tool/AskUser/路由约束、预算与上下文不足、模型拒绝或空输出、部分输出、附件排除和投影/transport failure。部分路径随后继续，部分路径是 terminal failure 前置事实，因此该事件本身不能确定请求最终结果。canonical timeline notice 可进入共享 live/history projector；`safeFailureEnvelope(...)` 产生的 transport notice 没有 durable fact，只在当前连接可见。
- `CONTEXT_COMPACTED` 在 context assembly 成功完成 micro compact 或 summary compression 并改变 active context version 后产生，然后保存对应 checkpoint。它是成功整理上下文的过程事实，不是失败。canonical event 可在 live/history 中重建；`TurnBlock.tsx` 还会在最新答复之后显示 3 秒短暂提示，该动画只属于 live view state。
- `HOOK_DEGRADED` 只存在于前端 contract 校验与呈现兼容路径；后端没有 producer、channel vocabulary 或 history projector。当前 payload 可携带多种任意文本，且不同 builder 对缺少文本时是否创建条目并不一致。

当前 `processDetails.ts` 的两个过程 builder 分别生成折叠过程和时间线条目：降级标题为“降级通知”，上下文标题为“上下文压缩”，Hook 标题暴露 Hook；多个分支会直接读取 `message`、`content`、`summary`、`detail`、`reason`、`uiMessage` 或 `safeSummary`。`buildRunGraphViewState.ts` 把三类事件都建成 `degradation` node、都标为 `warning`，优先把 payload 文本作为 summary，并使用“运行时降级”阶段。`TurnBlock.tsx` 另行读取上下文整理文案。现有折叠过程的 `ProcessEntry` 只有工具失败使用的 `isFailure`，没有承载系统事件 `severity`；`ProcessPanel` 因此把 warning/info 系统事件都落入默认完成分支并显示绿色对勾。完整运行图已经拥有 warning/info 状态和全局主题 token，这个缺口不需要新增状态体系。

截图所示的“执行失败，本次未生成回复内容”及其后续事实原因、失败阶段、重试判断和行动指导不属于上述系统过程条目。请求状态为 `FAILED` 时，`TurnBlock.tsx` 调用既有 `readFailureReasonPresentation(aiEvents)`，按 `REQUEST_FAILED`、Capability 安全失败、`DEGRADATION_NOTICE` 的顺序选择可用的安全 code/category，再由固定 i18n 映射组成五行终态失败总结。runtime 会记住最新 `DEGRADATION_NOTICE` 的顶层显式 code/category，并在真实失败提交时把它们写入 `REQUEST_FAILED`，因此常见路径由 terminal fact 自身提供错误事实；这段总结不是模型生成文本，也不直接显示任意 payload message。它已有独立的 terminal/failure presenter 与 stable Requirement，本 change 只需要保持该 owner、输入优先级和截图所示 `MODEL_INTERNAL_ERROR` 结果不变。

当前 `failureDetails.ts` 的重试判断主要按 code/category 固定映射，没有直接消费 terminal payload 的 `retryable` 或校验当前 surface 是否提供 retry control；其测试还固定了部分 model code 在未携带 `retryable` 时返回建议重试。这与 stable Requirement `请求终态失败只在有可靠行动依据时提供指导` 的完整条件存在既有实现缺口，但不由系统过程事件的业务语言 resolver 造成。该缺口需要单独修正 terminal/failure presenter 及其测试，本 change 不得顺带修改，也不得把当前偏差提升为新的目标契约。

PR !987 已合入的 `capabilityProcessTitle.ts` 是 Capability 标题的当前前端实现事实；协调中的 `refine-capability-descriptor-localized-display-names` 则把未来统一名称事实定义为 `CapabilityDescriptor.localizedDisplayNames`，并明确把前端 locale 选择、fallback 和展示消费留给后续 change。该演进不构成本 change 的依赖。两类呈现只共享“消费受治理的结构化事实，不解析任意 payload 文本”这一原则：Capability 名称以 descriptor/Catalog 事实为来源，三类系统事件的固定语义只以 `eventType` 为来源。本 change 不读取 Capability descriptor、名称配置或身份字段，也不把系统事件分支并入 Capability resolver。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 三类事件使用固定事实性业务语义 | 标题与摘要分散在三个消费者和多组 i18n key | 同一事件可在不同视图使用不同文案 |
| 任意 payload 文本不得成为标题或基础摘要 | 过程和运行图读取多种 payload 文本并优先展示 | 兼容输入可覆盖平台语义并暴露内部文本 |
| `CONTEXT_COMPACTED` 为信息提示 | 运行图把三类事件统一标为 `warning` | 成功整理上下文被错误呈现为降级警告 |
| 折叠过程按严重程度显示系统事件 | resolver 已区分 warning/info，但 `ProcessEntry` 未承载 severity | 警告和信息事件都错误显示绿色完成对勾 |
| 技术码默认收起且不推断结果 | 过程分支能显示 code，但基础文案包含“已降级继续处理” | 文案承诺继续，且多个分支重复技术详情策略 |
| canonical durable 事件 live/history 语义一致 | 两者共享事实来源，但各 UI builder 分别决定标题和摘要 | 事实一致不能自动保证呈现一致 |
| live-only 例外不被伪造为历史 | transport notice、短暂动画和 Hook 兼容路径确实 live-only | 缺少集中测试来固定这些例外 |
| 非适用事件保持各自 owner | 完整运行图仍显示全局技术阶段与 raw event diagnostics | 需要明确只改三类 node 的可见语义，不借机改全局信息架构 |

### 修改方案

#### 唯一呈现入口

在 `frontend/agent-web/src/features/chat/process/systemEventPresentation.ts` 新增一个系统事件专用的纯函数 resolver。它复用“由受治理结构化事实选择业务语言、不解析任意文本”的原则，但不依赖 Capability 名称事实或名称选择器，也不与其互相 import 或扩展职责。

内部输入输出形态固定为：

```ts
type GovernedSystemEventType =
  | 'DEGRADATION_NOTICE'
  | 'HOOK_DEGRADED'
  | 'CONTEXT_COMPACTED';

interface SystemEventPresentation {
  readonly title: string;
  readonly summary: string;
  readonly severity: 'warning' | 'info';
  readonly technicalCode?: string;
}
```

resolver 接收 `GovernedSystemEventType`、已经通过 stream validation 的安全 payload 和翻译函数。`title`、`summary`、`severity` 必须只由 event type 与当前语言决定；`technicalCode` 仅在事件为 `DEGRADATION_NOTICE` 且 payload 顶层显式 `code` 为 trim 后非空字符串时保留。它不得调用会从 `message`、`content`、`reason` 或其他 legacy 文本解析 code 的通用失败 helper。未知 code 仍只作为纯文本技术证据，不改变业务语义。resolver 不保存状态、不读取 store、不修改 event，也不接受 arbitrary text fallback。

| event type | title key | summary key | severity | technicalCode |
|---|---|---|---|---|
| `DEGRADATION_NOTICE` | 本次任务有部分内容未完成 | 请查看执行详情和本次答复，确认未完成的内容 | `warning` | 允许顶层显式非空 `code` |
| `HOOK_DEGRADED` | 本次任务有部分内容未完成 | 请查看执行详情和本次答复，确认未完成的内容 | `warning` | 省略 |
| `CONTEXT_COMPACTED` | 已整理较早的对话 | 系统已整理较早的对话内容，以便继续处理本次任务 | `info` | 省略 |

中文资源采用 spec 表格中的文案；英文资源表达相同事实，不新增另一套结果语义。翻译缺失继续服从 Agent Web 既有安全 fallback，不在 resolver 中建立语言回退状态机。

本 change 的完整验收语言是当前 Agent Web 支持的 `zh-CN` 与 `en-US`，但 `systemEventPresentation` 不枚举或封闭未来语言集合。未来新增受支持语言时，只需由全局国际化 change 扩展 locale 注册、资源、语言协商与安全 fallback，并为同一组系统事件 key 提供等义翻译；系统事件 resolver、stream/history contract 和 Gateway 无需随语言数量变化。日期数字格式、文本方向与 RTL 等跨界面能力同样属于全局国际化 owner，不在本 change 内建立局部机制。

#### 消费者接入

1. `processDetails.ts` 的折叠过程、时间线和 terminal failure 关联降级过程条目统一调用 resolver。summary 始终来自 resolver；仅 `technicalCode` 存在时创建默认收起的既有“技术详情”，并使用既有“错误码”标签。`CONTEXT_COMPACTED` 与 `HOOK_DEGRADED` 不可展开，不再读取任意文本。折叠过程的内部 `ProcessEntry` 直接承载 resolver 已有的 `warning | info` severity；`ProcessPanel` 在既有工具失败、运行中和专用过程图标规则之外，使用 `WarningOutlined` 与全局 `--color-status-warning-dot` token 显示橙黄色三角警告图标，使用 `InfoCircleOutlined` 与全局 `--color-status-info-dot` token 显示中性圆形信息图标。它不导入 Run Graph 私有类型、不新增状态枚举或颜色体系，也不把降级设置为失败。现有事件排序、合并、终态去重、条目 key 与数量规则保持不变。这里的 terminal failure 关联分支只负责过程面板中的降级条目去重，不修改 `failureDetails.ts` 或 `FailedNotice` 的终态失败总结。
2. `buildRunGraphViewState.ts` 对三类事件调用同一 resolver，node title、summary、status 分别取 `title`、`summary`、`severity`。仅当 `technicalCode` 存在时，把本地化“错误码：<code>”加入 selected node 的 `detailLines`，使其在用户选择 node 后可见。继续保留内部 `kind='degradation'`，避免为一次呈现修正扩展 node taxonomy；这些 node 的可见 phase label 改为中性的“系统处理提示”，不改其他 node、raw event 列表、sequence 或 graph edge。
3. `TurnBlock.tsx` 的 3 秒 `CONTEXT_COMPACTED` notice 调用 resolver 取得固定摘要。真实 Runtime 会在后续模型输出之前产生该事件，因此动画以 turn 是否在当前 live view 中实际流式经历过为门禁，并允许 canonical run history 在同一 live turn 内补齐事件；纯 history-load turn 不触发。提示在答案内容可见时开始，仍保持既有 3 秒计时、居中布局和消失规则，计时以 event id 稳定，不因后续 answer delta 重启。
4. `zh-CN.ts` 与 `en-US.ts` 为 resolver 提供唯一一组系统事件 title/summary keys。旧 key 只在没有其他消费者后删除；不顺带整理无关翻译资源。

#### 配置与可见性边界

本 change 的 resolver 不接收 AICOConfig、显示级别或 visibility policy。标题、基础摘要与严重程度是平台治理事实，不是产品咨询可覆盖的文案模板。现有 `showThinkingChain=false` 只隐藏 ProcessPanel 的“完整过程”入口，仍保留过程摘要；它不构成单个事件隐藏能力，也不得用于删除 `DEGRADATION_NOTICE`。

| 事件 | 当前可见性约束 | 理由 |
|---|---|---|
| `DEGRADATION_NOTICE` | 既有投影规则形成独立可见条目时强制呈现，不允许产品增加额外抑制 | 该事件可能是继续处理、部分结果或 terminal failure 的前置事实，前端不能从 event type 判断最终影响；整体隐藏会使受限结果看起来完全正常。既有 terminal 去重规则保持不变 |
| `CONTEXT_COMPACTED` | 本 change 保持显示；允许未来独立 change 评估可选隐藏 | 它是成功的例行上下文整理，不改变最终答复或请求终态，通常不要求用户行动 |
| `HOOK_DEGRADED` | compatibility-only 固定提示，不进入产品配置契约 | 它没有 canonical producer 或 history 身份，把它写入 AICOConfig 会固化临时兼容 vocabulary |

如果出现已经确认的产品需求，`CONTEXT_COMPACTED` 的隐藏必须由独立 OpenSpec change 修改 `FN-10.6 前端定制` 及其 AICOConfig/display control 契约，使用单一显式字段 `showContextCompaction?: boolean`，缺失或 `true` 保持显示，`false` 才隐藏。不得提前建立通用 event-type map。该独立 change 对“完全隐藏”的验收必须同时覆盖折叠过程条目、完整过程时间线、Run Graph node/activity/selected detail/用户可见计数、3 秒短暂提示和普通界面的 raw event 列表；canonical envelope、history/store fact、checkpoint、上下文版本、最终答复与受控开发诊断仍保留。live/history 和三种宿主必须按同一当前配置投影。

如果未来要求只隐藏部分 `DEGRADATION_NOTICE`，前端不得按 code 自建 optional allowlist。对应语义 owner 必须先通过独立 backend contract change 提供 canonical `REQUIRED | OPTIONAL` 可见性分类；缺失、未知或非法分类按 `REQUIRED` 处理，产品配置最多隐藏 `OPTIONAL`。当前 event contract 没有该事实，因此本 change 不实现此能力。

#### live/history 与动态内容边界

- canonical `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 已由共享 projector 支持 live/history；前端对同一个 `StreamEnvelope` 运行同一个 resolver，即可得到一致语义，不修改 channel 或 history。
- live 与 history 构建的折叠过程条目都携带 resolver 产生的同一 severity；图标只消费该前端派生值，不从 payload 文本、code、请求终态或宿主配置推断。
- transport `safeFailureEnvelope(...)` 仍是 live-only；前端按 `DEGRADATION_NOTICE` 固定语义显示，但不为它创建持久化或 history fallback。
- `CONTEXT_COMPACTED` 的过程条目可重建，3 秒动画不重播。动画的出现时机是动态的，文案不是动态的。
- `HOOK_DEGRADED` 仍是 compatibility-only live event。resolver 消除任意文本差异，但不新增 producer 或 history。
- 三类事件 payload 中 code、category、retryable、reasonCode、safeSummary、contextVersion、summaryMessageId、tokenEstimate 以及兼容文本可以动态变化；普通标题与基础摘要只按 event type 固定。最终执行结果根据 terminal fact 动态变化，由 terminal presenter 唯一负责。
- 请求进入 `FAILED` 后，终态失败总结继续按既有安全 code/category 和 terminal 状态动态选择事实原因、失败阶段、重试判断与行动指导。系统过程 resolver 不向该总结提供标题或摘要，也不覆盖 `REQUEST_FAILED` 的更高优先级事实；同一显式 code 可以分别作为过程条目的默认收起技术证据和 terminal presenter 的安全映射输入。

#### 真实 Runtime 验证装配

为补充前端确定性 fixture，本 change 增加一条只用于人工集成验收的真实 MiniMax/Runtime 路径。该路径复用标准 fullstack entrypoint、MiniMax 启动器、公共 session/request/stream/history API 和隔离 SQLite，不新增生产 API、Gateway contract、持久化表或运行时事件。

验证装配采用两个相互隔离的场景配置：

1. `DEGRADATION_NOTICE` 场景只在验证配置中加载受控失败的 Tool fixture，并通过验证专用 Agent 与模型策略稳定触发一次真实 Tool 失败。现有 Agent Core/Runtime 负责产生 Capability 结果、`DEGRADATION_NOTICE` 和请求终态；验证脚本不得直接写 timeline 或 SQLite。
2. `CONTEXT_COMPACTED` 场景不加载失败型 Tool，通过公共 request API 构造有界的长上下文，并使用验证专用的受限模型 profile 稳定跨过既有自动压缩阈值。真实 Context Engine 负责产生 `CONTEXT_COMPACTED`、checkpoint 和后续模型请求；验证脚本不得直接调用 context owner 私有方法。

两个场景都从 SSE 观察 live 事件，从既有 history API 重新读取 durable 事件，并在同一前端 artifact 中检查默认过程和完整运行图。Fixture、场景配置和验证脚本只能位于测试目录，默认系统配置、默认 Agent assembly、构建 artifact 和发布包不得引用它们。MiniMax 凭据仍只由既有启动器从 Keychain 注入，fixture 和脚本不得读取、复制或记录凭据。

具体错误码、模型窗口、输出上限、输入规模、prompt、端口和 fixture 文件布局属于测试资产，不构成产品契约、配置默认值或长期设计。它们由测试目录中的 README、场景配置、fixture 与验证脚本共同持有，并可在不改变本 change 产品语义的前提下按环境调整。

##### `tests/manual/system-event-real-runtime/` 目录层架构评审结论

评审结论：`PASS`（2026-08-13）。批准保留该目录层。该结论是对 GitCode #752 指出的缺失治理证据进行补录；目录在首次纳入版本控制前没有留下满足 AGENTS.md 的专项架构评审通过记录，本次评审不改变该历史事实。

| 评审项 | 结论 |
|---|---|
| owner | `FN-2.4 查看请求状态` 的真实 Runtime 验收 owner，维护入口为本 change 及其归档后的后续验收变更；产品 Runtime、Agent Web、Gateway 和发布流程均不拥有该目录。 |
| 职责边界 | 只承载 `DEGRADATION_NOTICE` 与 `CONTEXT_COMPACTED` 的人工真实 Runtime 集成验收，包括专用 Agent、受控 Tool fixture、场景 overlay、公共 API 验证脚本和使用说明；不得承载产品实现、默认配置、公共 contract、持久化 schema 或生产凭据。 |
| 生命周期 | 在上述真实 Runtime 验证矩阵仍是 `FN-2.4 查看请求状态` 的验收入口期间持续维护。仅当后续 change 提供覆盖同一真实 Runtime、SSE、history 和 UI 闭环的替代验收入口时，才允许在该后续 change 中整体删除本目录及其引用；不得留下失去入口或 owner 的局部 fixture。OpenSpec change 归档本身不删除该长期测试资产。 |
| 构建影响 | 默认根 workspace build、Agent Web build 和多宿主 artifact build 不扫描或执行本目录；验证人员只按 README 显式启动场景。 |
| 打包影响 | 默认 Agent assembly、系统配置、`@nextagent/agent-web` artifact、本地运行包和发布包均不得引用或包含本目录资产。 |
| 运行时影响 | 默认服务启动和请求路径不读取本目录。只有验证人员显式设置场景 overlay 并启动隔离实例时才加载专用 Agent、Tool fixture 和配置；场景使用独立端口与被忽略的隔离 state，不读取或修改默认服务数据。 |
| 验证证据 | `tests/architecture/system-event-real-runtime-fixture-isolation.test.ts` 与 `tests/architecture/system-event-real-runtime-support.test.ts` 检查 fixture contract、默认装配与打包隔离、后端事件边界及验证脚本安全约束；README 记录显式运行入口。 |

将文件平铺到 `tests/manual/` 会混合两个场景的配置、fixture、脚本和隔离 state，并削弱整体删除边界；迁入产品 package 或构建目录会错误扩大产品 owner 和打包面。因此保留当前专用测试目录是满足单一职责、显式生命周期和默认产品零影响的最小方案。

`HOOK_DEGRADED` 不进入该真实 Runtime 装配。真实 Lifecycle Hook 当前产生 canonical `HOOK_INVOKED`，而 `HOOK_DEGRADED` 没有后端 producer、channel vocabulary 或 history projector；本 change 继续仅用前端 compatibility fixture 验证其 live-only 呈现。若未来要把真实 Hook 失败投影到普通 Agent Web，必须通过独立 OpenSpec change 定义 canonical event、channel projection 和 live/history 语义，不得在本验证装配中伪造或派生 `HOOK_DEGRADED`。

#### 明确不修改的边界

- 不修改 `packages/` 下的 runtime、core、context、channel、contracts、Gateway 或 persistence 代码。
- 不修改 stream validation 的 canonical/compatibility 身份，不新增 event type、payload field 或 history source。
- 不修改当前 `capabilityBusinessNames`、未来 `CapabilityDescriptor.localizedDisplayNames`、Catalog 字段保真、Capability locale/fallback、前端名称消费或结果安全投影。系统事件 resolver 不消费这些事实，也不是 Capability identity contract 的延伸。
- 不为 Capability/Agent 失败建立具体业务原因、可执行建议、因果链、状态图标或诊断坐标映射；这些内容由 GitCode #718 作为 #685 下的独立 vertical 跟踪。当前 resolver 不得形成与 Capability failure projector 或 terminal presenter 竞争的第二套事实解释。
- 不修改 `failureDetails.ts`、`FailedNotice` 或终态失败 i18n 映射，不改变 `REQUEST_FAILED`、Capability 安全失败与 `DEGRADATION_NOTICE` 的既有事实选择优先级。截图中的终态失败总结及其 live/history 结果保持不变。
- 不修改 AICOConfig 类型、校验、store、宿主注入或 `showThinkingChain` 语义，不新增系统事件 visibility map。未知宿主配置不能进入 resolver 或改变 `DEGRADATION_NOTICE` 可见性。
- 不处理 `OUTPUT_GUARD_BLOCKED`。安全阻断的 provider refusal 与 terminal 结果是动态安全事实，后续 change 必须由 output guard/terminal presenter 单独定义，不能复用中性降级摘要。
- 不处理完整运行图中 `Web Channel`、`能力 SPI`、`正文流`、`终态事件`、raw event type/sequence 等全局诊断标签；这些属于产品信息架构与诊断边界的独立问题。
- 不为真实 Runtime 验证新增 event injection、timeline append、Gateway write 或测试专用 Web API；测试数据只通过公共产品 API 进入隔离运行实例。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 系统质量属性 Requirement `系统过程事件普通界面必须限制技术信息披露` | 任意 payload 文本不能进入标题、基础摘要或默认详情；只允许顶层显式 `code` 作为默认收起的纯文本技术证据 | 注入内部术语、路径、任意文本或文本内伪 code 时，普通界面不可见 |
| 可靠性/恢复 | 系统质量属性 Requirement `系统过程事件的实时与历史语义必须闭合` | live/history 对同一 validated envelope 使用同一纯 resolver；显式保留三类 live-only 例外 | 刷新前后 durable 事件语义一致，history 不合成 live-only 提示 |
| 可测试性 | 功能性 Requirement `Agent Web 系统过程事件必须使用事实性业务语言`；无新增黑盒质量目标 | 无状态纯 resolver 与窄输入闭集使文案、严重程度和 code disclosure 可独立验证 | 中英文、未知 code、三宿主和三个消费者覆盖同一矩阵 |

#### 备选方案（Alternatives Considered）

- 复用 Capability 名称选择器或 descriptor 名称事实：系统事件没有 Capability identity、Provider 名称来源或 Catalog winner，强行合并会形成多职责 resolver；不采用。
- 由后端投影最终用户文案：可以统一 transport 输出，但会把本地化 view policy放入 channel，且三类事件已有足够事实；不采用。
- 为 run graph 新增 `systemNotice` node kind：语义更直观，但会扩大 graph renderer、样式与类型改动；当前 `status='info'` 已能正确表达上下文整理严重程度，保留内部 `degradation` kind 是更小改动。
- 为系统过程事件建立 reason-code 业务原因与行动建议 taxonomy：可使非终态降级提示更具体，但当前 code 来源广、结果语义不统一，容易产生错误承诺；本 change 只保留固定过程事实与可展开 code。Capability/Agent 失败由 GitCode #718 跟踪，请求终态失败继续由既有 presenter 负责，本 change 不重复建设。
- 增加通用 `systemEventVisibility` map：可让产品按 event type 隐藏事件，但会把强制透明度交给宿主，并把 `HOOK_DEGRADED` 固化为公共配置身份；不采用。未来只有经规范确认的 optional event 才增加窄字段。

## 验证策略（Verification Strategy）

- unit：验证 resolver 在中文、英文下对三类事件产生固定标题、摘要和严重程度；验证 code 有无、未知 code、任意文本注入和非适用 event 的边界。
- projection/component：验证折叠过程与时间线使用相同语义、技术码默认收起、上下文与 Hook 不可展开；验证事件顺序、数量、terminal 条目和最终答复不变，并固定截图所示终态失败总结仍由既有 terminal presenter 生成。
- run graph：验证两个受限事件为 warning、上下文整理为 info，三类标题/摘要不含旧技术术语或 payload 文本，其他 node 与 raw diagnostics 不变。
- characterization：用 live 与 history envelope 覆盖 canonical durable 两类事件；分别断言 transport notice、短暂动画与 Hook 不进入 history。
- e2e：在 local、immersive、collaborative 三种宿主与中英文界面检查默认过程、完整运行图和上下文短暂提示。
- real-runtime：通过既有 MiniMax 启动器分别启动两个隔离场景；断言真实模型调用、Runtime canonical event、SSE live 投影、history durable 重建和前端呈现闭合。`HOOK_DEGRADED` 明确不进入该矩阵。
- architecture/人工审查：确认产品实现 diff 只触及 active change 与 `frontend/agent-web`，新增内容仅包含测试 fixture、场景配置和验证脚本；确认默认配置、默认 Agent assembly、构建 artifact 与发布包不引用 fixture，且没有 backend contract、timeline、persistence、Gateway、Capability resolver 或生产 API 变更；确认完整事件清单中的排除项未被通用 resolver 消费。
- negative case：payload 含 event type、Hook id、raw message、safeSummary 或内部原因时不得进入普通摘要；不存在技术码时不得从其他字段推断详情；系统过程摘要不得覆盖或复制终态失败总结；未知宿主配置不得改写三类语义或隐藏 `DEGRADATION_NOTICE`；history 不得合成 live-only 条目。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：合并三个新增 Requirements。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：刷新描述、输出、处理过程、结果、规格和验证关注点。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：补充系统过程提示的用户价值、用例、黑盒边界和适用质量属性。
- `openspec/overview.md`：补充普通 Agent Web 以事实性业务语言呈现系统过程提示的长期用户价值。
- `openspec/designs/architecture/conversation-ui-state.md`：更新三类事件的呈现责任、live/history 语义与 compatibility 边界。
- `openspec/designs/modules/agent-web.md`：补充普通 Agent Web 的集中系统事件 presenter、三类消费者和技术信息披露边界。
- `openspec/designs/modules/agent-channel-web.md`：无；channel contract 与 projector 不变。
- `openspec/designs/adr/`：无；本 change 不引入需要长期保留的新架构决策。
- `openspec/designs/spec-to-design-map.md`：无；spec 与既有设计导航关系不变。

## 风险与取舍（Risks / Trade-offs）

- 固定摘要比 payload 中的具体文本信息更少。通过保留 `DEGRADATION_NOTICE` 显式安全技术码的主动展开入口缓解，同时避免把未经治理文本当作可靠原因。
- `HOOK_DEGRADED` 没有后端 producer，产品路径难以稳定复现。通过 unit/characterization fixture 固定 compatibility 行为，不为测试便利新增生产事件。
- 真实 MiniMax 验证依赖外部模型服务与本机 Keychain，不能替代确定性 CI。它只作为人工集成验收补充，CI 继续以 deterministic unit/characterization/e2e fixture 为发布门禁。
- run graph 保留内部 `degradation` kind，代码分类与用户语义不完全同名。该差异不对用户可见；测试必须以 title、summary 和 status 为验收面，避免依赖 kind 推断严重程度。
- 英文业务文案可能需要产品措辞复核。实现时以 spec 语义为约束，任何措辞调整必须保持事实、严重程度和禁止推断边界。未来新增语言由全局国际化 change 验收 locale 注册、fallback 和跨界面一致性，本 resolver 不随语言集合扩展而改变。
- `ts-run-status-visibility` 与 `processDetails.ts` 同时被多个 active changes 触及。实施和归档前必须基于最新 `main` 复核同名 Requirement 无冲突，并对共享文件做语义合并；未来 Capability 前端名称消费若触及同一组件，也必须保留两条独立数据路径：Capability presenter 消费 descriptor 名称事实，系统事件 presenter 消费 `eventType`，不得覆盖 failure disposition 或其他过程呈现规则。
- 部分产品可能希望隐藏例行过程提示。当前只记录 `CONTEXT_COMPACTED` 的窄扩展路径，不提前增加 AICOConfig contract；实际需求出现时必须单独评审其全部 surface 覆盖与诊断保留边界。
- 终态失败 presenter 当前未完整消费 `retryable` 与 surface retry control，属于既有 stable spec/实现缺口。当前 change 只对截图中的 `MODEL_INTERNAL_ERROR` 终态总结做非回归验证，不扩大测试去固化其他 code 的既有重试偏差；该缺口由独立 terminal failure refinement 处理。

## 待确认问题（Open Questions）

无。
