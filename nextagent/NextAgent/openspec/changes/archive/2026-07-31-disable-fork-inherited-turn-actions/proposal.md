## 背景与问题（Why）

派生（fork）会话中，继承问答对的 turn 在 UI 上与正常 turn 无差别，retry/edit 按钮照常渲染。但 fork 规格规定 copied message 的 child `requestId`/`runId` 只是读取锚点，child session 没有对应 `RequestRun` 事实，retry 固定报 `REQUEST_RETRY_NOT_FOUND`、edit 固定报 `EDIT_LATEST_NOT_FOUND`——按钮必点必错，且错误文案对用户不可理解。

关键事实：前端 retry/edit 按钮只在 **latest turn** 渲染（`showLatestTurnActions = isLatest`），后端 retry/edit 也只接受 lane latest target。因此问题面被自然收敛为"刚派生、尚无新提问的 child session 的最新继承 turn"；用户在 child session 新提问后，按钮只出现在新 turn 上，retry/edit 完全正常。缺的是一个让前端识别"最新 turn 是继承 turn"的持久化信号：`forkNotice` 在 child 提交首条新消息后即消失，且规格禁止暴露 child anchor message id，前端刷新后无法区分继承 turn。

## 变更范围（What Changes）

- `session-fork-from-message`：fork 复制消息时，为每条 copied message 的 metadata 写入 child-owned provenance 标记 `forkInherited: true`（typed metadata，布尔值）。标记随既有 `messages.metadata` JSON 列持久化，随既有 conversation response 的 `metadata` 通道透出到 Web 前端；无新表、无 DDL、无 gateway contract 变更、无 Web schema 变更。递归 fork 时标记按同一规则写入 grandchild copied messages。不回填既有派生会话。
- `request-retry` / `request-edit-resubmit`：Agent Web 在 latest turn 携带继承标记时禁用该 turn 的 retry/edit 按钮（TurnBlock 与 Composer 入口），禁用态包含 `not-allowed` 光标、降低透明度和悬浮 Tooltip 原因说明；新提问产生的 turn 不受影响。后端 retry/edit 语义不变——若按钮被绕过，既有 not-found 安全错误仍是权威拒绝。
- 标记只用于浏览器投影禁用态，不进入模型上下文语义，不作为任何后端合法性判断依据（后端权威判断仍是 lane 事实）。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `session-fork-from-message`: 新增 copied message 继承标记的写入、语义与投影契约。
- `request-retry`: 新增 Agent Web 对继承 latest turn 禁用 retry 按钮的投影行为契约。
- `request-edit-resubmit`: 新增 Agent Web 对继承 latest turn 禁用 edit 按钮的投影行为契约。

## 影响范围（Impact）

- 代码：`packages/agent-runtime`（fork copy 注入 metadata 标记）、`frontend/agent-web`（projection 标记透传、TurnBlock/Composer 禁用态与 Tooltip、i18n）。
- API：无 schema 变更；conversation response 的 message `metadata` 多一个布尔 key（既有 `looseObject` 通道）。
- 存储：无表结构变更、无数据迁移；标记写在既有 `messages.metadata` JSON 内。
- 测试：runtime fork 标记写入与递归 fork 测试；前端 projection 标记、按钮禁用态与 Tooltip 测试。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- openspec/specs/session-fork-from-message/spec.md：由本 change delta 归档合并（继承标记）。
- openspec/specs/request-retry/spec.md、openspec/specs/request-edit-resubmit/spec.md：由本 change delta 归档合并（继承 turn 按钮禁用投影）。

长期背景：
- openspec/overview.md：无。

设计视图：
- openspec/designs/architecture/runtime-boundaries.md：无（fork materialization 职责不变，仅 copied message metadata 多一个标记 key）。
- openspec/designs/modules/agent-runtime.md：无（copy 投影职责不变）。
- openspec/designs/adr/<id>.md：无。
- openspec/designs/spec-to-design-map.md：无。

验证入口：
- `npm test -- ...agent-runtime` fork 标记测试、`frontend/agent-web` `npm test -- ...` projection/TurnBlock 测试与 `npm run build`。
