## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.11 从消息派生子会话` | provenance 标记重新承担前端操作禁用语义 | `session-fork-from-message` | `FN-1.11 从消息派生子会话` |
| `FN-2.3 重试请求` | 最新继承轮次 retry 入口被前端禁用 | `request-retry` | `FN-2.3 重试请求` |
| `FN-2.1 提交请求` | 最新继承轮次 edit 入口被前端禁用 | `request-edit-resubmit` | `FN-2.1 提交请求` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 原子 delta | 其他行为与未触及 Requirements 处理 | stable spec 与导航影响 |
|---|---|---|---|
| `request-retry` / `Agent Web 对可操作的最新轮次暴露 retry 入口` | `REMOVED` + `ADDED` `Agent Web 禁用继承 latest turn 的 retry 入口` | retry 次数上限、latest、transition 和失败投影 Requirements 原位保留；Scenario `后端拒绝继承轮次 retry` 随 REMOVED 一并移除，后端 inherited retry 的 negative case 仍由 runtime 测试覆盖 | stable spec 原位替换 Requirement；导航不变 |
| `request-edit-resubmit` / `Agent Web SHALL expose edit only for the current latest turn` | `MODIFIED` | edit 协调、replacement、权限和输入校验 Requirements 原位保留；Scenario `后端拒绝继承轮次 edit` 被移除，理由是前端禁用后该路径不再由用户界面触发，后端 inherited edit 的 negative case 仍由 runtime 测试覆盖 | stable spec 原位更新 eligibility；导航不变 |
| `session-fork-from-message` / `Copied message 携带继承 provenance 标记` | `MODIFIED` | 标记写入、透出、递归 fork 和模型上下文隔离行为保留；Scenario `标记不表达操作资格` 被替换为 `继承标记禁用前端 retry/edit`，理由是 provenance 标记重新承担前端操作禁用语义 | stable spec 原位更新；导航不变 |

以上来源与目标均位于既有 canonical specs，不发生跨 spec 迁移或 spec 退役。

## `FN-1.11 从消息派生子会话`

### 目标与规范依据

`forkInherited` provenance 标记重新承担前端操作禁用语义：当最新轮次携带该标记时，Agent Web MUST 禁用 retry/edit 入口。

#### 本 Function 的目标 Requirements

canonical spec：`session-fork-from-message`

- `MODIFIED`：`Copied message 携带继承 provenance 标记`

### 当前实现

fork 已通过 conversation message metadata 透出 `forkInherited`。Agent Web 的 session projection 将该字段投影到 `TurnBlock.forkInherited`。上一归档 change `fix-agent-web-fork-inherited-action-eligibility` 移除了下游交互层对该字段的操作禁用读取，使 provenance 仅用于诊断或展示。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 继承轮次 retry/edit 入口被前端禁用 | provenance 只用于展示，不禁用操作 | 用户可点击必然失败的 retry/edit |

### 修改方案

恢复 `forkInherited` 在 BubbleActions 和 useChatComposerController 中的操作禁用语义。`forkInherited` 的 message metadata、前端 contract 字段、projection 计算不改变，只恢复下游交互层对该字段的禁用读取。

保留字段且只恢复其消费，是最小且兼容的路径。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性、可测试性 | 无新增黑盒质量目标 | provenance 重新承担前端禁用，交互测试证明标记禁用操作 |

## `FN-2.3 重试请求`

### 目标与规范依据

最新继承轮次 retry 入口 MUST 被 Agent Web 禁用，并向用户展示说明性 tooltip。

#### 本 Function 的目标 Requirements

canonical spec：`request-retry`

- `REMOVED`：`Agent Web 对可操作的最新轮次暴露 retry 入口`
- `ADDED`：`Agent Web 禁用继承 latest turn 的 retry 入口`

### 当前实现

Composer controller 的 `canRetryLatest` 和 `showRetryLatestButton` 不排除继承轮次。TurnBlock 的 `retryDisabled` 只由 retry 次数上限决定，不读取 `forkInherited`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 继承轮次 retry 入口被禁用 | Composer 和 TurnBlock 均不禁用 | retry 入口可用但点击必然失败 |

### 修改方案

Composer controller 的 retry 可用性重新排除 `forkInherited === true`。TurnBlock 恢复 `retryBlocked = retryDisabled || forkInherited`，为继承轮次设置不可点击、低透明度、`not-allowed` 光标和专用 Tooltip。删除因本次修改不再使用的"暴露"文案，恢复禁用文案。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复、可测试性 | 无新增黑盒质量目标 | 前端禁用阻止必然失败请求，复用既有禁用视觉态 | 组件测试覆盖 `forkInherited: true` 禁用态 |

## `FN-2.1 提交请求`

### 目标与规范依据

最新继承轮次 edit 入口 MUST 被 Agent Web 禁用，并向用户展示说明性 tooltip。

#### 本 Function 的目标 Requirements

canonical spec：`request-edit-resubmit`

- `MODIFIED`：`Agent Web SHALL expose edit only for the current latest turn`

### 当前实现

Composer controller 的 `canEditLatest` 不排除继承轮次。TurnBlock 的 edit 按钮不读取 `forkInherited`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 继承轮次 edit 入口被禁用 | Composer 和 TurnBlock 均不禁用 | edit 入口可用但点击必然失败 |

### 修改方案

Composer controller 的 edit 可用性重新排除 `forkInherited === true`。TurnBlock 恢复 edit 按钮对 `forkInherited` 的 `aria-disabled`、不可点击回调、禁用光标、低透明度和专用 Tooltip。保留 older-turn 不提供 edit、空白输入拒绝和 Write permission guard。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复、可测试性 | 无新增黑盒质量目标 | 前端禁用阻止必然失败请求，复用既有 edit mode | 组件测试覆盖 `forkInherited: true` 禁用态 |

## 跨 Function 协作与端到端流程

`FN-1.11` 提供的 `forkInherited` 同时承担 provenance 和前端操作禁用两个职责。`FN-2.3` 和 `FN-2.1` 的前端入口读取该字段在请求到达后端前拦截，避免用户操作必然失败。后端 inherited retry/edit 路径不变，后端修复后可通过独立 change 重新放开。

## 验证策略（Verification Strategy）

- unit/component：验证带 `forkInherited: true` 的最新轮次 retry/edit 按钮呈现禁用态、点击不触发回调、hover 展示说明性 tooltip；同时 retry 次数上限等既有禁用条件继续生效。
- controller/integration：验证 Composer 对最新继承轮次禁用 retry/edit 入口。
- characterization：保留 projection 测试，证明 provenance 仍被读取并投影。
- negative case：较早轮次无 latest 操作、retry 上限禁用、transition/permission guard 继续由既有测试覆盖。
- architecture/OpenSpec：验证没有 Gateway、Runtime、Web API 或 schema 变更，并消除 stable spec 的相反约束。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/request-retry/spec.md`：移除"暴露"Requirement，合并新的禁用 Requirement。
- `openspec/specs/request-edit-resubmit/spec.md`：更新既有 edit eligibility，恢复 `forkInherited` 禁用。
- `openspec/specs/session-fork-from-message/spec.md`：恢复 `forkInherited` provenance 的前端禁用语义。
- `openspec/designs/functions/`：刷新 `FN-1.11`、`FN-2.3`、`FN-2.1` 的处理过程与结果摘要。
- `openspec/designs/features/`：刷新 `F-1.6` 的最新继承轮次操作说明。
- 其他 design 文档无变化。

## 风险与取舍（Risks / Trade-offs）

- 前端禁用阻止了后端 inherited retry/edit 路径被用户触发，即使后端修复后也需要独立 change 重新放开。
- `forkInherited` 同时承担 provenance 和操作禁用两个职责，存在关注点耦合，但在后端不可靠的前提下这是最安全的选择。
- 若测试 fixture 未真实携带 metadata，回归可能被遗漏；因此 component 测试必须以 `forkInherited: true` 驱动。

## 待确认问题（Open Questions）

无。
