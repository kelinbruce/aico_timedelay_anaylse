## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.11 从消息派生子会话` | provenance 与操作资格解耦 | `session-fork-from-message` | `FN-1.11 从消息派生子会话` |
| `FN-2.3 重试请求` | 最新继承轮次可通过既有入口发起 retry | `request-retry` | `FN-2.3 重试请求` |
| `FN-2.1 提交请求` | 最新继承轮次可通过既有入口发起 edit | `request-edit-resubmit` | `FN-2.1 提交请求` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `request-retry` / `Agent Web 禁用继承 latest turn 的 retry 入口` | `FN-2.3` / `request-retry` | 来源 `REMOVED` + 目标 `ADDED` `Agent Web 对可操作的最新轮次暴露 retry 入口` | retry 次数上限、latest、transition 和失败投影 Requirements 原位保留 | `FN-2.3` 修改方案 | stable spec 原位替换 Requirement；导航不变 |
| `request-edit-resubmit` / `Agent Web 禁用继承 latest turn 的 edit 入口` | `FN-2.1` / `request-edit-resubmit` | 来源 `REMOVED` + 既有 eligibility Requirement `MODIFIED` | edit 协调、replacement、权限和输入校验 Requirements 原位保留 | `FN-2.1` 修改方案 | stable spec 原位合并 eligibility；导航不变 |
| `session-fork-from-message` / `Copied message 携带继承 provenance 标记` | `FN-1.11` / `session-fork-from-message` | 既有 Requirement `MODIFIED` | 标记写入、透出、递归 fork 和模型上下文隔离行为保留 | `FN-1.11` 修改方案 | stable spec 原位更新；导航不变 |

以上来源与目标均位于既有 canonical specs，不发生跨 spec 迁移或 spec 退役；实施前通过 OpenSpec active-change 检查确认不存在未协调的并行修改。

## `FN-1.11 从消息派生子会话`

### 目标与规范依据

`forkInherited` 继续提供 copied message provenance，但不得再被解释为 retry/edit 禁用事实。

#### 本 Function 的目标 Requirements

canonical spec：`session-fork-from-message`

- `MODIFIED`：`Copied message 携带继承 provenance 标记`

### 当前实现

fork 已经通过 conversation message metadata 透出 `forkInherited`。Agent Web 的 session projection 将该字段投影到 `TurnBlock.forkInherited`，该投影本身不改变后端数据。当前 Composer controller 和 TurnBlock 又读取同一字段并禁用 retry/edit，使 provenance 越过展示边界承担授权判断。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| provenance 只标识 copied prefix 来源 | projection 结果同时参与操作禁用 | provenance 与操作资格未解耦 |
| 保留现有 metadata 通道 | 类型和 projection 已稳定使用该字段 | 不应通过删除字段修复，否则会丢失来源信息并扩大变更 |

### 修改方案

保留 `forkInherited` 的 message metadata、前端 contract 字段、projection 计算和 projection 单元测试，不改变 Gateway、conversation API 或持久化。仅删除下游交互层对该字段的操作禁用读取，使 provenance 可继续用于诊断或展示，同时不形成客户端授权规则。

选择保留字段而只解除错误消费，是最小且兼容的路径；删除字段会扩大到 fork 写入、Web schema 和历史投影，不符合本 change 范围。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性、可测试性 | 无新增黑盒质量目标 | provenance 只在 projection 层保留，不再分叉 retry/edit 资格 | projection 仍能识别标记，交互测试证明标记不再禁用操作 |

## `FN-2.3 重试请求`

### 目标与规范依据

符合既有界面条件的最新继承轮次应使用普通 retry 入口，由后端现有 inherited retry 路径决定最终资格。

#### 本 Function 的目标 Requirements

canonical spec：`request-retry`

- `ADDED`：`Agent Web 对可操作的最新轮次暴露 retry 入口`

### 当前实现

Composer controller 在计算 `canRetryLatest` 和失败态 retry 按钮时排除 `latestTurnBlock.forkInherited === true`。TurnBlock 又把 `retryDisabled` 与 `forkInherited` 合并为 `retryBlocked`，并为继承轮次设置不可点击、低透明度和专用 Tooltip。两层判断会在请求到达后端前同时拦截。

后端 inherited retry 已由现有 runtime contract 和实现拥有，前端不需要创建新的 command、状态或 API。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 最新继承轮次满足其他条件时可发起 retry | Composer controller 直接排除继承轮次 | Composer 入口不可用 |
| retry 次数上限继续禁用 | TurnBlock 把上限与 provenance 合并 | 禁用原因边界混杂 |
| 后端执行权威资格校验 | 前端 provenance 提前拒绝 | 合法请求无法进入权威边界 |

### 修改方案

Composer controller 的 retry 可用性只依据是否存在 latest turn；失败态按钮只依据 latest status。TurnBlock 的 `retryBlocked` 只使用已有 `retryDisabled`，Tooltip 只在次数上限禁用时显示对应原因。用户点击后继续调用已有 `onRetry(rootMessageId)`，服务层、HTTP route 和错误协调均不修改。

删除因本次修改不再被产品路径使用的 fork 专用 retry 文案，避免保留不可达分支。既有 retry 上限、transition、latest target 和后端安全失败路径保持不变。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复、可测试性 | 无新增黑盒质量目标 | 单一入口逻辑复用后端权威 inherited retry；前端只保留已有界面 guard | 组件与浏览器测试覆盖 `forkInherited: true` 的点击请求、上限禁用和后端拒绝协调 |

## `FN-2.1 提交请求`

### 目标与规范依据

符合既有界面条件的最新继承轮次应使用普通 edit 入口，由后端现有 inherited edit path 决定最终资格。

#### 本 Function 的目标 Requirements

canonical spec：`request-edit-resubmit`

- `MODIFIED`：`Agent Web SHALL expose edit only for the current latest turn`

### 当前实现

Composer controller 在计算 `canEditLatest` 时排除继承轮次。TurnBlock 对 `forkInherited` 设置 `aria-disabled`、不可点击回调、禁用光标、低透明度和专用 Tooltip。两层判断使消息操作和 `/edit` 路径均无法进入既有 edit 模式。

后端 inherited edit、乐观替换、失败回滚和刷新协调已由既有 contract 和实现负责。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 满足 latest、非 transition 和 Write permission 时可 edit | controller 额外排除 provenance | Composer `/edit` 不可用 |
| 最新用户消息操作可进入 edit | TurnBlock 主动清空继承轮次点击回调 | 消息 edit 入口不可用 |
| 后端执行权威资格校验 | 前端 provenance 提前拒绝 | 合法请求无法进入权威边界 |

### 修改方案

Composer controller 的 edit 可用性只依据 latest turn 是否存在，继续由既有上层状态处理 transition 与权限。TurnBlock 始终按传入的 `onEdit` 渲染可点击操作，不再读取 `forkInherited` 设置禁用表现。点击后继续进入已有 edit mode，确认提交、乐观替换、失败回滚和安全错误展示均不修改。

删除因本次修改不再被产品路径使用的 fork 专用 edit 文案。保留 older-turn 不提供 edit、空白输入拒绝和 Write permission guard。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复、可测试性 | 无新增黑盒质量目标 | 复用既有 edit mode 与后端 inherited edit，不增加平行状态 | 组件与浏览器测试覆盖 `forkInherited: true` 进入 edit、提交请求和失败回滚不回归 |

## 跨 Function 协作与端到端流程

`FN-1.11` 提供的 `forkInherited` 只保留为 projection provenance。`FN-2.3` 和 `FN-2.1` 的前端入口不再消费该字段作资格判断，而是把用户操作送入既有 retry/edit 请求链；后端依据各自 stable specs 的 child-owned durable facts 作最终决策。该关系不新增共享状态或调用链。

## 验证策略（Verification Strategy）

- unit/component：验证带 `forkInherited: true` 的最新轮次仍能触发 retry/edit 回调，同时 retry 次数上限等既有禁用条件继续生效。
- controller/integration：验证 Composer 对最新继承轮次暴露 retry/edit，并继续复用既有服务入口和错误协调。
- e2e：使用真实 conversation metadata fixture 标记继承消息，验证 TurnBlock 与 Composer 操作实际发出既有 retry/edit HTTP 请求；覆盖 retry、edit 两条正常路径。
- characterization：保留 projection 测试，证明 provenance 仍被读取并投影，避免修复退化为删除数据。
- negative case：较早轮次无 latest 操作、retry 上限禁用、transition/permission guard 和后端安全拒绝继续由既有测试覆盖。
- architecture/OpenSpec：验证没有 Gateway、Runtime、Web API 或 schema 变更，并消除 stable spec 的相反约束。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/request-retry/spec.md`：移除旧禁用 Requirement，合并新的前端 retry eligibility。
- `openspec/specs/request-edit-resubmit/spec.md`：移除旧禁用 Requirement，更新既有 edit eligibility。
- `openspec/specs/session-fork-from-message/spec.md`：收窄 `forkInherited` 为 provenance。
- `openspec/designs/functions/`：刷新 `FN-1.11`、`FN-2.3`、`FN-2.1` 的处理过程与结果摘要。
- `openspec/designs/features/`：刷新 `F-1.6` 的最新继承轮次操作说明。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无；runtime、Gateway 和公共契约边界未变化。
- `openspec/designs/modules/`：如现有 Agent Web 模块文档记录 fork provenance 禁用逻辑，则删除该过期说明；否则无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- 前端不再提前拦截某些最终会被后端拒绝的继承操作，用户可能看到安全失败提示；这是把资格权威保持在后端的预期取舍，并避免客户端规则再次与 durable facts 漂移。
- `forkInherited` 暂时仍存在于 TurnBlock view model，即使本 change 后不参与操作资格；保留它可以维持 provenance 和兼容性，后续如无展示用途再通过独立 change 评估删除。
- 若测试 fixture 未真实携带 metadata，回归可能再次被遗漏；因此 e2e 必须以 `forkInherited: true` 的 conversation 响应驱动。

## 待确认问题（Open Questions）

无。
