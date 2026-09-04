## Why

用户从一条历史回复派生子会话后，界面能够看到复制来的完整历史，但当该继承轮次仍是子会话最新一轮时，retry 和 edit 会因为 copied run anchor 没有对应 runtime run 而失败。当前可视内容与可操作能力不一致：用户看到的是一轮完整对话，却必须先发送新问题才能继续调整它。

fork 的核心隔离要求是“子会话不得控制或回写 parent runtime”，而不是“复制来的输入永远不可再次执行”。系统可以把子会话中的继承轮次作为 child-owned 输入来源，创建新的 child runtime 请求，同时继续保持 copied run anchor 和 `FORK_SNAPSHOT` 为只读历史事实。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 刚派生的子会话中，最新继承轮次在尚无 child 新请求时可执行 retry 和 edit。
- retry/edit 均创建全新的 child-owned runtime 事实，不复用、不控制、不查询 parent run。
- inherited retry 是继承输入在 child 中的首次执行；成功后形成普通 child run，后续 retry/edit/cancel/recovery 使用既有正常语义。
- inherited edit 创建新的 child request，并以既有 edit replacement 语义隐藏 copied source request 的默认展示。
- inherited edit 被接受后，用户界面在实时生成、会话切换和重新加载时均只显示 replacement 轮次，不保留 copied answer 或其操作入口。
- retry 创建新的 child run 后，用户界面必须把该 run 作为新的实时执行过程自动展开，不得继承被替换 run 的折叠状态。
- retry 命令进入 pending 后，用户界面立即停止展示被替换 attempt 的过程；新 run 尚未返回或失败时不得把旧 think 误呈现为新执行的开头。
- 已有 fork 会话无需重新 fork 或数据回填，也可根据 durable child facts 获得相同行为。
- retry/edit 后，fork 继承轮次的既有分享与新分享遵循 `harden-conversation-share-replacement-consistency` 定义的一致性规则。
- 当递归 fork 复制的是 retry 结果时，分享读取可按 copied answer 的唯一 child request 找回 canonical 用户问题，不因二者 run anchor 不同而误报内容已删除。

**非目标：**

- 不让 copied run anchor 或 `FORK_SNAPSHOT` 变成 `RequestRun`、checkpoint、lane、pending input 或 active-run 状态。
- 不复制、链接、恢复或控制 parent `RequestRun`、`RequestContext`、checkpoint、timeline lifecycle、lane state 或 pending input。
- 不支持任意历史轮次 retry/edit；只支持满足最新继承轮次资格的目标。
- 不改变普通原生会话 retry/edit 的 attempt、latest-wins、idempotency、附件校验或并发模型。
- 不改变每个 request 至多 5 次 retry 的既有上限；inherited attempt `1` 是 child 原始首次执行，后续 attempt `2` 至 `6` 才计入 5 次 retry。
- 不为 edit 新增浏览器附件能力，不新增原子 latest CAS；继续采用既有 point-in-time optimistic preflight。

## What Changes

- 修改 fork 子会话的操作资格：当目标是当前最新继承轮次，且 child 尚无 fork 后用户请求或活动运行时，系统允许 retry/edit；其他 copied 历史轮次继续不可操作。
- 新增 inherited retry 语义：系统从 child copied 用户消息重建输入并创建 child 的首次真实请求运行；新 run 使用新的 `runId`、context、checkpoint 和 lifecycle facts，attempt 为 `1`，且不声明对 synthetic run anchor 的 retry lineage。
- 修改 inherited edit 语义：系统以 copied 用户消息作为编辑源，通过既有 edit-resubmit contract 创建新的 child request/run，并在接受后以 `EDIT_REPLACED` 隐藏 copied source request 的默认展示。
- 修正 inherited edit 的界面替换：edit 被接受后，copied 问题、回答和过程作为一个完整轮次退出默认展示，刷新前后保持一致。
- 修正 retry 的过程展示交接：同一 request/root 上的新 retry run 开始执行时，实时过程使用新 run 身份并自动展开。
- 修正 retry pending 窗口：点击后立即以新 attempt 的待接管状态替换旧过程展示，失败则恢复旧轮次。
- 保证 retry/edit replacement 后仍可继续派生：fork 统一重映射 canonical event payload 中的 message/request/run lineage，任何无法证明安全的 source-bound reference 均原子拒绝。
- 修正递归 fork 的分享读取：无真实 `RequestRun` 的 copied retry answer 通过其唯一 child-owned `requestId` 关联 canonical USER，分享范围仍锁定在冻结 session、selected run 和该 request。
- 修改操作失败边界：child 资格不满足、目标已不是最新、附件不可用、scope 不匹配或已存在 child runtime work 时，系统安全拒绝且不改变 copied history。
- 保持 parent session、parent runtime facts 和 copied process snapshot 只读隔离不变。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.6 基于历史回复新建会话`：刚派生的子会话可直接重试或编辑最新继承轮次，并从该轮输入继续独立演进。
- `F-2.3 重试请求`：retry 的用户可操作目标新增“尚未在 child 执行过的最新继承轮次”，其首次 child 执行完成后回归普通 retry 行为。
- `F-2.1 提交请求`：edit-resubmit 可把最新继承输入替换为新的 child request，不改变普通提交边界。
- `F-1.8 分享对话`：递归 fork 中 copied retry answer 与 canonical 用户问题使用不同 run anchor 时仍可形成完整只读分享。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.11 从消息派生子会话` → `specs/session-fork-from-message/spec.md`
  - 功能边界：child copied history 继续与 parent runtime 隔离，但最新继承轮次可作为 child 首次 retry/edit 的输入来源。
  - 系统质量属性：无新增黑盒质量属性。
  - 映射说明：canonical spec。
- `FN-2.3 重试请求` → `specs/request-retry/spec.md`
  - 功能边界：在普通 terminal committed latest run 之外，增加没有 `RequestRun` 的 child 最新继承轮次首次执行语义；首次执行后回归普通 attempt lineage；每个 retry 新 run 的实时过程使用独立展示状态并自动展开。
  - 系统质量属性：安全、可靠性/恢复。
  - 映射说明：canonical spec。
- `FN-2.1 提交请求` → `specs/request-edit-resubmit/spec.md`
  - 功能边界：edit-resubmit 的最新目标可为 child 最新继承 request；接受后仍创建新的 request 并执行既有 replacement。
  - 系统质量属性：无新增黑盒质量属性。
  - 映射说明：`request-edit-resubmit` 是 `FN-2.1` 的 canonical spec；FN-2.1 现有其他 specs 的职责不变，不新增多对多关系。
- `FN-1.15 查看分享的会话` → `specs/conversation-share/spec.md`
  - 功能边界：冻结 `runIds` 选择 copied retry answer 时，读取端以该 answer 的唯一 request identity 关联 canonical USER；不得扩散到同 session 的其他 request 或 run。
  - 系统质量属性：安全、可靠性/恢复。
  - 映射说明：`conversation-share` 是 `FN-1.15` 的 canonical spec。

## 影响范围（Impact）

- 用户界面无需新增操作类型；现有 retry/edit 入口在 backend 资格成立时可成功处理 fork 最新继承轮次。
- 既有 retry/edit Web API 形状和普通会话行为不变；安全错误继续使用现有 contract。
- runtime 需要识别 durable child fork source 与 copied request，而不能要求 synthetic run anchor 存在 `RequestRun`。
- 继承输入中的附件引用必须重新通过 child scope 可用性校验。
- 本 change 的实施准入依赖 `harden-conversation-share-replacement-consistency`，以保证 replacement 后的既有分享和新分享不出现残缺或丢失；同时依赖已完成实现但尚待归档的 `add-request-retry-attempt-limit`，避免并行修改 `request-retry` stable delta。
