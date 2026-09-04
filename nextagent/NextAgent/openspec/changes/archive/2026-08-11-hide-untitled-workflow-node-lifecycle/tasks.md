## 1. `FN-2.4 查看请求状态`

- [x] 1.1 在 `processDetailsProjection.test.ts` 建立无标题 Workflow 节点的失败复现：started-only 在聚合过程和完整时间线都不得显示技术身份，successful completion 加 `SUB_DETAIL` 后两条路径都只保留一个纯内容 occurrence；修改生产代码前运行测试并确认因 `active_delay` lifecycle 仍可见而失败。
  来源：`FN-2.4 查看请求状态` + `无业务标题的 Workflow 内部节点不得显示技术身份` + `无标题延时节点执行期间不显示技术标识`、`无标题节点完成后只显示正文`
  验证：在 `frontend/agent-web` 运行 `npm test -- processDetailsProjection.test.ts -t "hides untitled non-Capability Workflow lifecycle"`；预期修改前至少一个断言失败，且失败值包含额外 lifecycle 条目或 `active_delay`。
  结果：2026-08-07 使用 Node 22.22.2 运行，1 个目标用例按预期失败；received entry 标题为 `active_delay · 执行中`，证明缺陷复现有效。

- [x] 1.2 在同一测试文件修订 failed、timed-out、已有 structured title 和合法 `capabilityKind` 边界用例：无标题且无正文的节点不论成功失败均不显示；无标题有正文仅 successful 时显示不折叠纯正文，failed/timed-out 时 lifecycle 与正文均不显示；有标题节点保留实际状态，其他类别保持既有呈现。修改生产代码前运行并确认当前通用故障步骤和失败正文导致断言失败。
  来源：`FN-2.4 查看请求状态` + `无业务标题的 Workflow 内部节点不得显示技术身份` + `无标题且无正文的节点不论终态均不显示`、`无标题但有正文的失败节点不显示`、`已配置业务标题和 runtime Capability 保持既有呈现`、`实时与历史使用同一无标题规则`
  验证：在 `frontend/agent-web` 运行 `npm test -- processDetailsProjection.test.ts -t "applies title and detail visibility to untitled Workflow lifecycle"`；预期修改前 failure/timed-out 用例仍收到 `流程步骤` 或 matching detail，因此失败。
  结果：2026-08-08 使用 Node 22.22.2 完成 red/green 验证；修改前 failed、timed-out 两个目标用例均收到通用 lifecycle 故障步骤而失败，修改后 lifecycle 与 matching detail 均为空投影，live/history 结果一致。

- [x] 1.3 在 `processDetails.ts` 实现单一无标题 Workflow lifecycle 与 matching detail 可见性规则，并在 `buildProcessEntries` 与 `buildProcessTimelineEntries` 中复用；移除不再使用的通用“流程步骤”中英文文案，使所有无标题 lifecycle 隐藏、failed/timed-out matching detail 隐藏、有标题终态合并和 runtime Capability 路径不变。
  来源：`FN-2.4 查看请求状态` + `无业务标题的 Workflow 内部节点不得显示技术身份` 全部 Scenarios；`design.md / FN-2.4 查看请求状态 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- processDetailsProjection.test.ts -t "applies title and detail visibility to untitled Workflow lifecycle"`；预期所有矩阵用例通过，且输出中的用户可见 title/summary/detail 不包含 fixture 的 `nodeId`、`toolCallId` 或 `nodeType`。
  结果：2026-08-08 两个 builder 均复用可信 Workflow lifecycle 分类、structured title 索引和 failed/timed-out occurrence 集合；focused 矩阵测试通过，技术标识 negative assertion 通过。

- [x] 1.4 执行完整过程投影测试，确认 `TOOL`、`SKILL`、`AGENT`、`WORKFLOW` lifecycle、structured title/detail、live/history 和普通 Capability 技术名称降级无回归。
  来源：`design.md / FN-2.4 查看请求状态 / 修改方案` 与 `验证策略`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts src/features/chat/process/capabilityProcessTitle.test.ts`；预期全部通过且无未处理错误。
  结果：2026-08-08 使用 Node 22.22.2 运行，2 个 test files、122 个 tests 全部通过；仅有既存 `--localstorage-file` 环境 warning。

- [x] 1.5 增加同一 Workflow node occurrence 先产生 structured business title、随后成功或失败的回归测试，并在两个过程 builder 中把终态合并到该标题，保留 matching detail，禁止通用标题覆盖和重复 lifecycle/故障步骤。
  来源：`FN-2.4 查看请求状态` + `无业务标题的 Workflow 内部节点不得显示技术身份` + `有业务标题的节点失败时保留标题` + `有业务标题的节点成功时保留正文和实际状态`
  验证：在 `frontend/agent-web` 运行 `npm test -- processDetailsProjection.test.ts`；预期修改前新增用例收到 `流程步骤 · 已失败`，修改后 live/history 均只收到 `验证有标题失败状态 · 已失败`，完整时间线只保留一个同标题失败条目。
  结果：2026-08-08 使用 Node 22.22.2 完成三轮 red/green 验证：先复现失败节点被 `流程步骤 · 已失败` 覆盖，再复现成功终态未合并及有标题 detail 被 canonical completion/完整时间线丢弃；修复后 test file 的 88 个 tests 全部通过。

- [x] 1.6 为 `show_title=true`、`show_content=false` 的 generic、Capability-like 与 LLM 节点保留 body-free successful terminal lifecycle，使已有 structured title 显示实际完成状态，同时继续抑制正文 product。
  来源：`FN-2.4 查看请求状态` + `有业务标题但隐藏正文的节点仍显示成功状态`；`design.md / FN-2.4 查看请求状态 / 修改方案`
  验证：在仓库根目录运行 `npm test -- --run packages/agent-core/tests/workflow-runtime-event-projector.test.ts -t "show_content is false"`；修改前 3 个目标断言因缺少 `CAPABILITY_COMPLETED` 失败，修改后 lifecycle status 断言通过且 structured content 仍不存在。随后用真实 Workflow-as-Tool recipe 验证“等待指标采样窗口 · 已完成”。
  结果：2026-08-08 完成 red/green 验证；修改前 generic、Capability-like 与 LLM 三个目标断言均缺少 successful terminal lifecycle，修改后 focused 4 个 tests 及 projector 全文件 70 个 tests 全部通过，terminal lifecycle 保持 body-free 且无 structured content。重启 3201 后，真实 MiniMax Workflow-as-Tool 会话 `session-e4ee123e-9cfc-442d-a8c5-078b53c9d473` 在 live 与刷新后的 history 中均显示“等待指标采样窗口 · 已完成”。

## 2. Change 整体验证

- [x] 2.1 验证 OpenSpec change 的 Function 归属、Requirement delta、设计唯一实施路径和任务可执行性。
  来源：proposal `Function 影响（OpenSpec Capabilities）` + design `验证策略`
  验证：在仓库根目录运行 `openspec validate hide-untitled-workflow-node-lifecycle --strict`，预期退出 0；运行 `openspec validate --all --strict`，预期目标 change 通过且不增加 baseline failure；并通过 `$nextagent-skill-review` 语义检视。
  结果：2026-08-08 目标 change strict validation 退出 0，`nextagent-skill-review` 为 PASS，且无 `agent-contracts` 变更或需群内确认项。全仓 301 项中 299 通过、2 个既存 change 失败；本 change 明确通过。既存 `fix-conversation-preview-validation` 与 `fix-session-list-validation` 均因没有 delta 失败，与本 diff 无关。

- [x] 2.2 验证 Agent Web TypeScript、本地宿主和三宿主 Vite 产物，确认共享 chat workspace 代码可编译；本 change 不改变浏览器交互旅程，因此不运行 e2e。
  来源：proposal `影响范围` + design `验证策略`
  验证：在 `frontend/agent-web` 运行 `npm run build`、`npm run build:vite:local` 和 `npm run build:vite:modes`；预期均退出 0。
  结果：2026-08-08 使用 Node 22.22.2 运行，TypeScript build、local-auth Vite build 和 multi-host modes build 均退出 0；仅有既存 Ant Design module directive、chunk size 和 immersive preload script warning。

- [x] 2.3 对最终 diff 执行 NextAgent 模型语义检视，确认 frontend/browser ownership、OpenSpec consistency、安全、KISS、Clean Code 和 minimal-kernel non-regression；发现 P0/P1 时修复并重新验证。
  来源：proposal `目标与非目标` + design `修改方案`、`风险与取舍`
  验证：运行 `$nextagent-code-review`；预期结论为 `PASS` 或无 P0/P1 的 `PASS WITH FOLLOW-UP`。本任务不授权 push。
  结果：2026-08-08 结论为 `PASS WITH FOLLOW-UP`，无 P0/P1/P2 diff finding；检视期间发现并修复完整时间线误删有标题失败节点 matching detail 的问题，以及 `show_content=false` 同时丢失成功终态的问题。OpenSpec authoring gate PASS，公共 stream shape、frontend owner 和 frozen core contract 未变化；follow-up 为两个既存 OpenSpec baseline failure及两个与本 diff 无关的 contract baseline failure，本次不 push。

## 归档前更新基线检查（非实施任务）

归档时按照 `design.md` 的“长期基线刷新计划”更新 stable spec、`FN-2.4`、`F-2.4`、conversation process history architecture、agent-web module 和必要的 spec-to-design-map 验证入口；实施阶段不修改这些长期基线。
