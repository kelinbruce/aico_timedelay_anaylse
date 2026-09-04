## 0. 公共契约前置门禁

- [x] 0.1 完成 `CapabilityResultBoundary.arguments` additive `agent-contracts/runtime` refinement 的群内确认；确认字段只承载 executor 实际使用的有效输入、只读且不自动进入任何日志或输出投影后，实施任务才可开始
  来源：`FN-10.1 注册和执行钩子`；proposal `影响范围`；design `待确认问题`
  验证：无法自动化；code review 检查点为确认记录明确覆盖 public contract shape、trusted source、stage scope、mutation 禁止和输出隔离，且 design 的阻塞项已关闭
  结果：2026-08-12 用户明确确认 `CapabilityResultBoundary.arguments` 为 executor 实际使用的只读有效输入，仅提供给已激活的 `AFTER_CAPABILITY_RESULT` Hook，不自动进入日志、timeline 或公开投影；design 阻塞项已关闭

## 1. `FN-10.1 注册和执行钩子`

- [x] 1.1 先新增 contract/kernel 目标行为测试：`AFTER_CAPABILITY_RESULT` 必须取得 `BEFORE_CAPABILITY_INVOKE` mutation 后 executor 实际使用的 `arguments`；Hook 原地修改嵌套输入不得改变已完成调用或后续 Hook boundary；变更前测试必须因缺少该字段而失败
  来源：`FN-10.1` + 系统质量属性“安全、可测试性” + `Capability 结果后边界提供同次调用的有效输入` + `结果后 Hook 取得 executor 实际使用的输入`、`Hook 原地修改结果后输入不改变已成立事实`
  验证：`npx vitest run --config vitest.config.release.ts tests/contract/core-contracts.test.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts`；实施前预期新增断言失败，实施后预期全部通过
  结果：2026-08-12 实施前运行 `npm run typecheck` 退出码 1，新增 contract/kernel 断言分别因 `CapabilityResultBoundary` 不存在 `arguments`（TS2353/TS2339）失败；同次 typecheck 另有既存 `packages/agent-capability/tests/skill-manifest.test.ts:674` TS2554，留待整体验证单独核实

- [x] 1.2 扩展 `CapabilityResultBoundary`，在现有 tool loop 后置 Hook 调用点注入 `effectiveArguments`，并由 runtime 为每次结果后 Hook invocation 创建 arguments detached copy；保持 mutation whitelist、Capability request/result、timeline、terminal 和 Runtime 自动日志投影不变
  来源：`FN-10.1` + 系统质量属性“安全、可测试性” + `Capability 结果后边界提供同次调用的有效输入` + 全部 Scenarios；design `修改方案` 第 1–2 项
  验证：`npx vitest run --config vitest.config.release.ts tests/contract/core-contracts.test.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/logging.test.ts`；预期有效输入可见、隔离成立且日志不新增 raw arguments
  结果：2026-08-12 contract 单测 33/33 通过；release 定向组中的 core 与 logging 测试通过，有效 mutation 后入参和逐 Hook detached copy 断言成立

- [x] 1.3 先新增 Plugin SDK decision-table 测试：command 命中、args 命中、同时命中返回单一 `PASS`；大小写不同、非 Bash、非 string、仅其他字段命中和缺少 structured payload 返回 `SKIP`；命中结果必须与 payload JSON 语义等价且不含 mutation/control
  来源：`FN-10.1` + 功能性 Requirement `Northbound output normalization Hook 仅匹配目标 Bash action` + 全部 Scenarios；系统质量属性“安全、审计/可追溯性” + `Northbound Hook 原样返回已批准的 Bash 结构化结果` + `匹配结果按 JSON 语义原样进入 HookResult`、`缺少结构化结果时跳过`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-plugin-sdk/tests/northbound-output-normalization-hook.test.ts`；实施前预期因 subpath/factory 不存在而失败，实施后预期 decision table 全部通过
  结果：2026-08-12 实施前运行该命令退出码 1，suite 在导入阶段因 `../src/northbound-output-normalization-hook.js` 不存在而失败，符合红测预期

- [x] 1.4 在 `agent-plugin-sdk` 新增 `northbound-output-normalization-hook` subpath、固定 Hook ID 和无 host dependency plugin factory；只支持 `AFTER_CAPABILITY_RESULT`，使用 `CUSTOM + OBSERVE + CONTINUE`，按精确 predicate 返回 `SKIP` 或原始 `structuredPayload`，不自动激活
  来源：`FN-10.1` + `Northbound output normalization Hook 仅匹配目标 Bash action`、`Northbound Hook 原样返回已批准的 Bash 结构化结果` + 全部 Scenarios；design `修改方案` 第 3–6 项
  验证：`npm run build -w @nextagent/agent-plugin-sdk && npx vitest run --config vitest.config.release.ts packages/agent-plugin-sdk/tests/northbound-output-normalization-hook.test.ts packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-test-kit/tests/plugin-test-harness.test.ts`；预期 build、SDK 行为和 harness 回归全部通过
  结果：2026-08-12 SDK workspace build 退出码 0；SDK decision table、SDK 回归和 test harness 共 27/27 通过

- [x] 1.5 补齐真实 runtime/terminal integration negative cases：匹配 Hook 结果恰好一次进入同一请求终态；非匹配 invocation 不提供 `resultSummary`；非法或超限 payload 不产生部分结果、不改变 Bash 结果和 request truth；boundary arguments 不进入自动 projection
  来源：`FN-10.1` + 系统质量属性“安全、审计/可追溯性” + `Capability 结果后边界提供同次调用的有效输入` 的 `结果后输入不扩散到其他输出面`；`Northbound Hook 原样返回已批准的 Bash 结构化结果` 的 `结果超过既有容量边界时不部分输出`；design `验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-failure.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts tests/agent-kernel/run-status-visibility.test.ts`；预期匹配/排除/容量/终态断言全部通过
  结果：2026-08-12 连同 logging 回归运行 5 个文件共 86/86 通过；真实双 Bash 调用只为匹配项投影一个 resultSummary，非匹配项为 SKIP，HOOK_INVOKED 不含 arguments/boundary，既有非法与超限结果路径保持通过

- [x] 1.6 将 `command`/`args` 的固定 `action.py` 检查文本收敛为显式、非空的 `matchText` 配置；同一配置同时作用于两个字段，保持区分大小写的连续子字符串语义，并拒绝空白配置
  来源：`FN-10.1` + 功能性 Requirement `Northbound output normalization Hook 仅匹配目标 Bash action` + 配置相关 Scenarios；design `修改方案` 第 3–4 项
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-plugin-sdk/tests/northbound-output-normalization-hook.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts`；预期自定义文本 command/args 命中、旧固定文本不命中、空白配置失败且终态集成通过
  结果：2026-08-12 先运行目标测试得到 7 个预期失败，覆盖自定义文本未命中、旧固定文本仍命中和空白配置未拒绝；实现后两个测试文件 24/24 通过

- [x] 1.7 把 `matchText` 配置收敛到既有 Hook activation `configSchema + configure`，新增可加载的静态插件 artifact helper，并由 backend-capable 本地打包流程暂存到 `config/plugins/northbound-output-normalization-hook/`；不得自动声明或激活，frontend-only 不包含该后端资产
  来源：`FN-10.1` + Requirement `Northbound Hook 作为未激活插件资产随本地运行包交付` + 全部 Scenarios；design `修改方案` 第 3、6 项
  验证：`npm run build -w @nextagent/agent-plugin-sdk && npx vitest run --config vitest.config.release.ts packages/agent-plugin-sdk/tests/northbound-output-normalization-hook.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts tests/fullstack-packaging-boundary.test.ts`；预期 artifact、配置化执行、包内目录和未自动装配断言全部通过
  结果：2026-08-12 实施前定向组出现 18 个预期失败，覆盖 factory 仍持有配置、artifact helper 缺失和 pack staging 缺失；实施后 SDK build 通过，3 个定向文件 47/47 通过，生成的 `plugin.json + index.js` 同时通过 Node ESM import 和 NextAgent plugin loader，backend-capable staging、未自动声明/激活及 frontend-only 排除断言成立

- [x] 1.8 新增 northbound 插件真实产品路径 E2E：从生成的 artifact 经 system plugin config 加载，以 Agent activation 的 `matchText` 激活 Hook，通过 HTTP 请求驱动同一轮 `command` 命中、`args` 命中和不命中的 Bash Capability 调用，并只从请求终态断言命中结果原样进入 `resultSummary`、非命中为 `SKIP`、有效入参不进入 timeline 自动投影
  来源：`FN-10.1` + `Northbound output normalization Hook 仅匹配目标 Bash action`、`Northbound Hook 原样返回已批准的 Bash 结构化结果` + design `验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/northbound-output-normalization-plugin-product-path.test.ts`；预期 1/1 通过，插件不由测试直接注入，3 次 Bash 均经 sandbox boundary 执行且终态仅包含 2 个 `PASS + resultSummary`
  结果：2026-08-13 E2E 1/1 通过；生成的 `plugin.json + index.js` 经 system plugin config 加载，Agent activation 提供 `matchText`，HTTP 请求驱动 3 次 Bash sandbox execution，`command` 与 `args` 命中项各产生一个 `PASS + resultSummary` 且内容与 Bash structured payload JSON 语义等价，非命中项产生一个无 `resultSummary` 的 `SKIP`；3 条 `HOOK_INVOKED` timeline 投影均不含 `arguments` 或 `boundary`

## 1.5. effects 与 mutation 修正

- [x] 1.5.1 将 northbound-output-normalization-hook 的 `effects` 从 `OBSERVE` 改为 `TRANSFORM`，使 hook 走 impact 路径
  来源：环境验证发现 OBSERVE-only hook 的 mutation 被忽略
  验证：`npx vitest run packages/agent-plugin-sdk/tests/northbound-output-normalization-hook.test.ts`

- [x] 1.5.2 命中时同时返回 `resultSummary` 和 `mutation: { structuredPayload }`，使 boundary 中的 structuredPayload 被替换且 hookResults 包含结果
  来源：环境验证发现仅返回 resultSummary 无法修改 boundary
  验证：同 1.5.1

- [x] 1.5.3 修复 `requestContextId` 超 64 字符限制导致 `HOOK_INVOKED` 事件写入失败：使用确定性短哈希压缩
  来源：环境验证发现 stageOccurrenceKey 拼接后超长，emitEvent 抛异常被 catch 吞掉
  验证：`cd packages/agent-runtime && npx tsc --noEmit`

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、受影响 workspace、contract、architecture 与全仓常规门禁，并审查没有跨阶段缓存、private import、自动激活、raw arguments 自动输出或新的 northbound mapper
  来源：proposal `影响范围`；design `验证策略`、`风险与取舍`
  验证：`openspec validate add-northbound-output-normalization-hook --strict && openspec validate --all --strict && npm run build && npm test && npm run test:contract && npm run lint:architecture`；预期全部退出码为 0；随后以 `rg -n "northbound-output-normalization-hook|CapabilityResultBoundary|arguments" packages tests` 做模型语义检查，预期唯一实现路径与 design 一致
  结果：2026-08-12 在 `origin/main@d6a09cef3` 重新验证：`npm run build` 退出码 0；`npm test` 2072/2072、`npm run test:contract` 381/381、`npm run lint:architecture` 304/304 通过；change strict 与全仓 OpenSpec 258/258 通过；minimal-kernel/lifecycle 定向组 101/101、SDK/harness 27/27、定向 ESLint 与 `git diff --check` 通过。`nextagent-skill-review` 结论 PASS：Function-spec 映射、delta/stable operation、公共契约群内确认、架构 owner、唯一实施路径和端到端追踪一致；`nextagent-code-review` 结论 PASS：无 P0–P3 finding，未发现跨阶段缓存、private import、自动激活、raw arguments 自动输出或第二套 northbound mapper

- [x] 2.2 验证插件配置化修订后的 OpenSpec、SDK build、SDK/terminal 行为与回归门禁，并复核仅保留一个显式配置入口、没有默认匹配文本或第二套配置 owner
  来源：proposal `影响范围`；design `验证策略`、`风险与取舍`
  验证：`openspec validate add-northbound-output-normalization-hook --strict && npm run build -w @nextagent/agent-plugin-sdk && npx vitest run --config vitest.config.release.ts packages/agent-plugin-sdk/tests/northbound-output-normalization-hook.test.ts packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-test-kit/tests/plugin-test-harness.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts && git diff --check`；预期全部退出码为 0
  结果：2026-08-12 SDK build 通过；SDK/terminal 定向组 39/39 通过；全仓 build、UT 2075/2075、contract 381/381、architecture 304/304 和 OpenSpec 258/258 通过；`git diff --check` 通过。`nextagent-skill-review` 结论 PASS：`matchText` 是唯一显式配置，command/args 共用同一精确 predicate，未新增默认文本、第二套配置或 runtime 状态

- [x] 2.3 验证随包交付修订后的 OpenSpec、SDK、打包边界、release package layout 与全仓常规门禁，并审查没有默认激活、配置 owner 重复或 frontend-only 后端资产泄漏
  来源：proposal `影响范围`；design `验证策略`、`风险与取舍`
  验证：`openspec validate add-northbound-output-normalization-hook --strict && openspec validate --all --strict && npm run build && npm test && npm run test:contract && npm run lint:architecture`，并运行相关 release-package 定向测试；预期全部退出码为 0
  结果：2026-08-12 change strict 与全仓 OpenSpec 258/258 通过；全仓 build 通过，UT 2077/2077、contract 381/381、architecture 304/304 通过；`npm run test:e2e:release-package` 生成并解包自检 Win32 x64 候选包，release-package 5/5 通过并确认目标 `config/plugins` 文件存在；`git diff --check` 通过。`nextagent-skill-review` 结论 PASS：Function/spec 归属、四个 ADDED Requirements、Agent activation 单一配置 owner、backend-capable 交付、frontend-only 排除和不自动装配语义一致，无新增待确认契约项

- [x] 2.4 验证新增 E2E 后的 OpenSpec、类型构建、相关 Hook/terminal/packaging 回归和全仓常规门禁，并复核测试只断言产品黑盒结果、不复制 Hook 私有实现
  来源：design `验证策略`；AGENTS.md `验证门禁`
  验证：`openspec validate add-northbound-output-normalization-hook --strict && openspec validate --all --strict && npm run build && npm test && npm run test:contract && npm run lint:architecture && git diff --check`；预期全部退出码为 0
  结果：2026-08-13 change strict 与全仓 OpenSpec 265/265 通过；全仓 build 通过，UT 2098/2098、contract 387/387、architecture 307/307 通过；SDK/terminal/packaging/E2E 定向组 48/48 通过，Prettier check、typecheck 和 `git diff --check` 通过。`nextagent-skill-review` 结论 PASS：新增 E2E 直接追踪既有 Function/Requirements，复用 artifact loader、Agent activation、HTTP request、Bash Capability 和 terminal snapshot 的唯一产品路径，未新增行为、契约、owner、配置入口或私有实现断言

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”合并 stable spec、Function、Feature、overview、architecture、modules 与 spec-to-design-map；归档时以已完成前置 changes 合并后的最新 stable 为准，确认长期文档不重复定义 `CapabilityResultBoundary.arguments`、Hook predicate、`resultSummary` producer 安全责任或 terminal projection。
