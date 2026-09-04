# add-ts-response-memory-disclosure

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：长期记忆
优先级：P1

状态：active
类型：契约与实施 change
主要 owner：`agent-core`
依赖：`refine-long-term-memory-store-gateway-contract`、既有 memory tools、terminal composite commit 和 Web stream/conversation projection

目标：

- 只在执行未从 durable facts 重建且最终为 `REQUEST_COMPLETED` 的 assistant 回复底部按非空分组展示“引用了 N 条记忆”和“新增了 N 条记忆”。
- 只把进入当前 attempt 后续模型调用的成功 `get_memory_detail` L2 详情计为引用；新增只包括当前 attempt 已提交的同步 `add_memory`。
- live 与刷新后的 conversation 使用同一终态事实；不等待或追加异步 extraction/dreaming 结果。
- 保持 `add_memory` 模型可见结果不变，内部新增回执不得进入 hook、模型上下文、capability result、stream 或日志。
- 会话 owner 的 live/conversation 可以看到披露；公开分享投影必须在服务端省略整段 `memoryDisclosure`，分享会话不构成公开用户长期记忆内容的授权。

规格输入：

- 披露条目只包含 `memoryId` 和规范化 `content`；不包含来源、版本、标题、链接、独立 `memoryType`、编辑操作、“暂不可用”或省略计数。
- `search_memory` L1 候选不算引用；成功 L2 详情只有真正进入同 attempt 后续模型调用后才算引用。
- `add_memory` 成功写入后即产生 request-local 新增回执；只有当前 attempt 最终完成时才披露。随后失败、取消或被替代时不生成回复披露，已写入的长期记忆本身不回滚。
- `add_memory` 采用同 invocation 幂等恢复：结果不确定时只能用原始 `runId + toolCallId` key 重放并返回首次锚点记录。不同 tool invocation 不按内容合并，reply disclosure 不参与 replay 判断。
- disclosure 只保证当前连续执行内的完整性；从 durable execution facts 重建的 attempt 完成后省略整个 footer，并记录固定无内容诊断，不改变正文、终态或 memory Store。
- retry、edit、resubmit 和 supersede successor 都不继承前一 attempt 的 disclosure；后续 attempt 只披露自己实际引用和同步新增的记忆。
- conversation share 无论来源终态为何都不返回 `memoryDisclosure`；该过滤不得修改 owner 会话中的 canonical message metadata。
- 实际引用和同步新增多少就完整披露多少；不新增披露专用总预算，不因累计 footer 大小阻止 Retriever 或 Store。单次 memory tool 结果继续遵守既有有界输出契约。

核心契约：

- `agent-contracts/session` 主承载 `ResponseMemoryDisclosure` 和 `SessionMessage.metadata.memoryDisclosure` 的稳定类型与 runtime schema。
- `agent-contracts/channel` 主承载同形 public DTO，不依赖 session subpath，也不扩展通用 capability result envelope。
- 既有 `conversation-share` 行为规格主承载 shared conversation 的 disclosure 隔离；复用现有分享 response projection，不增加 share Gateway、Record 或 DTO 字段。
- `add_memory` 的 output-schema-validated structured result 增加 memory-tool-private `memoryWriteReceipt`；仅 `agent-core` 按精确 trusted provider/capability identity 消费并前置剥离。
- `flowVariables.responseMemoryDisclosureDraft` 只承载当前连续执行内的 request-local terminal handoff；本 change 不增加 disclosure checkpoint，也不改变 checkpoint trigger、幂等键、payload 或 recovery guard。既有 lifecycle checkpoint 可能随完整 flow variables 附带该 draft，但它不是恢复完整性、披露资格或 replay 判断依据。最终事实仅在具备披露资格的完成终态随现有 terminal composite transaction 同时写入 assistant message metadata 和 terminal event。
- 该 draft 是 core/runtime 保留键：执行期间由 core 维护当前 attempt 的引用和新增，terminal 阶段由 runtime 只读校验；planning hook projection 必须剥离，hook merge 必须保留可信值并丢弃同名伪造，不增加通用 typed extension。所有通过既有 `reconstructRecoveryContext` 生成 context 的 recovery/resume 路径设置 runtime 私有重建标记并省略 footer；fresh submit 和新 attempt 默认为未重建。runtime 不从 checkpoint draft 推导完整性，重建标记也不得由客户端或 flow variable 覆盖。

实现边界：

- `agent-memory` 产生实际 Store 返回记录对应的规范化写入回执，并拥有 `add_memory` 的 `IDEMPOTENT` descriptor；不判断终态展示，也不做内容级去重。
- `agent-core` 拥有引用/新增语义、去重、模型调用边界和 request draft。
- `agent-runtime` 先使用最终规范化 `terminalStatus`，只在当前执行未从 durable facts 重建且最终为 `REQUEST_COMPLETED` 时原子提交合法 draft；不查询长期记忆、不判断记忆相关性，也不搬运前序 attempt 的披露。
- `agent-channel-common` 和 `agent-channel-web` 只校验并投影完成终态的 terminal/conversation DTO；conversation 直接使用同一 message 的受信 `eventType/status`，不查询 timeline 或新增 `terminalMessageId` 关联；conversation share 服务端投影无条件剥离 disclosure，不扫描 capability delta。
- `frontend/agent-web` 只解析和展示 owner 会话中的同一 footer，不调用 memory API，不为三种宿主或分享页面建立平行语义。

非目标：

- 不提供记忆来源、原任务跳转、详情读取、编辑、纠错或管理入口。
- 不新增 attempt history UI；任何新 attempt 都不继承前序引用或新增披露。
- 不新增通用 capability side-effect extension、Gateway、数据库 schema、配置或 feature flag。
- 不把 invocation idempotency 扩大为跨调用或按记忆内容去重。
- 不修改 `search_memory`、`get_memory_detail` 的 replay policy 或读操作副作用，也不在本 change 重构通用 runtime replay guard 与 risk-policy 的职责分配。
- 不披露页面上下文、RAG 来源或异步学习结果。

验收要点：

- Contract：session/channel DTO shape、非法字段、字段缺失时省略和模型上下文不含终态 metadata。
- Core：可信回执在 hook 前剥离、非可信同名字段失败、L2 只在下一次模型调用时提升，累计 disclosure 大小不改变 memory tool 执行结果。
- Runtime：调用结果不确定时用原 invocation key 恢复且 Store 只写一次；最终规范化 COMPLETED 且执行未从 durable facts 重建时写入 disclosure，恢复执行及 FAILED/CANCELED/SUPERSEDED 均省略，message/event 同事务同对象。
- Channel：SSE/WebSocket 与 owner conversation projection 一致，只投影完成终态的 disclosure；conversation share 服务端投影不包含任何 `memoryDisclosure`；非法披露不影响正文和终态。
- Frontend：owner live 完成后立即显示，刷新后内容一致，FAILED/CANCELED/SUPERSEDED 均无 footer，分组计数等于全量条目，三宿主复用同一组件；分享页收不到记忆披露数据。
- Full gate：OpenSpec strict、backend build/unit/contract/architecture、frontend build/Vitest/modes/Playwright 和 push 前模型语义 review。

并行边界：

- 前置 Gateway change 完成前不得实施本 change。
- 与 `stabilize-agent-web-popup-and-scroll` 可并行维护规格，但共享前端文件必须串行整合并重跑回归。
- 与 `add-ts-memory-application-contract` 可并行维护规格，但共享 `agent-contracts/channel` 文件必须串行整合；本 change 不复用或扩展 memory management port。
- `agent-contracts/session` 和 `agent-contracts/channel` 的核心契约升级确认已经完成；实施必须保持已确认的唯一 shape 和 owner 边界。
