## 1. `FN-4.3 装配上下文`

- [x] 1.1 在 `packages/agent-context-engine/tests/history-candidate-selection.test.ts` 增加纯文本 Retry 失败复现：同一 `requestId` 同时包含可见 root USER、`RETRY_REPLACED` 旧 terminal ASSISTANT、最新可见 terminal ASSISTANT 和下一轮 USER；目标断言只选择 root USER、最新 answer 与下一轮 USER。实施前运行并确认该目标用例因整轮被排除而失败。
  来源：`FN-4.3 装配上下文` + `Prior conversation preserves valid conversation boundaries` + `纯文本 Retry 保留最新有效轮次`
  验证：在仓库根目录运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/history-candidate-selection.test.ts -t "retains the latest visible pure-text retry attempt"`；修改实现前预期 FAIL，实际结果不得是 fixture、类型或环境错误。
  实施证据：实现前 exit 1；目标测试实际执行 1 项，received `["current-req"]`，缺少预期 `p-user` 与 `p-latest-terminal`。

- [x] 1.2 在同一测试文件增加生产同形 Tool Retry 和连续 Retry 失败复现：旧 attempt 的 assistant tool-use 为 `visible=false` 且没有 replacement reason，同 run capability result / terminal answer 使用 `metadata.visibility.reason="RETRY_REPLACED"`，最新 attempt 使用完整有序 Tool protocol；目标断言排除全部旧 runs 并原样保留最新 sequence。修改实现前必须确认目标用例因孤立旧 tool-use 而失败。
  来源：`FN-4.3 装配上下文` + `Prior conversation preserves valid conversation boundaries` + `Tool Retry 只保留最新完整协议序列`、`连续 Retry 排除全部旧 attempts`
  验证：在仓库根目录运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/history-candidate-selection.test.ts -t "retry attempt"`；修改实现前预期至少 1 项 FAIL，失败证据必须显示旧 hidden attempt 导致 candidate 缺失或污染。
  实施证据：生产同形 Tool fixture 修改后、实现修改前，目标测试 exit 1，实际 received `["current-req"]`，证明孤立旧 tool-use 使整轮 fail closed；rebase 到最新 `origin/main` 后目标文件 39/39 PASS。连续 Retry 用两个旧 run 的未标记 hidden tool-use 加已标记 result/terminal，最新第三个 run 的完整 Tool sequence 被原样保留。

- [x] 1.3 在同一测试文件建立 run-scope fail-closed 边界：非 `RETRY_REPLACED` reason 不扩展、缺少 `runId` 的 marker 只排除自身、完全没有 marker 时不猜测 replaced run、最新 attempt 缺少 capability result 或 terminal answer 时整轮排除、没有 marker 且未被替换的 `ASSISTANT_TOOL_USE visible=false` 仍能与匹配 result 组成合法协议。
  来源：`FN-4.3 装配上下文` + `Prior conversation preserves valid conversation boundaries` + `最新 attempt 协议不完整时继续 fail closed`、`其他 replacement reason 不使用 Retry 过滤规则`；design `FN-4.3 装配上下文 / 修改方案`
  验证：在仓库根目录运行目标文件并分别筛选 `missing runId`、`without a retry marker`、`fails closed` 与 `in-flight tool use`；边界 characterization 在实现前和实现后均必须符合各自 fail-closed 断言。
  实施证据：新增上述五类边界用例；rebase 到最新 `origin/main` 后 `history-candidate-selection.test.ts` 39/39 PASS。缺少 `runId` 时仅 marker 自身被排除；完全无 marker、非 Retry reason 和不完整最新协议均保持 fail closed；合法 hidden tool-use 仍与匹配 result/terminal 组成完整轮次。

- [x] 1.4 在 `packages/agent-context-engine/src/assembly/active-context-selector.ts` 实现唯一最小 delta：每个 prior raw unit 先从带 `RETRY_REPLACED` 且具有 `runId` 的非 USER records 收集 `replacedRunIds`，再排除这些 runs 的全部非 USER records 和所有精确 marker records；保留 root USER，随后复用现有 `isCompleteVisibleTurn(...)`。不得比较 attempt 顺序、时间或 `runId` 值。
  来源：`FN-4.3 装配上下文` + `Prior conversation preserves valid conversation boundaries` 的全部 Scenarios；design `FN-4.3 装配上下文 / 修改方案`
  验证：在仓库根目录运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/history-candidate-selection.test.ts`；预期新增 Retry 用例与全部既有 history candidate 用例 PASS，0 项失败。
  实施证据：selector 仅新增局部 `replacedRunIds` 收集、effective-unit 过滤和精确 reason helper；没有 attempt 排序、时间比较、`runId` 值比较或公共抽象。rebase 到最新 `origin/main` 后目标文件 39/39 PASS，Runtime-to-SQLite-to-Context owner-chain 集成用例 PASS。

- [x] 1.5 验证通用 selector 覆盖 Direct Workflow 边界且没有形成平行 owner：生产代码不得新增 Workflow、`PRODUCT_PROCESS`、attempt 排序、ActiveContextView 写入或 Gateway/contract 变更；Workflow terminal answer 继续只按普通 message refs 参与 prior turn。
  来源：`FN-4.3 装配上下文` + `Prior conversation preserves valid conversation boundaries` + `Direct Workflow Retry 不引入过程事件`；design `FN-4.3 装配上下文 / 修改方案`
  验证：运行 `git status --short` 并审查本 change 工作树文件，生产代码预期只包含 `packages/agent-context-engine/src/assembly/active-context-selector.ts`；运行 `rg -n "PRODUCT_PROCESS|targetRecipe|Workflow" packages/agent-context-engine/src/assembly/active-context-selector.ts` 预期无匹配；code review 确认 selector 输入仍只有 `ActiveContextView` message refs。
  实施证据：当前分支相对最新 `origin/main` 仅有一个本 change 提交，包含 selector、直接测试、owner-chain 集成测试和本 OpenSpec change；生产代码仅 selector。Workflow 关键词扫描 exit 1、无匹配；输入与分组仍使用同一 ActiveContextView message record 路径。

- [x] 1.6 运行 `FN-4.3` package 级回归，并补充真实 Runtime visibility 查询、SQLite 已隐藏消息语义与 Context Engine assembly 的 owner-chain characterization，确认新增候选不会破坏 budget、compression、SUMMARY、render 或其他 Context Engine 行为。
  来源：design `FN-4.3 装配上下文 / 质量属性影响`、`验证策略`
  验证：在仓库根目录运行新增 owner-chain characterization、`npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests` 与 `npm run build -w @nextagent/agent-context-engine`；预期新增 characterization 与受影响测试通过，TypeScript build 无错误；既有基线失败必须单独归因。
  实施证据：新增 `request-retry.test.ts` owner-chain characterization，使用真实 Runtime retry、SQLite test gateway 和 Context Engine public assembly，验证旧 tool-use 无 marker、同 run result/terminal 有 marker且后续只选 root USER、最新 terminal 与 follow-up；rebase 到最新 `origin/main` 后与 selector 测试合计 50/50 PASS。`npm run build -w @nextagent/agent-context-engine` PASS；Context Engine release suite 356/357，唯一失败为既存 `skill-disclosure-render` 的 disclosure fixture，与 selector/Retry 无关，root `npm test` 1764/1764 PASS。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、backend contract 和 architecture 门禁，确认 change 没有公共契约、Runtime、Gateway、Workflow、Agent Web 或 persistence 变化。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`、`长期基线刷新计划`
  验证：`openspec validate fix-context-retry-latest-visible-turn --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；预期全部 exit 0。若全量命令存在基线失败，必须在同一 `origin/main` 快照复现并分别记录基线噪声与本 change 结果，不得把未知失败概括为通过。
  实施证据：rebase 到最新 `origin/main` 后 change strict PASS；`openspec validate --all --strict` 286/286 PASS；root `npm run build` PASS；root `npm test` 1764/1764 PASS；`npm run test:contract` 358/358 PASS；`npm run lint:architecture` 46 files、290/290 PASS；`git diff --check origin/main...HEAD` PASS。

- [x] 2.2 使用 `nextagent-code-review` 对最终 implementation diff 做模型语义检视，确认 Frozen core contract、Context Engine owner、KISS/单一路径、安全、OpenSpec 一致性、测试证据和 minimal-kernel non-regression；P0/P1 finding 清零后才能 push。
  来源：proposal `非目标`；design `FN-4.3 装配上下文 / 修改方案`、`验证策略`
  验证：审查结论必须为 `PASS` 或 `PASS WITH FOLLOW-UP`；若存在 P0/P1，预期结果为 BLOCKED 且不得 push。
  实施证据：2026-08-06 在最新 `origin/main` 上完成最终 OpenSpec semantic review，结论 PASS，`需群内确认=None`；proposal/design/spec/tasks 的 owner、精确 marker 规则、fail-closed 边界和唯一实现路径一致。最终 code review 未发现 P0/P1，结论 `PASS WITH FOLLOW-UP`：生产 diff 仅为 Context Engine selector 的局部过滤，真实 owner-chain characterization 覆盖 Runtime/SQLite 生产形态，Frozen contracts、安全边界和 minimal kernel 未改变；follow-up 仅记录既存 Skill disclosure fixture 基线债务，不阻塞本 change。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 `context-engine` stable spec、`FN-4.3` Function、`core-contracts` 和 `agent-context-engine` module 的长期事实；Feature、overview、request-run、ADR 和 spec-to-design-map 保持不变。归档前检查长期文档没有重复定义 attempt authority、visibility owner 或 Tool protocol 规则。
