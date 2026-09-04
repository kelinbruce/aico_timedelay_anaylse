## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.15 查看分享的会话` | 将冻结 `runId` 解析为完整、attempt 精确且安全可读的分享单元 | `shared-conversation-view`；来源 `conversation-share` | `FN-1.15 查看分享的会话` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `conversation-share` / `Shared conversation view Web API contract` | `FN-1.15` / `shared-conversation-view` | 来源 `REMOVED` + 目标 `ADDED` | 创建分享、有效期、页面路由、只读展示和会话清理 Requirements 原位保留；目标 Requirement 合并 `add-share-ops-hash-permission` 的 ops hash 等值校验最终语义 | 本 design 的 `FN-1.15` 修改方案 | 保留 legacy spec；FN-1.15 和行为导航改指新 canonical spec |
| `conversation-share` / `Owner scope controlled exception for share viewing` | `FN-1.15` / `shared-conversation-view` | 来源 `REMOVED` + 目标 `ADDED` | owner scope 受控例外的目标态整体迁移；来源其他 Requirements 原位保留 | 本 design 的 `FN-1.15` 修改方案 | owner-scope architecture 与 spec-to-design-map 改指新 canonical spec |

`add-share-ops-hash-permission` 当前修改来源 `conversation-share` 的同名查看 Requirement，因此它是本 change 的显式前置依赖。实施前先确认该 change 已完成并稳定其 ops hash 等值校验语义；本 change 再把合并后的最终 Requirement 原子迁移到 `shared-conversation-view`。归档前还必须确认没有其他未协调的 active change 修改上述两个 Requirements。来源 spec 迁移后仍非空，不退役。

## `FN-1.15 查看分享的会话`

### 目标与规范依据

本设计落实 proposal 中“分享在 retry/edit 后仍稳定呈现所选完整问答尝试”的目标，同时保持既有 URL、DTO、`runIds` 快照、ops hash 等值权限校验和 owner scope 受控例外不变。

#### 本 Function 的目标 Requirements

canonical spec：`shared-conversation-view`

- `ADDED`：`Shared conversation view Web API contract`
- `ADDED`：`Owner scope controlled exception for share viewing`

### 当前实现

- `agent-channel-web` 的分享查看路由调用 `RuntimeConversationSharePort.loadSharedConversation`，HTTP contract 与错误映射已经稳定。
- `agent-session` 的 `ConversationShareService` 先读取 `ConversationShareRecord`，完成有效期和 ops 校验，再通过 `SessionMessageStoreGateway.listMessages` 以创建者 scope 分页读取当前可见消息。
- 当前服务设置 `includeHidden:false`，随后只按 `shareRecord.runIds` 精确过滤消息；它既不知道所选 retry run 对应的 request，也不能读取因 retry/edit 替换而隐藏的冻结内容。
- 当前完整性检查只断言最终消息数组非空；多 run 分享中某个 run 缺失、或单个 run 只有问题/只有回答时仍可能返回 `200`。
- `RequestRunStoreGateway.loadRun` 已可按可信 owner scope、Agent Scope 和 `runId` 读取真实 `RequestRunRecord`，其中包含 `requestId`、`attempt` 和 `retryOfRunId`。fork copied run anchor 不对应 `RequestRunRecord`，但子会话 copied messages 保留相同 `runId`/`requestId` 分组。
- message 的 `visible` 与 `metadata.visibility.reason` 已承载 `RETRY_REPLACED`、`EDIT_REPLACED`、`GUARD_BLOCKED` 等可见性事实；本 change 不修改其 owner 或持久化形状。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 每个所选 retry attempt 包含同 request 的 canonical 用户问题和仅该 attempt 的回答 | 当前只按 `runId` 过滤 | 缺少真实 run 到 `requestId` 的解析，以及按角色组合完整单元的逻辑 |
| retry/edit 替换后既有冻结分享仍可读 | 当前 `includeHidden:false` | 缺少仅对替换隐藏原因开放的分享专用读取策略 |
| 任一所选单元不完整则整体失败 | 当前只检查总数组非空 | 缺少逐 `runId` 校验和原子失败投影 |
| 安全隐藏、未选回答和 parent session 不得泄漏 | 扩大到 hidden/read-by-request 会增加读取候选集 | 缺少候选消息的来源约束、隐藏原因白名单和最终精确投影 |
| 不改变公共分享 contract 与 gateway shape | 当前 service 只依赖 share/message store | 需要在不新增公共字段或 gateway method 的前提下获得真实 run 事实 |

### 修改方案

`ConversationShareService` 继续作为分享内容解析 owner。composition 为其注入既有 `RequestRunStoreGateway`；不新增 Web API、runtime contract、gateway method、Record、表或迁移。

服务在既有凭证、有效期和 ops 校验后执行以下唯一解析路径：

1. 以分享记录中的创建者 scope、`agentId` 和 `sessionId` 调用 `SessionMessageStoreGateway.listMessages`，分页读取 `includeHidden:true`、`includeCapabilityResults:true` 的候选消息。
2. 对每个冻结 `runId` 调用 `RequestRunStoreGateway.loadRun`：
   - 返回真实 `RequestRunRecord` 时，以其 `requestId` 选择 canonical `USER` 消息，以所选 `runId` 选择回答消息。
   - 返回 `undefined` 时，仅按子会话内相同 `runId` 选择 copied messages；这是 fork copied run anchor 路径，不追溯 `SessionForkSourceRecord` 或 parent session。
3. 对候选消息执行统一的分享可读判定：`visible=true` 可读；`visible=false` 时只有 `metadata.visibility.reason` 精确为 `RETRY_REPLACED` 或 `EDIT_REPLACED` 才可读；其他原因、缺失原因或非法 metadata 均不可读。
4. 每个单元必须恰好解析出一个 canonical `USER` message 和至少一条 `ASSISTANT` answer message；同一已选 attempt 中既有规则允许分享的其他 messages 保持当前投影。真实 retry 路径只补入同 request 的用户问题，不补入其他 attempt 的回答或 capability result。fork anchor 路径只使用同 anchor copied messages。
5. 任一单元失败即返回既有 `SHARE_CONTENT_DELETED`；全部成功后合并、按 `createdAt` 排序、按 `messageId` 去重，再调用分享 projection。通过 `RETRY_REPLACED`/`EDIT_REPLACED` 允许集合读取的消息只在分享 DTO 中归一化为 `visible=true`，同时剥离内部 `metadata.visibility`，不暴露 `hiddenByContextId` 且不回写 `SessionMessageRecord`；否则现有前端历史投影会继续过滤该消息。相同 canonical 用户问题被多个所选 retry attempts 引用时只返回一次，避免页面重复显示问题。

解析逻辑只使用现有 `SessionMessageRecord` 和 `RequestRunRecord`，不创建持久化 DTO。`selectedRunId` 来自 `ConversationShareRecord.runIds`，`requestId` 来自可信 `RequestRunRecord` 或 fork copied message，消息来自同一冻结创建者 owner scope、Agent Scope 和 session。服务在组装前校验这些坐标一致；解析结果不持久化、不跨 package 暴露。

本方案保留现有分享记录和创建流程。选择“读取时解析”而非创建时复制内容，是因为现有数据已包含 request/run/visibility 事实，且可以兼容已签发分享；内容复制表会引入新的删除、权限和存储生命周期，不属于本 change。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Owner scope controlled exception for share viewing` | 候选读取固定使用创建者四维坐标，最终投影使用隐藏原因允许集合并禁止 parent 查询 | 跨 scope、`GUARD_BLOCKED`、未选 attempt 回答和 fork parent negative cases |
| 可靠性/恢复 | 无新增黑盒质量目标；由 `Shared conversation view Web API contract` 的完整性行为派生 | 每个单元独立解析，任一失败统一返回既有错误，不产生部分成功 | retry/edit 前后既有分享、混合有效/缺失 run |
| 可测试性 | 无新增黑盒质量目标；由两个 MODIFIED Requirements 派生 | 解析 helper 保持确定性并通过既有 ports 注入事实 | unit 覆盖真实 run、fork anchor、隐藏原因和去重 |

## 验证策略（Verification Strategy）

- unit：以 `ConversationShareService` 的公开结果验证普通、retry、edit、fork、多 run 和缺失内容行为；断言完整 DTO 或既有 `SafeError`，不锁定私有 helper 形状。
- integration/contract：验证 route 状态码与响应 schema 不变，新增 `RequestRunStoreGateway` 注入不会改变未配置分享能力时的 `503`。
- architecture：确认 `agent-session` 只消费 gateway public ports，`agent-channel-web` 不读取 persistence，且没有新增 cross-package private import。
- negative cases：覆盖 `GUARD_BLOCKED`、未知隐藏原因、跨 owner/agent/session 坐标、未选 attempt 回答、fork parent 以及多 run 部分缺失。
- characterization：保留有效期、ops、排序、annotation 排除、既有 `CAPABILITY_RESULT` message 投影和已有公开分享行为。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/conversation-share/spec.md`：移除本次迁出的两个查看 Requirements，其他未触及 Requirements 原位保留。
- `openspec/specs/shared-conversation-view/spec.md`：新增 `FN-1.15` canonical spec 并合并两个 ADDED Requirements。
- `openspec/designs/functions/D1-会话与流式交互/D1.3-对话标注与分享/FN-1.15-查看分享的会话.md`：刷新处理过程和结果。
- `openspec/designs/features/D1-会话与流式交互/D1.3-对话标注与分享/F-1.8-分享对话.md`：刷新 retry/edit 后分享稳定性的用户可依赖结果。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/owner-scope-security.md`：刷新分享受控例外的最小读取范围和隐藏原因允许集合。
- `openspec/designs/modules/agent-session.md`：刷新分享内容解析职责与依赖。
- `openspec/designs/modules/agent-app.md`：若模块文档记录 service composition，则补充既有 run store 注入；否则无。
- ADR：无；本次没有改变既有 owner scope 受控例外决策。
- `openspec/designs/spec-to-design-map.md`：若验证入口或 module 导航变化则刷新，否则无。

## 风险与取舍（Risks / Trade-offs）

- `includeHidden:true` 扩大了服务内部候选集。通过创建者四维 scope、隐藏原因允许集合、逐单元精确投影和 negative tests 限制暴露面。
- retry attempt 需要逐个读取 `RequestRunRecord`，会增加至多与所选 `runIds` 数量相同的本地查询。创建 API 已限制非空数组但未定义上限；本 change 保持兼容，不引入新限制，后续若观测到容量问题应以独立性能 change 定义批量 port 或上限。
- 相同问题的多个 retry attempts 同时被分享时，按 `messageId` 去重会使问题只显示一次，但每个 attempt 的回答均保留；这与页面按消息时间序列渲染的现有模型一致。

## 待确认问题（Open Questions）

无。
