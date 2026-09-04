## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.3 重试请求` | Retry 被接受后，当前轮次只投影权威新 attempt 的过程和答案 | `request-retry` | `FN-2.3 重试请求` |
| `FN-2.1 提交请求` | 未改变有效输入的 Edit 成为无副作用的 no-op | `request-edit-resubmit` | `FN-2.1 提交请求` |

## `FN-2.3 重试请求`

### 目标与规范依据

本设计落实 proposal 中“Retry 只展示同一 request 的当前 attempt”的目标。Runtime 已拥有 attempt lineage、replacement 可见性和 terminal commit；Agent Web 只消费已确认的权威 `runId`，不得重新判断哪个 attempt 在业务上有效。

#### 本 Function 的目标 Requirements

canonical spec：`request-retry`

- `MODIFIED`：`Retry 新 run 自动展开实时过程`

### 当前实现

- `requestStore` 在 Retry acceptance 后得到权威新 `runId`，并调用 `conversationStore.clearAssistantEnvelopesForRoot(..., { preserveRunId })` 清除当前内存层中的旧 assistant envelope 和 message。
- `conversationStore` 分别维护 history envelope、history message、active/settled live bucket、`displayProcessRunByRootBySession`、自动/显式 process-history target 和按 `runId` 缓存的 process history。
- `buildSessionProjection` 把 `displayProcessRunByRootBySession` 附着为轮次的 `displayRunId`；pending retry 会暂时清空被替换轮次的过程。
- `buildTurnBlocks.mergeHistoricalBlockWithSettledProcess` 先检查历史轮次是否已有 canonical assistant answer，再决定是否合入 settled answer。该检查未按 `runId` 限定，因此旧 attempt 的答案可以抑制新 attempt 的答案；同一处 capability-result lane 去重也可能跨 attempt 生效。
- live overlay 已使用 latest-attempt 选择，但 settled/history 合并没有统一使用显式当前 `displayRunId`，因此 live、会话切换和 reload 可能得出不同投影。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Retry acceptance 后只显示权威新 `runId` | 接受后清理部分内容层，但没有原子更新显示 run 和 process-history target | 旧 attempt 仍可能通过缓存目标或后续合并再次进入当前轮次 |
| 当前 attempt 的答案不被旧答案抑制 | canonical answer 存在性按整个轮次判断 | 去重边界错误地使用 `rootMessageId`，而不是当前 `runId` |
| Think、工具过程和阶段文字不跨 attempt 混合 | settled/history 路径只选择 settled 集合的 latest attempt | 历史轮次与 settled 集合合并前没有统一收敛到显式当前 attempt |
| live、切换返回和 reload 一致 | live 与 settled/history 使用不同 attempt 选择路径 | 缺少一个贯穿投影入口的当前 attempt 过滤规则 |

### 修改方案

`conversationStore` 继续作为浏览器会话投影状态的 owner。新增一个仅供 Retry acceptance 使用的前端私有动作，以 `{ sessionId, rootMessageId, acceptedRunId }` 为输入，执行一次不可分割的本地投影切换：

1. history envelope、history message、active live bucket 和 settled live bucket 中，该 root 只保留用户事实以及与 `acceptedRunId` 匹配的 assistant/process 事实；
2. 将 `displayProcessRunByRootBySession[sessionId][rootMessageId]` 设置为 `acceptedRunId`；
3. 删除该 root 指向其他 run 的自动和显式 process-history target，包括仍处于稳定窗口、尚未发布的自动目标；其他 root 的待发布目标保持不变，再发布更新后的目标集合；
4. 保留 `processHistoryBySession[sessionId][oldRunId]` 缓存，不删除后端或本地已加载的可追溯事实；这些缓存不再参与默认当前轮次投影；
5. 保留现有 pending suppression 和 acceptance 前失败恢复逻辑。

`requestStore.applyPendingConversationProjection` 仅在 Retry 已取得 HTTP 或权威 stream 确认的 `acceptedRunId` 后调用该动作。未确认 identity 时不得猜测新 run，也不得永久清除旧 attempt。

轮次构建统一采用以下顺序：

```text
selectedRunId = block.displayRunId ?? latestAttemptRunId(block + settled)
historicalCurrent = block.aiEvents filtered by selectedRunId
settledCurrent = settledAiEvents filtered by selectedRunId
result = same-run merge and dedup(historicalCurrent, settledCurrent)
```

用户 envelope 没有 `runId` 时继续作为轮次锚点保留。canonical assistant answer 和 capability-result lane 的存在性、合并和去重只针对 `selectedRunId` 的集合计算；不得以其他 attempt 的答案、lane 或 terminal 状态影响当前 attempt。没有显式 `displayRunId` 的旧数据继续沿用既有 latest-attempt fallback，以保持历史兼容。

分享页面继续读取创建分享时冻结的 snapshot，不复用普通会话的当前投影状态；本 change 不修改分享 loader。Fork child 的 Retry 仍使用 child session、child root 和后端确认的 child run，前端动作的 session/root 作用域禁止触达 parent。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 一致性、可靠性 | 无新增黑盒质量目标；由 `Retry 新 run 自动展开实时过程` 的功能性 Requirement 派生 | 单一权威 `runId` 驱动所有当前轮次投影层，同一 run 内合并去重 | live、切换返回、reload 的答案和过程一致；pending 失败恢复 |
| 性能/容量 | 无新增黑盒质量目标 | 只过滤单个 session/root 的既有内存集合，不新增网络请求，不清空跨 run 缓存 | 大会话下 Retry 不触发额外 history 全量加载或请求风暴 |
| 可追溯性 | 无新增黑盒质量目标 | 仅改变默认投影，保留旧 attempt 的后端事实和按 run 缓存 | 既有分享 snapshot 不变；新分享和普通会话显示当前 attempt |

## `FN-2.1 提交请求`

### 目标与规范依据

本设计落实 proposal 中“Edit 只在有效输入发生变化时替换完整 request”的目标。未变化 Edit 不转换为 Retry；文本或 Skill 定向变化继续沿用既有 Edit command 和 replacement 生命周期。

#### 本 Function 的目标 Requirements

canonical spec：`request-edit-resubmit`

- `MODIFIED`：`Agent Web SHALL expose edit only for the current latest turn`

### 当前实现

- 进入 edit 模式时，Composer 已持有原始用户文本；确认时由 `useChatComposerController` 调用 `requestStore.editRequest`。
- `requestStore.editRequest` 只拒绝空白文本，随后立即生成 identity、执行乐观替换并发送 Edit request；它不知道进入 edit 模式时的原始文本。
- `requestService` 在选择 Skill 时把定向信息注入提交内容，因此“文本相同但新选 Skill”是有效输入变化。
- controller 当前在 `editRequest` 返回后无条件退出 edit 模式、清空输入并显示成功提示，无法表达 no-op。
- 非空附件由既有 text-only Edit 边界拒绝，且必须保留用户输入和附件队列。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 未变化 Edit 不发送请求且不替换轮次 | 所有非空文本都会先乐观替换再发送 | 缺少乐观副作用之前的有效变化判定 |
| no-op 后保留 edit 模式和文本 | controller 无条件按成功路径收尾 | store 无法向 controller 区分 accepted 和 no-op |
| 新 Skill 定向仍提交 | 文本比较若独立实现可能误拦截 | 判定必须同时考虑 Skill 定向 |
| 非空附件继续走既有拒绝 | 未变化判定可能先于附件边界 | 判定优先级必须避免把附件失败误报为“内容未修改” |

### 修改方案

`requestStore.editRequest` 继续作为 Edit 提交和乐观替换的唯一入口。其前端私有选项增加进入 edit 模式时加载的 `sourceInputText`；该值来自当前 edit state，而不是重新从可变 history 投影推导。store 在生成 idempotency key、修改 conversation projection 或切换 request status 之前计算：

```text
unchanged =
  attachments.length === 0
  AND targetSkill is empty
  AND trim(inputText) === trim(sourceInputText)
```

判定结果如下：

| 条件 | 处理 |
|---|---|
| 输入为空白 | 保留既有空输入拒绝 |
| 附件非空 | 进入既有附件拒绝路径，不显示未修改提示 |
| `unchanged` 为 true | 不生成 request identity，不乐观替换，不调用 service；设置“内容未修改”提示并返回 no-op |
| 文本变化或选择新 Skill | 执行既有 Edit replacement |

返回类型继续使用 `RequestAccepted | null`，其中 `null` 表示没有提交；不新增公共 API 或跨 package contract。controller 只有在返回 accepted 结果时才退出 edit 模式、清理 Composer/附件并显示成功；返回 `null` 时保留 edit state、当前文本和焦点，由 store notice 提示用户。为避免把空输入与 no-op 混为一类，controller 仍使用既有输入校验，而 no-op notice 只由上述完整条件产生。

该方案不读取或改变 Retry 次数，不创建 retry command，不复用 Retry attempt 投影。正常 Edit、Fork 后 latest child Edit 及已有 attachment rejection 均保留原调用链。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 一致性 | 无新增黑盒质量目标；由 `Agent Web SHALL expose edit only for the current latest turn` 的功能性 Requirement 派生 | 有效输入比较集中在 store 的副作用入口，controller 只按结果收尾 | no-op 无 HTTP、无投影变化；文本或 Skill 变化仍提交 |
| 可测试性 | 无新增黑盒质量目标 | 比较输入由显式 `sourceInputText` 提供，不依赖隐式 DOM 或异步 history 查询 | store 和用户交互测试均覆盖 no-op 与正常 Edit |

## 跨 Function 协作与端到端流程

两个 Function 共享 Agent Web request control 入口，但不共享业务生命周期：Retry 按 `FN-2.3` 的方案在 acceptance 后切换同一 request 的 attempt；Edit 按 `FN-2.1` 的方案仅在有效输入变化时创建新 request。controller 不得把 Edit no-op 转为 Retry，也不得让 Retry 使用 Edit replacement。`fix-agent-web-fork-inherited-action-eligibility` 必须先归档，使其继承轮次入口目标态成为 stable baseline；本 change 随后归档其完整重述的 Edit Requirement。与 active change `harden-agent-web-request-acceptance-control` 集成时，后合入 change 需要在最新 `main` 上重新验证 pending identity、single-flight 和 terminal settlement，不能复制平行状态。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 一致性 | `FN-2.3` 与 `FN-2.1` 的本次功能性 Requirements | request control 入口明确区分 Retry attempt replacement、Edit request replacement 和 Edit no-op | 从用户操作到最终投影验证三条路径互不转换、互不污染 |
| 可测试性 | `FN-2.3` 与 `FN-2.1` 的本次功能性 Requirements | 以 service 调用、可见轮次、当前 run 和 Composer 状态作为黑盒观察点 | 组合回归覆盖正常 Edit、Retry、Fork child 和分享边界 |

## 验证策略（Verification Strategy）

- unit/characterization：构造同一 root 的旧、新 attempt，断言当前 run 的答案、Think、工具步骤和阶段文字不受旧 run 抑制或混入；同一 run 内重复事实仍按既有规则去重。
- store integration：断言 Retry pending 清除旧投影、acceptance failure 恢复、acceptance success 同时更新当前显示 run 与 history target，且不删除旧 run 缓存、不新增网络加载。
- component/store integration：断言未变化 Edit 不调用 service、不执行乐观替换、保留 edit mode 与文本并显示提示；文本变化、Skill 变化和附件拒绝分别保持既有行为。
- regression：复用分享 snapshot、Fork inherited retry/edit、普通 Retry/Edit 和多宿主前端测试，确认 session/root 作用域与既有公共行为不变。
- architecture/review：确认修改只位于 Agent Web 浏览器投影和 local view state，不新增或修改 Runtime、Gateway、stream、message、timeline、分享或 fork contract。
- negative case：跨 attempt 同内容/同 capability lane 不得去重；旧 canonical answer 不得抑制新答案；未变化 Edit 不得产生 HTTP、Retry 次数或隐藏副作用；parent session 不得被 child Retry 修改。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/request-retry/spec.md`：合并当前 attempt 隔离和多投影一致性行为。
- `openspec/specs/request-edit-resubmit/spec.md`：合并未变化 Edit no-op 行为。
- `openspec/designs/functions/D2-请求运行时/D2.1-请求提交与控制/FN-2.3-重试请求.md`：刷新 Retry 当前 attempt 的可见结果与关键规格摘要。
- `openspec/designs/functions/D2-请求运行时/D2.1-请求提交与控制/FN-2.1-提交请求.md`：刷新 Edit 有效变化边界与关键规格摘要。
- `openspec/designs/features/D2-请求运行时/D2.1-请求提交与控制/F-2.3-重试请求.md`：仅在 Function 规格刷新导致 Feature 摘要失真时更新。
- `openspec/designs/features/D2-请求运行时/D2.1-请求提交与控制/F-2.1-提交请求.md`：仅在 Function 规格刷新导致 Feature 摘要失真时更新。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/request-run.md`：补充浏览器当前 attempt 投影边界，不改变 Runtime lineage。
- `openspec/designs/modules/agent-web.md`：补充 Agent Web Retry 投影 owner 与 Edit no-op 边界。
- `openspec/designs/adr/request-retry-replacement-attempt.md`：无；既有 replacement 决策不变。
- `openspec/designs/spec-to-design-map.md`：若新增验证入口则刷新对应两项导航，否则无。

## 风险与取舍（Risks / Trade-offs）

- history message 的 visibility 是后端权威事实，而当前 attempt 是前端默认展示选择。修复只过滤当前内存投影，不回写 visibility；重新加载依靠 authoritative message 顺序选择最新可见 assistant run。相关 reload 回归必须防止旧 attempt 因乱序再次成为当前 run。
- 保留旧 run process-history 缓存会占用与修复前相同的内存，但避免重新加载分享、审计或显式历史详情时丢失本地事实；session 缓存淘汰继续负责容量上限。
- `harden-agent-web-request-acceptance-control` 与本 change 共享 requestStore 修改面，可能产生文本冲突；不通过复制 pending 状态规避冲突，后合入方必须 rebase 并重跑组合验证。
- `fix-agent-web-fork-inherited-action-eligibility` 尚未归档；若归档顺序颠倒，可能由旧 delta 覆盖本 change 对同一 Edit Requirement 的完整目标态。以“先归档该 change，再归档本 change”消除顺序风险。

## 待确认问题（Open Questions）

无。
