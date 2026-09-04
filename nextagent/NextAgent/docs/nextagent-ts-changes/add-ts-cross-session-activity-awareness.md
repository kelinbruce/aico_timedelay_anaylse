# add-ts-cross-session-activity-awareness

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P1
OpenSpec：[add-ts-cross-session-activity-awareness](../../openspec/changes/add-ts-cross-session-activity-awareness/)

状态：active（OpenSpec 已严格验证，implementation pending）
类型：vertical implementation change
主要 owner：`agent-session` session activity projection
协作模块：`agent-contracts`、`agent-app`、`agent-channel-web`、`frontend/agent-web`
认领人：已认领（当前会话）
依赖：[`refine-ts-session-activity-stream-boundary`](./refine-ts-session-activity-stream-boundary.md)先确认两类流边界；现有canonical request run、pending input、terminal timeline、四个用户可见会话列表入口，以及已落入当前代码的Web endpoint inventory/ER-IR route whitelist基线

目标：

- 让用户无需打开其他会话，即可在会话列表识别运行中、等待用户响应、未读失败和未读结果。
- 建立一条独立于当前会话 detail stream、列表分页、搜索结果和当前列表窗口的 Owner Scope + Agent Scope 会话活动连接。
- 只有终态结果在当前会话前台成功呈现后才消费提醒，并使同一用户的其他在线浏览器实例同步清除。
- collaborative会话列表收起时，顶部History入口以聚合蓝点提示至少一个当前不在用户正在查看的conversation surface中的session存在非`NONE`活动。

当前状态：

- 当前 session-scoped stream 只服务已打开会话；切换会话后，未打开会话的实时变化不会进入列表。
- 分页 session list 已投影 `latestRunStatus` 与 `hasInFlightRequest`，但不是实时活动通道，也没有等待输入或终态未读的查看生命周期。
- Runtime已有committed timeline listener，gateway已有latest run与active pending input的durable reader。local/immersive Sidebar与`SessionHistorySearchDialog`复用`SessionHistoryEntryRow`，immersive右布局History使用`CardList`，collaborative History Popover使用独立PIU行；当前共有四个用户可见入口和三种行实现。
- 仓库不存在 `agent-contracts/web` subpath；public Web DTO 继续由 `agent-channel-web` schema/projection 拥有。

规格输入：

- 会话活动状态只有 `WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT`、`NONE`，优先级按该顺序固定；每个会话同时只呈现一个状态。
- 首次连接与重连发送当前 scope 内全部非 `NONE` 状态的单个稀疏快照；后续只发送真实语义变化的单会话 delta。`NONE` 只清除曾发布的非 `NONE` 状态。
- 活动连接范围由可信 Owner Scope + Agent Scope 决定，与 session list 是否加载、加载多少页、搜索结果和当前打开会话无关。
- 每个 app instance 按既有 `transportKind` 只建立一条 activity SSE 或 activity WebSocket；它与当前会话 detail connection 并存。
- 当前active且`isConversationSurfaceVisible=true`的会话只在列表行本地抑制marker并继续显示时间，也从collaborative History聚合中本地排除；该注意力抑制不要求terminal presentation成功，也不消费backend unread。active route被History、Favorites、Memory、custom panel或协作面板状态覆盖时不抑制。只有匹配终态内容成功投影且document可见、`isConversationSurfaceVisible=true`时才视为已查看，提交opaque `activityId`与该presentation的`observedRunId`进行匹配消费，不增加viewport、滚动位置或anchored-mode门槛。加载失败时保留activity；用户切换离开或surface不可见后marker与History聚合恢复。
- collaborative顶部History trigger在任一当前不处于用户正在查看的conversation surface中的session为非`NONE`时显示locale-backed蓝点；打开Popover、hover、focus或加载列表不得清除蓝点或消费terminal activity。
- 同一已消费 terminal run不得因重复通知复活；新 run 开始后覆盖旧消费抑制或旧终态未读，并在新 run完成/失败时产生新的未读。迟到、重复或旧 `activityId` 消费不得清除更晚活动。
- Session delete 只在 durable delete 成功后清理 activity并广播 `NONE`；activity stream不承担会话目录删除同步。

契约输入：

- `agent-contracts/session` 新增会话活动判别联合、领域 port 与 scope-aware 派生/订阅/双坐标消费语义。
- `agent-contracts/runtime` 新增 channel-facing activity port；`agent-app` 闭包注入可信 Agent Scope。
- `agent-channel-web` 拥有严格 wire schema、ER activity SSE/WS endpoint 与 terminal consume route。
- 前置refinement冻结Activity为唯一Session Activity Projection Stream；它不使用`StreamEnvelope`、`StreamEventType`、timeline sequence或`RuntimeSessionPort.streamEvents(...)`。
- 公共类型为additive；不修改既有session list DTO、Request Execution Stream、runtime command、`RunStatus`、`PendingInputKind`或canonical timeline vocabulary。

实现约束：

- `agent-session`是唯一活动投影owner，只在相关`PERSISTED` lifecycle/pending-input/delete事实变化时重新读取当前latest run与active pending input并派生受影响session；当前有效run固定为lane最新accepted attempt，旧executing run与其pending input不得覆盖较新queued run。
- 进程内每个 session最多保存一个互斥内部状态：公开非 `NONE` activity或private consumed-terminal抑制；后者不进入公共契约、前端或持久化。内部状态与subscriber pending delta都按实际 session数有界，不另设更小的activity quota，也不建立平行 terminal waterline。
- 不新增 activity/observation 数据表、gateway Record、`feedSequence`、per-session revision、resume cursor或浏览器持久化。
- 进程重启后不恢复历史终态未读，只从 durable facts 恢复仍运行或仍等待输入的会话。
- Activity observer、bootstrap、transport和consume失败不得影响 request acceptance、pending input、terminal commit、session detail stream或session delete结果。
- Frontend使用独立 activity store；snapshot全量替换该 store，delta按 session merge，旧 connection generation callback必须丢弃。
- `WebChannelDependencies`只是`registerWebChannel(...)`挂载Fastify路由时的依赖输入，不是领域依赖注册表；其`sessionActivities`对通用package调用方保持optional。正式composition通过必需的`WebChannelRegistrationContext`携带该port：两个builtin Agent Web ER registration函数自动注入，托管Agent Web的custom registration显式注册等价Activity endpoints且不改变custom-over-builtin precedence；非Agent-Web custom surface不在本change范围内。IR明确不注入，也不得注册Activity route。

呈现约束：

- 状态占用会话列表行右侧原时间槽位；`RUNNING` 使用小型 loading，`WAITING_FOR_INPUT` 使用按具体 pending kind 本地化的 tag + 文字，`UNREAD_FAILURE` 使用红色圆圈感叹号，`UNREAD_RESULT` 使用蓝色小点，`NONE` 显示时间。
- local/immersive 左侧 Sidebar 的右侧时间、状态或 More 操作必须作为正常 flex item 按当前内容实际宽度参与布局并保持右对齐；标题只占据扣除常规内边距、间隔和当前 trailing content 后的剩余空间，以单行硬裁切隐藏溢出文字且不显示省略号。
- Sidebar 不得使用绝对覆盖、渐变或不透明背景遮罩，因此不要求维护一套随普通、hover、选中或主题变化切换的覆盖层背景。右侧内容宽度变化时，标题右侧的可见裁切点可以变化；验收中的“不得跳动”只约束会话行总宽度、标题左起点和 trailing 右边缘稳定，不要求标题始终保留相同可见宽度。
- 支持行操作的入口在pointer hover、keyboard focus-within或菜单保持打开时，把同一固定槽位切换为既有 More 操作，不允许行宽抖动或失去键盘可操作性；SearchDialog保留无More行为，hover/focus不隐藏时间或activity。
- More button或菜单项的Enter、Space、click不得同时触发行级session navigation。
- Local/immersive Sidebar、SessionHistorySearchDialog、immersive右布局History CardList与collaborative History Popover保留各自行容器，但必须复用同一`SessionActivityTrailingSlot`、activity selector、activity controller和terminal consumption判断，不得形成mode-specific业务语义。
- collaborative顶部History trigger使用聚合蓝点表达存在不在当前查看surface中的非`NONE`activity，不显示计数，也不编码具体状态优先级。

非目标：

- 不把活动状态塞入 `GET /api/v1/sessions` 分页 DTO，也不因加载下一页发送额外 activity sync。
- 不把取消或 supersede呈现为失败或未读结果。
- 不同步会话新增、重命名、排序、分页或删除 tombstone。
- 不实现通知中心、系统通知、跨进程广播或多实例共享活动总线。
- 不持久化“已查看”观察记录，不保证浏览器全部离线期间或进程重启后的历史终态提醒。

验收要点：

- Contract tests覆盖判别联合、条件字段、activityId边界和非法 Web payload fail closed。
- Service tests覆盖五态优先级、四种 pending kind、旧 run迟到、新 run覆盖、已消费同一 run不复活、新 run完成产生新未读、重复 terminal、稀疏 snapshot、snapshot/live race、session-keyed coalescing、consume、delete、restart与scope隔离。
- Channel tests覆盖 ER-only SSE/WS、单一 WebSocket upgrade dispatcher、双 stream并存、consume幂等、bootstrap失败与backpressure安全关闭，以及builtin/custom/IR registration precedence。
- Frontend tests覆盖独立store、malformed/protocol frame关闭重连、旧backend 404/503有界降级、connection cardinality、SSE/WS互斥、列表分页不影响活动范围、shared trailing slot、More键盘隔离、SearchDialog无More例外、collaborative History聚合蓝点、当前前台会话不受滚动位置额外限制、真实查看消费和四个用户可见列表入口一致性。
- Sidebar 布局黑盒验收必须断言不存在 trailing overlay、gradient 或背景遮罩，标题使用 `overflow:hidden`、`white-space:nowrap`、`text-overflow:clip` 且没有 ellipsis class；标题宽度与 trailing 实际宽度及固定间隔共同占满行内可用宽度，状态与 More 切换时行总宽度和 trailing 右边缘保持稳定。
- 浏览器旅程覆盖两个session并行、A中提交新run后切换B且A完成时出现未读、未打开会话状态、conversation加载失败时保留activity并在离开surface后恢复marker/History聚合、immersive History/Favorites覆盖不消费、返回conversation后消费、collaborative History蓝点且打开Popover不清除、document background不消费、两浏览器实例同步清除与双transport。
- 根目录 build/test/contract/architecture、前端 build/test/mode artifact、Playwright与 `openspec validate --all --strict` 全部通过后方可完成实现任务。

并行边界：

- 本change必须在`refine-ts-session-activity-stream-boundary`确认完成后，才能按`agent-contracts`、领域owner、composition、transport、frontend projection顺序进入实现。
- 可与 todo i18n change逻辑并行，但两者可能同时修改 `en-US.ts`、`zh-CN.ts` 与 frontend测试入口；认领人需要协调共享文件写入。
- 原 [`refine-session-list-run-awareness`](./refine-session-list-run-awareness.md) 已被本 change吸收，不得再独立实现其 frontend-only运行态路径。
