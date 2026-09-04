## 背景与问题（Why）

NextAgent 已能通过 `get_memory_detail` 把长期记忆详情提供给模型，也能在用户明确要求时通过 `add_memory` 同步写入长期记忆，但当前终态回复只展示正文。用户无法从本次回复判断模型实际装入了哪些长期记忆，也无法知道本次执行是否已经同步新增长期记忆；刷新会话后同样缺少持久化的使用回执。

仅根据前端看到的工具过程反推记忆使用并不可靠：`search_memory` 只返回候选摘要，不代表模型读取了完整记忆；live capability delta 不是终态事实；失败或取消发生前已经成功提交的 `add_memory` 也不会随请求终态回滚。若把新增记忆内容直接加入 `add_memory` 的模型可见结果，又会重复占用后续模型上下文并改变现有工具输出行为。因此需要在既有 memory tool、Agent loop 和 runtime terminal commit 边界之间建立一条最小、可持久化且不污染模型上下文的记忆披露链路。

## 变更范围（What Changes）

- 只在执行未从 durable facts 重建且最终为 `REQUEST_COMPLETED` 的回复底部按非空分组展示“引用了 N 条记忆”和“新增了 N 条记忆”；分组可分别展开，展开后展示当前 attempt 实际引用或同步新增的全部记忆内容。恢复执行、`REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED` 均不生成或展示记忆披露。
- 把成功 `get_memory_detail` 返回、进入后续模型循环并在同一 attempt 最终形成完成回复的 L2 记忆定义为“引用”；`search_memory` 候选、失败详情和未进入后续模型调用的详情不计入引用。
- 把当前 attempt 内成功 `add_memory` 已提交、且该 attempt 最终形成完成回复的记忆定义为当前回复的“新增”；异步 extraction、dreaming、其他后台学习以及任何前序 attempt 的写入都不进入本次回复回执。
- `add_memory` 的既有模型可见成功结果保持不变。写入 owner 在受 output schema 校验的 structured result 中增加内部 `memoryWriteReceipt`；`agent-core` 在 lifecycle hook、模型消息、live delta 和 capability result 持久化之前，按可信 provider/capability identity 校验、消费并移除该回执。
- 把 canonical `add_memory` 声明为调用级 `IDEMPOTENT`：runtime 只允许使用原始 `runId + toolCallId` 派生的同一幂等键重放结果不确定的同一次调用，使 Store 返回首次锚点记录且不重复写入。该语义不按记忆内容去重，不合并不同 tool invocation，也不把 reply disclosure 变成 capability recovery fact。
- `agent-core` 在当前连续执行内维护 request-scoped disclosure draft，按 `memoryId` 去重并通过受保护的 `flowVariables` 交给 terminal assembly；本 change 不新增 disclosure checkpoint 或改变既有 checkpoint 幂等语义。
- `agent-runtime` 只在最终规范化终态为 `REQUEST_COMPLETED`、且当前 attempt 未从 durable execution facts 重建执行状态时读取合法 draft，并在既有 terminal composite commit 中把同一 disclosure 原子写入 assistant message metadata 与 terminal event。恢复执行无法证明披露链完整时省略整个字段并记录固定安全诊断；其他终态同样省略，不修改 replacement、retry、edit 或 resubmit 流程。
- Web channel 对 conversation 和 SSE/WebSocket terminal event 投影相同的受控 DTO，并只接受完成终态的 disclosure；浏览器前端复用同一解析和底部组件处理 live 与历史会话。
- 会话 owner 的 conversation 投影可以包含上述披露，但 conversation share 的服务端公开投影必须从所有消息 metadata 中省略整段 `memoryDisclosure`；分享会话不授予查看用户长期记忆内容或记忆使用清单的权限，过滤不得修改 canonical owner message。
- disclosure 只包含 `memoryId` 和规范化 `content`，不包含来源、标题、跳转、`memoryVersion`、独立 `memoryType`、编辑入口、“暂不可用”状态或省略计数。
- 所有实际引用和同步新增条目都必须可完整展开查看；系统不得在 terminal 或前端阶段丢弃、截断或分页已经形成的 disclosure。本 change 不新增披露专用总预算，也不因累计 footer 大小阻止 memory tool 调用；单次工具结果继续遵守既有有界输出契约。
- terminal message metadata 不含 disclosure 时不显示记忆区域；非法 disclosure 只关闭该区域并记录安全诊断，不改变正文和请求终态。
- 本 change 只把 canonical `add_memory` 的 descriptor 改为调用级 `IDEMPOTENT`，不修改 `search_memory`、`get_memory_detail` 的 replay policy 或读取副作用，也不重构通用 runtime replay guard 与 risk-policy 的职责分配。

## Capability 影响（Capabilities）

### 新增 Capability

- `response-memory-disclosure`: 定义一次 request attempt 中长期记忆的实际引用、同步新增、恢复降级、终态持久化、Web 投影和回复底部展示语义。

### 修改的 Capability

- `memory-tools`: `add_memory` 的受信任执行结果增加仅供 `agent-core` 消费的内部写入回执；既有模型可见输入、成功结果和长期记忆写入语义保持不变。
- `conversation-share`: shared conversation 的服务端公开投影必须省略 `memoryDisclosure`，不改变 canonical owner message 和既有分享存储/授权契约。

## 影响范围（Impact）

- 前置依赖：`refine-long-term-memory-store-gateway-contract` 必须先完成并保持 `LongTermMemoryRecord.content` 的有界字符串契约；本 change 只按该契约完成写入后规范化内容解析和单条内部回执大小校验。
- 核心契约：在 `agent-contracts/session` 增加 `SessionMessage.metadata.memoryDisclosure` 的稳定结构和校验；在 `agent-contracts/channel` 增加受控 conversation/terminal stream DTO 投影。该 contract 变更已完成升级确认。
- `agent-memory`：成功 `add_memory` 产生经 `addMemoryOutputSchema` 校验的 memory-tool-private 写入回执，并把 capability replay policy 从 `NON_IDEMPOTENT` 改为 `IDEMPOTENT`；继续复用既有 invocation idempotency key 和 `LongTermMemoryStoreGateway` 锚点幂等写入，不改变模型可见结果，不增加长期记忆二次读取，也不新增内容级去重规则。
- `agent-core`：扩展 tool loop 的 request-local result effects、引用判定、去重、受信任回执的前置剥离和 terminal draft handoff；不增加 disclosure checkpoint、披露专用总预算或由 footer 大小触发的 memory tool 拒绝。
- `agent-runtime`：复用既有 terminal composite commit；只读校验当前连续执行的 draft，并仅在最终规范化完成终态原子提交。对从 durable execution facts 重建的执行统一省略 disclosure，不接管记忆相关性判断、长期记忆查询或跨 attempt 搬运。
- `agent-channel-common` / `agent-channel-web`：校验并投影 owner conversation/terminal disclosure，不从 capability timeline 重建业务事实；`agent-channel-web` 在 conversation share 服务端投影中无条件剥离 `memoryDisclosure`。
- `frontend/agent-web`：扩展 owner conversation/live contract、统一 turn projection 和回复底部组件；不调用 memory API，不自行推断工具调用；分享页不接收 disclosure。
- 持久化：复用现有 session message metadata 和 terminal timeline inline payload；`flowVariables` 只作为当前连续执行内的受保护 terminal handoff，不增加或改变 checkpoint 持久化语义。既有 lifecycle checkpoint 若保存完整 flow variables，可能在其 owner-scoped payload 中附带 draft，但 runtime 不把该副本作为恢复完整性、披露资格或 replay 判断依据。draft 只包含当前 attempt 的 `referenced`、`pendingReferenced` 和 `created`，内部写入回执不得进入 capability result message；不新增 Gateway port、Record、数据库列、表或事务。
- 配置和运维：不新增配置项、开关、日志正文或指标高基数字段。
- 测试：增加 memory tool 非模型可见回执、同 invocation 恢复只写一次、不同 invocation 互相独立、tool-loop 语义、多个单次合法 memory 调用不受累计 disclosure 大小影响、恢复执行省略披露、最终规范化完成终态提交、非完成终态省略、terminal composite commit、channel schema/projection、conversation share 服务端剥离、frontend live/history 一致性和浏览器用户旅程测试。
- 并行边界：当前 `add-ts-memory-application-contract` 同时修改 `agent-contracts/channel`，`stabilize-agent-web-popup-and-scroll` 也修改 conversation/live overlay 与 `TurnBlock` 邻近路径；三个 change 可以保持规格独立，但实现时必须串行整合共享 contract/前端文件，不得相互覆盖。response disclosure 不得复用或扩展 memory management port。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/response-memory-disclosure/spec.md`：新增本次回复长期记忆引用与同步新增的稳定行为契约。
- `openspec/specs/conversation-share/spec.md`：补充 shared conversation 不公开长期记忆披露 metadata 的稳定安全约束。

长期背景：
- `openspec/overview.md`：补充终态回复提供长期记忆使用与同步写入回执的产品目标。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：补充 request-scoped disclosure、structured result 内部写入回执的前置剥离、terminal commit、history/stream 双投影的跨模块契约，并明确不改变 checkpoint contract。
- `openspec/designs/architecture/ts-backend-architecture.md`：补充 memory owner、core 语义判断、runtime terminal ownership 和 channel projection 的协作边界。
- `openspec/designs/modules/agent-memory.md`：补充 `add_memory` memory-tool-private 写入回执及其非职责。
- `openspec/designs/modules/agent-core.md`：补充引用判定、request-scoped 收集和模型可见结果剥离职责。
- `openspec/designs/modules/agent-runtime.md`：补充恢复执行省略 disclosure 和 terminal composite commit 接入点。
- `openspec/designs/modules/agent-channel-web.md`：补充 owner conversation/stream 安全投影和 conversation share disclosure 剥离边界。
- `openspec/designs/modules/agent-web.md`：补充 live/history 共用的回复底部展示规则。
- `openspec/designs/adr/<id>.md`：无；本 change 复用既有 capability result 和 terminal commit 边界，不引入需要单独长期保留的新架构机制。
- `openspec/designs/spec-to-design-map.md`：新增 `response-memory-disclosure` 到上述架构与模块设计的导航。

验证入口：
- `openspec validate --all --strict`
- 后端 build、unit、contract、architecture gates，以及 memory/core/runtime/channel 定向测试。
- `frontend/agent-web` build、相关 Vitest 和 live/history 浏览器旅程测试。
