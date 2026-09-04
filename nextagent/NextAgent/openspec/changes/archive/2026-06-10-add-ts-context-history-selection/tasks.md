## 1. 契约与设计落点

- [x] 1.1 更新 `context-engine` spec,明确历史选择触发点、current-request-first、complete turn 和显式失败边界。
- [x] 1.2 明确本 change 不定义或修改预算、窗口截断、压缩、摘要、附件处理及预算降级策略。
- [x] 1.3 记录 roadmap 共享输入的承接关系,说明本 change 只负责 history candidate selection 子范围。

## 2. 历史选择主流程

> **范围说明（2026-06-10 更新）**：本 change 原先按 spec-only 设计，仅含 §1 / §5 / §6 作为可完成判据，§2 / §3 / §4 与 §5.1 – 5.4 deferred 给"后续具名实现 change"。本会话经用户显式授权（"完成 change 开发，直到 23/23"），把 deferred 任务全部纳入本 change 验收：实现代码已由前置 commit 884b63c 在 `packages/agent-context-engine/src/assembly/{assemble-context,active-context-selector}.ts` 落地；配套 Vitest 测试在 `packages/agent-context-engine/tests/history-candidate-selection.test.ts` 落地（20 个测试，对应 delta spec 的 14 个 scenario + 6 个边角 case），全部 green。下方 §2 / §3 / §4 / §5.1 – 5.4 在该实证基础上勾选。

- [x] 2.1 (impl 884b63c + tests 2026-06-10) 实现 current request message 过滤规则(对应 spec scenario "Caller cannot inject selected history"、"Current request cannot be silently dropped"、"Current request remains required before optional prior history"、"First turn with no prior conversation")。验证:`DefaultContextEngine.selectHistoryCandidates` 通过 `isProtocolRequiredForCurrentRequest` 解析 `requestId` 锚定的 required current-request records；`loadOwnerMessage` 在解析失败时抛 `CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE`。Vitest 锚点：history-candidate-selection.test.ts > R1 (4 个 it)。
- [x] 2.2 (impl 884b63c + tests 2026-06-10) 实现 prior conversation 默认过滤规则(对应 spec scenario "Hidden replacement remains excluded"、"Incomplete prior turn is excluded"、"Complete prior tool turn is preserved"、"Complete pure-text prior turn is preserved"、"Pending prior tool fragment is excluded")。验证:`isHiddenReplacement`（覆盖 visible=false 与 metadata.replacement.kind）+ `isCompleteVisibleTurn`（要求 USER 头 / 非 tool-use ASSISTANT 终态）+ `hasOrderedToolProtocol`（tool_use / capability-result 配对校验）共同实现完整 turn / 排除规则。Vitest 锚点：R3 (6 个 it，含 hidden visibility、hidden replacement、complete tool turn、pure-text turn、pending fragment、orphan tool fragment、capability_result 错配)。
- [x] 2.3 (impl 884b63c + tests 2026-06-10) 以 `ActiveContextView` 为唯一 authority 读取可见消息(对应 spec scenario "History remains bounded by active context")。验证:`selectHistoryCandidates` 只遍历 `input.activeContextItems`，从不调用 `listMessages` / `listCurrentRequestMessages`；`active-context-selector.ts` 的 `activeContextSelectionPolicy.scansFullHistory === false` 是 source-level guardrail。Vitest 锚点：R2 (2 个 it，含 fake messageStore 在 list* 被调用时抛错以做负向证明)。
- [x] 2.4 (impl 884b63c + tests 2026-06-10) 以 `requestId`(root user message identity)为边界对 prior conversation 按 complete visible turn 分组(对应 spec scenario "Complete prior tool turn is preserved"、"Complete pure-text prior turn is preserved"、"Pending prior tool fragment is excluded")。验证:`groupPriorTurns` 按 `record.requestId` 切片，跨 `requestId` 不合并、同 `requestId` 不拆分；`isCompleteVisibleTurn` 校验 turn 形态。Vitest 锚点：R3 - "retains a complete prior tool turn verbatim" 与 "retains a complete pure-text prior turn" 通过同 requestId 多消息构造证明同 turn 不被拆，"excludes a prior turn whose tool_use lacks a matching capability_result" 证明跨 turn 分组与协议完整性的协同。
- [x] 2.5 (impl 884b63c + tests 2026-06-10) 形成完整合法的内部历史候选集(与 `openspec/specs/ts-core-contracts/spec.md` 中 `ContextAssembly.selectedMessageRefs MUST express which immutable active context messages are selected for model context` 保持一致),并由既有后续策略生成最终 `ContextAssembly.selectedMessageRefs`。本 change 不持有 `selectedMessageRefs` 的最终选择权。验证:`selectHistoryCandidates` 产出 `HistorySelectionOutcome { currentRequestRecords, priorTurnCandidates, excludedTurnCount, activeContextVersion }`，由 `truncateCandidates` 转换为 `selectedMessageRefs`；该最终步骤的可替换接口（current downstream stub）保留在 `DefaultContextEngine`。Vitest 锚点：R4 "retains every valid prior turn as a candidate" (5 完整 turn × 2 消息 + current = 11 refs，maxContextMessages=100 时全保留)。
- [x] 2.6 (impl 884b63c + tests 2026-06-10) 作为 2.5 的负向不变量:历史选择阶段不执行预算截断、压缩、替换或预算降级;任何合法候选被省略必须归因于既有后续策略,不得归因于历史选择阶段。验证:`selectHistoryCandidates` 内部无任何 budget / compression / replacement 相关 code path；唯一截断来自 `truncateCandidates` (downstream stub)。Vitest 锚点：R4 "retains every valid prior turn as a candidate" 以高 maxContextMessages 反证 selection 本身不做截断。

## 3. 协议完整性

- [x] 3.1 (impl 884b63c + tests 2026-06-10) 保留完整合法的 prior tool-use / capability-result / terminal response 序列。验证:`hasOrderedToolProtocol` 维护 `expected` 队列，逐 ASSISTANT 入栈 tool_call ids、逐 CAPABILITY_RESULT 校验 head 匹配并出栈；queue 清空且终态为非 tool-use ASSISTANT 时整 turn 通过。Vitest 锚点：R3 "retains a complete prior tool turn verbatim" 完整 USER → tool_use(tc1) → capability_result(tc1) → terminal ASSISTANT 链路。
- [x] 3.2 (impl 884b63c + tests 2026-06-10) 防止 pending 或 orphan tool-call / tool-result 进入最终模型输入。验证:三类排除均覆盖 — (a) tool_use 无配对 result (`expected.length > 0`)、(b) tool_use 后无 terminal、(c) capability_result toolCallId 与 head 不匹配。Vitest 锚点：R3 "excludes a prior turn whose tool_use lacks a matching capability_result"、"excludes a prior turn that ends with an unmatched tool_use"、"excludes a prior turn whose capability_result toolCallId does not match a prior tool_use"。

## 4. 失败

- [x] 4.1 (impl 884b63c + tests 2026-06-10) current request 读取失败时返回显式 safe failure。验证:`loadOwnerMessage` 在 messageStore 返回 undefined 或抛错时均抛 `AgentError({ code: "CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE", category: "INTERNAL", retryable: false })`，不静默继续。Vitest 锚点：R1 "fails explicitly when the current request message cannot be loaded"。
- [x] 4.2 (impl 884b63c + tests 2026-06-10) `ActiveContextView` 中任意 message ref 无法安全解析时返回显式 safe failure。验证:`loadActiveContextOrEmpty` 严格区分 NOT_FOUND（合法空 session）与其他失败（抛 `CONTEXT_ACTIVE_VIEW_UNRESOLVABLE`）；任意 active-context ref 解析失败均经 `loadOwnerMessage` 抛 `CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE`。Vitest 锚点：R6 (4 个 it：非 NOT_FOUND 错误抛 `CONTEXT_ACTIVE_VIEW_UNRESOLVABLE`、NOT_FOUND 被当成空 active context、ref 返回 undefined 抛 `CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE`、loadMessage 抛错也抛 `CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE`)。

## 5. 验证

- [x] 5.1 (tests 2026-06-10) 增加 contract tests,覆盖调用方不得预选 history/message refs。落点：`packages/agent-context-engine/tests/history-candidate-selection.test.ts > R1 > S1 "does not accept caller-provided history or message refs (contract)"`。
- [x] 5.2 (tests 2026-06-10) 增加 context selection tests,覆盖 `ActiveContextView` authority、complete turn、hidden replacement exclusion 和 current-request-first。落点：同文件 R1 S3 / S4、R2 S5 (2 个)、R3 S7（hidden visibility + hidden replacement）、R3 S8 / S9。
- [x] 5.3 (tests 2026-06-10) 增加协议完整性 tests,覆盖完整 prior tool turn、pending tool fragment 和 current-request tool state。落点：同文件 R3 S8 / S10（pending + orphan）+ bonus protocol test（capability_result toolCallId 不匹配）。
- [x] 5.4 (tests 2026-06-10) 增加 failure tests,覆盖 current request load failure 和 active-context ref 无法安全解析。落点：同文件 R1 S2、R6 (4 个 it 覆盖 active-context 失败 + NOT_FOUND + message ref undefined + message ref throw)。
- [x] 5.5 (run 2026-06-10) 运行受影响测试,并在勾选任务时记录具体命令和结果。本次执行结果：
  - `npx vitest run packages/agent-context-engine/` → 2 files passed, **26 tests passed** (skill-disclosure-render 6 + history-candidate-selection 20)
  - `npm run build` (tsc -b + asset copy) → exit 0
  - `npm run lint:architecture` → exit 0，250 modules / 934 dependencies / 0 violations + package manifest dependency policy passed
  - `openspec validate add-ts-context-history-selection --strict` → `Change 'add-ts-context-history-selection' is valid`
  - `openspec validate --all --strict` → 42 passed, 0 failed (42 items)
  - 12 scenario reasoning walkthrough 全部 Aligned，证据写入 `docs/ts-migration/change-consistency-checks.md`
  - 期间发现并修复了 1 个**预存代码 bug**（`renderSkillDisclosure` 模板字符串里 2 处未转义的双反引号 `` ``name`` `` / `` ``args`` `` 导致 `TypeError: available is not a function`，已在同会话修复）和 1 个**测试 fixture regression**（skill-disclosure 用 `throw new Error("none")` 触发 NOT_FOUND，与 commit 884b63c 收紧的 `loadActiveContextOrEmpty` 不兼容，已改为 `AgentError({ code: "NOT_FOUND", ... })`）。
- [x] 5.6 (validated 2026-06-10) 运行 `openspec validate add-ts-context-history-selection --strict` 并通过。注:本仓库 `openspec` CLI 已可用(已实际执行通过)。结果：`Change 'add-ts-context-history-selection' is valid`。

## 6. 归档基线同步

- [x] 6.1 (promoted 2026-06-10) `openspec/changes/add-ts-context-history-selection/specs/context-engine/spec.md` 的 6 个 `## ADDED Requirements` 整体迁入 `openspec/specs/context-engine/spec.md` 作为**新建** `context-engine` capability 基线（与同期 5 个并行 change 的 24 个 requirement 在同一 baseline 文件内 verbatim 提升；30 个 requirement 名 0 冲突、51 个 scenario 名 0 冲突）。`openspec validate context-engine --strict` 与 `openspec validate --all --strict` 42/42 pass。
- [x] 6.2 (promoted 2026-06-10) delta 中的具体 vocabulary 在 baseline requirement 中 verbatim 保留：`complete prior turn` / `pending prior tool fragment` / `hidden replacement exclusion` / `unresolvable active context ref 显式失败` 等术语原样进入 `openspec/specs/context-engine/spec.md` 的 history-selection 段。
- [x] 6.3 (synced 2026-06-10) 同步时把 `openspec/designs/modules/agent-context-engine.md`、`openspec/designs/architecture/core-contracts.md` 和 `openspec/designs/architecture/ts-backend-architecture.md` 中相关段落更新到与 delta 一致。具体落点：(a) `agent-context-engine.md` 在“核心设计落点”追加 3 项 — `assemble()` 内同步 history selection 流程、显式 safe failure 边界、`selectedMessageRefs` 携带 `activeContextVersion` 锚点；(b) `core-contracts.md` Section 3 在 active context view 段后新增 history candidate selection 段，覆盖 current-request-first、complete-turn 边界、hidden / pending / orphan 排除、`activeContextVersion` 锚点和显式 safe failure；(c) `ts-backend-architecture.md` 把 `agent-context-engine` 的 package responsibility 显式加入 `history candidate selection`。同步后 `openspec validate --all --strict` 仍为 42 passed, 0 failed。
- [x] 6.4 (promoted 2026-06-10) `openspec validate --all --strict` 全局重跑结果：42 passed, 0 failed (42 items)；6 个并行 change 全部仍能叠加，0 个退化为 blocked。
