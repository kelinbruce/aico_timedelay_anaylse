## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `conversation-share` | 分享 run 解析从逐条 `loadRun` 迁移到单次 `listRuns` 批量查询；前端勾选选中数量上限 100 | `conversation-share` | `conversation-share` |

## `conversation-share`

### 目标与规范依据

本设计将对话分享创建和查看路径的 run 记录解析从 N 次单记录 gateway 查询收敛为一次批量查询，并在前端勾选阶段补齐 100 上限，使所选 runId 集合与 `listRuns` 单页容量对齐。现有分享行为契约（scope 隔离、attempt 精度、fork copied run anchor 回退、safe error 语义）保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`conversation-share`

- `MODIFIED`：`Frontend share interaction behavior`（补充勾选 100 上限）
- `ADDED`：`分享 run 解析使用批量查询`

### 当前实现

- `ConversationShareService.createShare`：先一次性分页加载全部 readable messages（`loadReadableMessages`，每页 200），然后对 `command.runIds` 循环调用 `resolveShareUnit`。
- `ConversationShareService.loadSharedConversation`：加载 frozen creator scope 的 readable messages 后，对 `shareRecord.runIds` 去重循环调用 `resolveShareUnit`。
- `resolveShareUnit`（`conversation-share-service.ts:286`）对每个 `selectedRunId` 调用一次 `this.deps.runStore.loadRun({ tenantId, subjectId, agentId, runId })`，用返回的 `RequestRunRecord` 完成：
  1. 判定 run 是否存在（`run === undefined` → fork copied run anchor 回退分支）。
  2. 校验 scope 与 session 归属（`run.tenantId/subjectId/agentId/sessionId` 与当前 scope 一致）。
  3. 取 `run.requestId` 锚定 attempt 精度 messages。
- 前端 `ChatPage.handleToggleShareSelection`（2280 行）：`setSelectedRunIds` 只做 add/delete，无 size 上限。
- 前端 `ChatPage.handleToggleSelectAll`（2296 行）：全选直接 `new Set(selectableRunIds)`，无上限截断。
- 后端 `createShareBody` schema 已有 `runIds: maxItems: 100`（`WEB_SHARE_RUN_IDS_MAX_ITEMS`），但前端勾选阶段无对应约束，超过 100 只在提交时被 400 拒绝。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 分享解析使用一次批量 gateway 查询 | `resolveShareUnit` 循环内逐条 `loadRun` | 缺少循环前批量查询 + Map 构建 |
| 前端勾选选中数量 ≤ 100 | 前端勾选无上限，仅后端 schema 兜底 | 缺少勾选阶段上限 + 提示 |
| 批量解析与逐条解析行为等价 | — | 需保证 fork 回退、scope/session 校验、attempt 精度语义不变 |

### 修改方案

#### 后端：分享服务迁移到 listRuns

1. `createShare` 和 `loadSharedConversation` 在调用 `resolveShareUnit` 前，MUST 一次调用 `listRuns({ tenantId, subjectId, agentId, runIds, offset: 0, limit: runIds.length })`，构建 `runById: Map<RequestRunId, RequestRunRecord>`。其中 `loadSharedConversation` 的 `runIds` 为去重后的集合，与原代码 `new Set(shareRecord.runIds)` 一致；`createShare` 的 `runIds` 为 `command.runIds`（原代码不去重，迁移后保持一致）。

   - 分享所选 `runIds` 受前端 100 上限约束（见下），`limit: runIds.length` 恒满足 `1..100` 约束，单页即可解析全部选中 run，不需要分页循环。
   - `listRuns` 自身按 `tenantId/subjectId/agentId` 过滤并对 `runIds` 去重，结果稳定排序（`createdAt DESC, runId DESC`），Map 构建不依赖顺序。
   - `loadSharedConversation` 原代码用 `new Set(shareRecord.runIds)` 去重后循环，迁移后 listRuns 查询前同样去重，保证 `limit` 不超过 100 且 Map 不含重复 key；`createShare` 原代码不去重，listRuns 内部去重不影响结果，行为等价。

2. `resolveShareUnit` 签名改为接收 `runById: ReadonlyMap<RequestRunId, RequestRunRecord>`，从 Map 取 `runById.get(selectedRunId)` 替代循环内 `loadRun`。

   - `runById.get(selectedRunId) === undefined` 时，MUST 进入原 fork copied run anchor 回退分支（依赖 selected run messages 的唯一 `requestId` + assistant answer），语义与原 `loadRun === undefined` 完全一致。
   - `runById.get(selectedRunId)` 命中时，MUST 沿用原 scope/session 校验（`run.tenantId/subjectId/agentId/sessionId` 与当前 scope 一致）和 attempt 精度逻辑。
   - `listRuns` 已按 `tenantId/subjectId/agentId` 过滤，跨 scope 的同值 runId 不会出现在页中，因此 Map 缺失即等价于原 `loadRun` 对跨 scope run 返回 `undefined` 的回退路径。

3. `resolveShareUnit` 其余逻辑（`selectedRunMessages` 过滤、`attemptMessages` 过滤、`userMessages` 唯一性、`hasAssistantAnswer`、`hasMismatchedRequest`）保持不变。

4. 消息加载 `loadReadableMessages` 的分页批量逻辑（每页 200）保持不变；本次只迁移 run 记录的逐条查询。

#### 前端：勾选 100 上限

1. `agent-web` 新增常量 `SHARE_RUN_IDS_MAX_ITEMS = 100`，放 `src/constants/inputLimits.ts`（与 `LONG_TEXT_THRESHOLD` 同位置），与后端 `WEB_SHARE_RUN_IDS_MAX_ITEMS` 同值，不跨包 import（遵守前端独立 package 边界）。

2. 勾选上限逻辑 MUST 提取为纯函数放 `src/features/chat/presentation/shareSelection.ts`（与已有 `resolveShareableRunId` 同模块，该模块已声明为 TurnBlock 与 ChatPage 共享的 single source of truth）：
   - `toggleShareSelection(prev: ReadonlySet<string>, runId: string, maxItems: number): { next: ReadonlySet<string>; rejected: boolean }`：已勾选时取消；未勾选时若 `prev.size >= maxItems` 则 `rejected=true` 且 `next=prev`，否则新增。
   - `selectAllShareable(selectable: ReadonlySet<string>, maxItems: number): { next: ReadonlySet<string>; truncated: boolean }`：`selectable.size > maxItems` 时取前 `maxItems` 个并 `truncated=true`，否则全选 `truncated=false`。
   - 提取纯函数的原因：`handleToggleShareSelection` / `handleToggleSelectAll` 是 `ChatPage.tsx` 内的 `useCallback` 闭包，`ChatPage` 无单元测试文件且 `tests/share-selection-mode.test.tsx` 用 mock 替代 toggle 回调，无法直接断言上限逻辑；纯函数可被单元测试直接覆盖，符合 AGENTS.md 可测试性要求与 `resolveShareableRunId` 既定惯例。

3. `ChatPage.handleToggleShareSelection` / `handleToggleSelectAll` 改为调用上述纯函数，根据返回的 `rejected` / `truncated` 标志决定是否给出 `message.warning` 提示。

4. `ShareModeBar` 选中计数展示对齐上限（如显示 `已选 N/100` 或达到上限时禁用继续勾选的视觉反馈），确保用户在勾选阶段即感知上限。`ShareModeBar` 接收 `maxItems` prop 或直接 import 常量用于计数展示。

#### 等价性论证

| 原 `loadRun` 行为 | 迁移后 `listRuns` + Map 行为 | 等价 |
|---|---|---|
| run 存在且同 scope/session | `runById.get(runId)` 命中，scope/session 校验通过 | ✓ |
| run 跨 scope（不存在于当前 scope） | `listRuns` 不返回该 run，Map 缺失 → fork 回退分支 | ✓（原 `loadRun` 也返回 undefined → 回退） |
| fork copied run anchor（无 RequestRunRecord） | Map 缺失 → fork 回退分支 | ✓ |
| run 跨 session（同 scope 不同 session） | Map 命中但 `run.sessionId !== scope.sessionId` → 返回 null | ✓ |

### 质量属性设计（Quality Attributes）

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `分享 run 解析使用批量查询` | N 次串行 gateway 调用降为 1 次；前端勾选上限与批量单页容量对齐 | 选中多 run 时 `listRuns` 只调用一次；前端勾选 ≤100 |
| 可靠性/恢复 | 现有 safe error 语义不变 | `SHARE_RUN_NOT_RESOLVABLE` / `SHARE_CONTENT_DELETED` 行为不变 | 迁移后既有分享场景测试等价 |
| 安全 | scope 隔离不变 | `listRuns` 自带 Owner/Agent scope 过滤；resolve 保留 session 校验 | 跨 scope/session run 不可见 |
| 可测试性 | 批量解析可断言 | service 通过真实 SQLite gateway 测试，可断言 `loadRun` 不被循环调用 | 负例：mock spy 断言 `loadRun` 调用次数为 0 |
| 可维护性 | 消除 N+1 anti-pattern | 减少 gateway 远端调用次数 | `npm run lint:architecture` 不退化 |

### 备选方案（Alternatives Considered）

- **`Promise.all(runIds.map(loadRun))` 并发逐条查询**：仅改变并发方式，仍产生 N 次 REMOTE 请求，不解决限流阈值问题，且无法利用 `listRuns` 的单请求批量语义。不采用。
- **分页循环 `listRuns`**：分享所选 runId 集合受前端 100 上限约束，单次 `listRuns(limit: runIds.length)` 即可解析全部选中 run，分页循环引入不必要的复杂度且 `listRuns` 单页已可达 100。不采用。
- **让 `listRuns` 不限 100**：`add-request-run-batch-query` 已将 `limit` 上限固化为 100 并写为 required 契约，本 change 不修改该契约。前端上限与该契约对齐是最小一致方案。

### 取舍与边界（Trade-offs）

- 前端 100 上限是硬约束：超过 100 必须截断或拒绝，因为 `listRuns` 单页上限 100 且分享 schema `maxItems: 100`。不允许通过分页循环绕过，否则回到多次查询。
- `resolveShareUnit` 的 fork 回退分支依赖 `runById.get(runId) === undefined`，与原 `loadRun === undefined` 语义同构；不引入额外的“存在但跨 scope”判定，因为 `listRuns` 已在查询层过滤。

### 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| createShare/loadSharedConversation 单次 listRuns | T1, T3.1, T3.2 | service 测试断言批量解析 + loadRun 不被循环调用 |
| resolveShareUnit 从 Map 取替代 loadRun | T1 | service 测试 + loadRun 调用次数为 0 负例 |
| fork 回退语义不变 | T1, T3.3 | 既有 fork copied run 测试通过 |
| scope/session 校验不变 | T1, T3.4 | 既有跨 scope/session 测试通过 |
| 前端勾选 ≤ 100 | T2.2, T4.1 | `toggleShareSelection` 纯函数单元测试 |
| 全选截断 + 提示 | T2.3, T4.2 | `selectAllShareable` 纯函数单元测试 |
| 分享创建/查看行为等价 | T3.3, T3.4 | 既有分享测试全量通过 |
| 前端 build/test | T5.2 | `npm run build` + `npm test` in `frontend/agent-web` |

### 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/conversation-share/spec.md`（归档时在「Frontend share interaction behavior」补充勾选上限，并新增「分享 run 解析使用批量查询」requirement）。
- 架构和跨模块设计：无。
- 模块设计：无。
- ADR：无。
- 导航：无。

### 迁移与回滚（Migration / Rollback）

- 无数据迁移。service 解析方式和前端勾选逻辑改动对存量分享记录立即生效。
- `listRuns` 已由 `add-request-run-batch-query` 合入 main，LOCAL SQLite 已实现；REMOTE adapter 需已实现 `listRuns`（其为 required 契约），否则 runtime 升级时应阻止。
- 回滚即还原 service 与前端代码，不影响持久化数据。

### 待确认问题（Open Questions）

无。
