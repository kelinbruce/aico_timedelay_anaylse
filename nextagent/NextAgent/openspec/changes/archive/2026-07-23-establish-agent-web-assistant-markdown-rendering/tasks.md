## 1. 建立代码与测试证据

- [x] 1.1 核对已完成普通 assistant 正文的生产调用链和 owner，确认本 change 不需要修改生产代码。
  验证：code review 检查 `MessageList -> TurnBlockComponent -> buildAnswerContent -> splitProgressiveMarkdownContent -> MarkdownContent -> MarkdownWithTables`，并执行 `git diff -- frontend/agent-web/src` 确认生产目录无 diff。
  来源：Proposal 变更范围；Design D1、D2。

- [x] 1.2 给状态为 `COMPLETED` 的现有 GFM 表格测试补齐真实 `AppProviders` 装配，保留代码围栏内表格形状文本不生成 table 的 negative assertion。
  验证：`frontend/agent-web/tests/markdown-gfm-table.test.tsx` 的 10 个场景全部通过，其中 `does not convert table-shaped text inside ordinary code fences` 实际断言 table 不存在且 pre 存在；Requirement 证据只取语义/negative assertions，既有布局断言不属于本 capability。
  来源：Requirement“已完成普通 assistant 正文展示 GFM 风格 pipe table”和“已完成普通 assistant 正文中的已验证异常 pipe table 行保持可读表格”；Design D3、D4。

- [x] 1.3 新增状态为 `COMPLETED` 的普通 assistant Markdown/代码语义表征测试，不断言 parser/library 或精确视觉样式。
  验证：`frontend/agent-web/tests/assistant-markdown-rendering.test.tsx` 断言 heading、list、blockquote、strong、inline code 和 pre/code 语义结构。
  来源：Requirement“已完成普通 assistant 正文采用 Markdown 语义展示”；Design D4。

## 2. 边界与验证门禁

- [x] 2.1 完成 Stable/Active owner 和 forbidden scope review，确认 delta spec 不接管其他 owner 或已知安全冲突。
  历史验证（2026-07-14，当时尚未归档）：code review 逐项检查 `add-ts-tool-structured-delta`、`add-ts-expand-panel`、`agent-web-selfdefine-config`、`add-ts-task-channel`；检查 Requirement 不包含 Mermaid、sanitization、raw error logging、Capability result、ProcessPanel、answer actions、stream aggregation、精确 CSS/动画/缓存。该边界不能仅靠 source pattern 自动判定 owner 语义，因此使用上述具体人工检查点。当前 owner 以任务 3.2 的刷新结果为准。
  来源：Proposal 明确排除范围；Design D1、D5 和质量属性设计。

- [x] 2.2 运行两份 Requirement 定向测试并记录通过数量。
  验证：在 `frontend/agent-web` 执行 `npm test -- tests/assistant-markdown-rendering.test.tsx tests/markdown-gfm-table.test.tsx`。
  结果：2 files / 11 tests 全部通过。
  来源：三个 Requirements；Design Verification Map。

- [x] 2.3 对本 change 执行 strict validation。
  验证：`openspec validate establish-agent-web-assistant-markdown-rendering --strict`。
  结果：通过，change valid。
  来源：Design Verification Map。

- [x] 2.4 执行全量 OpenSpec strict validation，确认没有跨 change/spec 冲突。
  验证：`openspec validate --all --strict`。
  结果：191 passed / 0 failed。
  来源：Design Verification Map。

- [x] 2.5 执行前端 build 基线并记录结果；若仍命中本 change 之外的既有错误，必须写明文件、错误和无重叠证据，不得把 build 声称为通过。
  验证：在 `frontend/agent-web` 执行 `npm run build`，并将实际结果追加到本任务。
  结果：build 未通过；唯一错误为 `tests/useChatSessionStream.test.tsx:79` 的 `() => void` 不能赋给 `(envelope: StreamEnvelope) => boolean`。该文件和 `frontend/agent-web/src` 均无本 change diff，本 change 的两份测试通过 TypeScript 收集和 Vitest 执行；未跨边界修复该既有错误，也未把 build 声称为通过。
  来源：项目验证门禁；Proposal 的生产代码无变化范围。

- [x] 2.6 复核最终 diff、工作树和 `docs/reports/` 保护边界。
  验证：`git diff --check`、`git diff --name-only`、`git status --porcelain=v1 --untracked-files=all`，并重新计算两个既有 `docs/reports/*.html` 的 SHA-256 与计划基线比较。
  结果：`git diff --check` 通过；`frontend/agent-web/src`、Stable `openspec/specs/`、`TurnBlock.test.tsx` 和 `useChatSessionStream.test.tsx` 均无 diff。两个报告 hash 分别保持 `364E8AAA948D7AFB778D3D66417A623C42DB5D78EFD6A0DABFEA185D2C3116BA` 和 `F4FE879A3AC55DC8A4375DF2506AEF104B87B092D7529BFF57807E00B0FB2A4C`。
  来源：Proposal 影响范围；Design D2、D5。

## 3. 独立终审

- [x] 3.1 对代码、测试、proposal、spec、design 和 tasks 做独立 review；发现问题后修订并重新执行受影响验证。
  验证：review 必须分别给出实现一致性、Requirement 测试映射、Active owner 重叠、边界扩大和未归档生命周期结论；P0/P1 必须为 0，P2 必须修复或登记明确 follow-up。
  结果：第一轮 P1=1、P2=1，已分别通过 `COMPLETED` 边界收窄和语义证据说明修订关闭；独立复审 P0-P3 均为 0，结论 PASS。change 保持未归档。
  来源：执行计划第 4 节和第 7 节；Design 风险与取舍。

- [x] 3.2 刷新归档后的 Stable owner map。
  验证：确认 structured message/delta、Expand Panel 和 AICO answer actions 已分别由 `agent-web-structured-message-rendering`、`tool-structured-delta`、`agent-web-expand-panel`、`aico-piu-injection`/`aico-config-contract` Stable specs 拥有；确认 `add-ts-task-channel` 仍是独立 active owner；重新运行 change strict 与全量 strict。
  结果（2026-07-17）：owner map 已按当前 Stable/Active 状态刷新；本 change strict 通过，全仓 strict 202/202。本 change 仍只拥有已完成普通 assistant Markdown，不接管 structured、Expand Panel、AICO answer action 或 task transport。

## 4. 归档前更新基线检查

- [x] 4.1 按已授权的 Baseline Promotion Plan 更新长期 module 与导航。
  验证：只向 `openspec/designs/modules/agent-web.md` 合并 completed ordinary assistant Markdown/table 的 renderer 职责与 Mermaid 非职责，只在 `openspec/designs/spec-to-design-map.md` 增加 capability/test 导航；运行本 change strict、全量 strict、两份定向测试、Markdown 链接扫描和范围检查。
  结果（2026-07-17）：长期 module/map 已最小同步；2 files / 11 tests、change strict、全仓 202/202 和 Markdown 链接扫描通过。frontend build 的 4 个现有 TypeScript error 不在本 change diff 中，但仍阻塞统一归档门禁，因此本 change 保持 Active，未运行 archive。

- [x] 4.2 刷新当前归档证据，保留 4.1 的历史快照但不再将已修复的 build error 表述为当前阻塞。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/assistant-markdown-rendering.test.tsx tests/markdown-gfm-table.test.tsx` 和 `npm run build`；在仓库根目录运行本 change strict 与全量 strict。
  当前结果（2026-07-18）：2 files / 11 tests 通过，frontend build 通过，本 change strict 与全量 strict 通过；继续收口共享测试装配后，全量 frontend Vitest 为 278/278 files、1101/1101 tests 通过，且无生产实现 diff（`src` 下唯一 diff 是 co-located test）。全仓 architecture lint 仍有与本 capability 无重叠的 `agent-channel-web -> agent-contracts/gateway` 现有违规；该问题不改变本 change 的 renderer owner 或验证结论。本 change 保持 Active，未运行 archive。

- [x] 4.3 合并最新 main 后刷新已解除的仓库级门禁。
  验证：运行 frontend build、全量 frontend Vitest、全量 OpenSpec strict 和 architecture lint；保留 4.2 作为合并前历史快照。
  当前结果（2026-07-18）：frontend build、278/278 files / 1101/1101 tests、OpenSpec strict 207/207 均通过；architecture lint 为 dependency 0 违规、package manifest policy 通过、34 files / 207 tests 通过。原 Web channel/gateway 阻塞已由对应 committer 随 main 修复，本 change 未修改该实现。当前所有验证门禁绿色；本 change 保持 Active，仅因本轮未获授权执行 archive。

- [x] 4.4 基于当前代码再次确认 reverse-spec owner 和归档证据。
  验证：核对 `MessageList -> TurnBlockComponent -> buildAnswerContent` 的正文选择，以及 `TurnBlockComponent -> MarkdownContent -> MarkdownWithTables` 的渲染调用链；运行 completed ordinary assistant、GFM pipe table 和 code fence 定向测试，以及 frontend build、本 change strict、全量 strict、architecture lint 和 `git diff --check`。多问题 Pending Input、Mermaid、structured/Expand、stream aggregation 和安全清理继续由各自 owner 承载。
  当前结果（2026-07-23）：当前调用链与 capability 边界未漂移；assistant Markdown 与 GFM table 为 2 files / 11 tests 通过，frontend build 通过，本 change strict 和全量 strict 222/222 通过，architecture 为 36 files / 225 tests 且 dependency 零违规，`git diff --check` 通过。本轮未修改 `frontend/agent-web/src`、Stable specs 或其他 active change。
