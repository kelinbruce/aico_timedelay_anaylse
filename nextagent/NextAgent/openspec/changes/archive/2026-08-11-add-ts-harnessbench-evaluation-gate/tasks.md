## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 为标准入口、固定 commit、完整 task catalog 和 `full-suite` profile 建立失败优先测试：覆盖 106 个 task 恰好一一对应、缺项、多项、重复、`unsupported` 缺原因、错误 remote/HEAD、未知字段和无参数标准入口；实施前运行并确认因 `tests/harnessbench` 尚不存在而失败
  来源：`FN-10.13 HarnessBench 评测` + `评测运行固定版本与任务边界` + `固定清单后开始评测`、`标准入口完成全量评测`、`上游版本或任务范围非法`；design `FN-10.13 HarnessBench 评测 / 修改方案 / 上游获取与运行隔离`、`私有 profile 与 run manifest`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/preflight.test.ts tests/harnessbench/tests/full-suite.test.ts`；实施前预期失败，完成对应实现后预期固定上游 106 个 task 与 profile 恰好一致，全部 negative case 在第一个 task 前失败且不产生总分

- [x] 1.2 实现 `tests/harnessbench/run.mjs`、`profiles/full-suite.json` 和不可变 run manifest：无参数入口固定运行全量 profile，安全复用上游 cache，为全部 task 冻结 `execute/unsupported` 状态，并使 task-level 失败不阻断后续 task
  来源：`FN-10.13 HarnessBench 评测` + `评测运行固定版本与任务边界` 的全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案 / 目录与职责`、`上游获取与运行隔离`、`私有 profile 与 run manifest`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/preflight.test.ts tests/harnessbench/tests/full-suite.test.ts`；预期合法入口生成只读全量 manifest，catalog/profile 漂移 fail closed，task-level 零分结果仍继续到下一 task

- [x] 1.3 为真实产品路径和工作区桥接建立失败优先测试：覆盖 local runtime 的 IR Session/Request/SSE terminal、普通文件双向复制、失败 terminal、timeout 取消、路径越界、symlink/junction、`unsupported` 零分、mock/固定答案使全量运行无效，以及 private/testing import 禁止规则；实施前运行并确认目标行为失败
  来源：`FN-10.13 HarnessBench 评测` + `全量任务通过真实 NextAgent 产品边界评测` + `真实产品路径完成任务`、`不支持任务以零分保留在整体结果`、`替代路径不得计分`；design `FN-10.13 HarnessBench 评测 / 修改方案 / 评测候选包与工作区桥接`、`质量属性影响`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts tests/harnessbench/tests/architecture.test.ts`；实施前预期失败，完成对应实现后预期真实边界通过，`unsupported` 保留在全量分母，全部禁止路径被实际拒绝

- [x] 1.4 实现 `tests/harnessbench/nextagent-cli.mjs` 与 `fixtures/harnessbench-agent.yaml`：每个 `execute` task staging 隔离 backend-only candidate，仅使用 public exports，启用既有文件/shell/Python 工具和 sandbox，通过 IR API 执行，并在 containment 校验下导入/导出 execution workspace
  来源：`FN-10.13 HarnessBench 评测` + `全量任务通过真实 NextAgent 产品边界评测` + `真实产品路径完成任务`、`替代路径不得计分`；design `FN-10.13 HarnessBench 评测 / 修改方案 / 评测候选包与工作区桥接`
  验证：`npm run build && npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts tests/harnessbench/tests/architecture.test.ts`；预期真实 local runtime 修改隔离 workspace，terminal/timeout 可观察，禁止路径全部失败，`packages/**` 无 diff

- [x] 1.5 为真实模型 preflight 和逐 task usage 证据建立失败优先测试：覆盖 provider/credential 有效、provider 不可达、认证失败、proxy URL 注入、成功请求且 token 大于 0、无请求、零 token、trace 缺失和 task 覆盖模型/credential；实施前运行并确认目标行为失败
  来源：`FN-10.13 HarnessBench 评测` + `计分运行验证真实模型调用` + `真实模型证据成立`、`模型未调用或证据缺失`、`真实模型前置条件无效`；design `FN-10.13 HarnessBench 评测 / 修改方案 / 真实模型与 usage proxy`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/model-evidence.test.ts`；实施前预期失败，完成对应实现后预期无效 provider/credential 在首 task 前阻断，单 task 缺失证据以零分终态保留在全量分母

- [x] 1.6 将 HarnessBench `generic_cli`、usage proxy 与 NextAgent CLI bridge 接通：先以同一 proxy route 完成真实模型 preflight，再按 session 取得逐 task 非敏感 usage 汇总，缺失模型证据形成 `model_evidence_missing` 零分终态
  来源：`FN-10.13 HarnessBench 评测` + `计分运行验证真实模型调用` 的全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案 / 唯一端到端路径`、`真实模型与 usage proxy`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/model-evidence.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；预期 preflight 与 task usage 分离，proxy 请求与 task/session 唯一关联，缺失证据不产生非零分

- [x] 1.7 为框架效果得分和报告建立失败优先测试：覆盖 106 个 task 固定分母、HarnessBench 分量透传、`unsupported` 和所有 task-level 失败归零、四位小数、全量终态后才出总分、部分报告无总分、双格式一致、原子写入及敏感字段/绝对路径拒绝；实施前运行并确认目标行为失败
  来源：`FN-10.13 HarnessBench 评测` + `统一计算逐任务分数与框架效果得分` 的全部 Scenarios；`FN-10.13 HarnessBench 评测` + 系统质量属性“审计/可追溯性” + `评测报告可追溯且可恢复` 的全部 Scenarios；`FN-10.13 HarnessBench 评测` + 系统质量属性“安全” + `评测报告不泄露敏感信息` + `敏感报告被拒绝`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts`；实施前预期失败，完成对应实现后预期固定分母、零分规则、报告一致性和安全 negative case 全部通过

- [x] 1.8 实现 `tests/harnessbench/report.mjs` 和中断收尾：只消费 manifest 与固定上游结果，使用闭集 task 终态和 `frameworkEffectScore` 公式，全部 task 终态后原子写完整 JSON，再由 JSON 渲染 Markdown；中断只写无总分的部分报告
  来源：`FN-10.13 HarnessBench 评测` + `统一计算逐任务分数与框架效果得分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息` 的全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案 / 计分与失败分类`、`报告写入与安全`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts`；预期完整报告的 `frameworkEffectScore` 等于全部 106 个 `taskScore` 的算术平均，部分报告无该字段，敏感报告无法发布

- [x] 1.9 完成 `profiles/full-suite.json` 的 106 项支持矩阵：逐项根据当前真实产品 Capability 与运行依赖标记 `execute` 或给出非空 `unsupported` 原因，并以测试锁定与固定上游 catalog 的恰好一致关系
  来源：design `FN-10.13 HarnessBench 评测 / 修改方案 / 目录与职责`、`上游获取与运行隔离`、`私有 profile 与 run manifest`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/full-suite.test.ts`；预期 106 个上游 task 各出现一次，全部不支持项有具体原因，profile 不存在静默排除

- [x] 1.10 补充 `tests/harnessbench/README.md`：记录无参数全量入口、Node/Python/Git 与 HarnessBench 安装、真实模型安全引用、费用和时长提示、`--smoke` 非计分边界、框架效果得分解释及更新全量支持矩阵的方法，不定义 release gate 阈值
  来源：proposal `目标与非目标（Goals / Non-Goals）`、`影响范围（Impact）`；design `FN-10.13 HarnessBench 评测 / 修改方案 / 目录与职责`、`风险与取舍`
  验证：人工 code review 检查 README 与 `node tests/harnessbench/run.mjs --help` 一致，默认入口明确覆盖全部 106 个 task，`--smoke` 明确无 `frameworkEffectScore`

- [x] 1.11 使用真实模型执行 `--smoke` 集成诊断：对 `001-file`、`002-exec` 验证 usage、HarnessBench 原生评分和安全双格式报告，但报告标记 `nonScoring` 且没有 `frameworkEffectScore`
  来源：design `验证策略 / live smoke`、`FN-10.13 HarnessBench 评测 / 修改方案 / 目录与职责`
  验证：设置 README 规定的真实模型 credential 后运行 `node tests/harnessbench/run.mjs --smoke`；预期退出码 0，两个 task 的请求数和 token 均大于 0，JSON/Markdown 均标记 `nonScoring` 且不含 `frameworkEffectScore`

  实施记录：2026-08-04 使用真实模型执行成功，报告 `test-output/harnessbench/runs/2026-08-04T11-37-00-633Z-8ecbc164-smoke/report/report.json`；`001-file` 与 `002-exec` 均为 `scored`，请求数分别为 6、10，总 token 分别为 45903、90766，HarnessBench 原生 `combined_score` 均为 1；JSON/Markdown 均为 `nonScoring` 且无 `frameworkEffectScore`。

- [x] 1.12 使用真实模型执行无参数全量入口并给出 NextAgent 框架效果得分：完整运行固定 commit 的 106 个 task，全部 task 形成终态结论，生成一致的 JSON/Markdown 报告并记录实际命令、模型标识、费用/用量摘要和报告相对路径
  来源：`FN-10.13 HarnessBench 评测` + `评测运行固定版本与任务边界`、`全量任务通过真实 NextAgent 产品边界评测`、`计分运行验证真实模型调用`、`统一计算逐任务分数与框架效果得分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息` 的正常与 task-level 失败 Scenarios；design `验证策略（Verification Strategy）`
  验证：设置 README 规定的真实模型 credential 后运行 `node tests/harnessbench/run.mjs`；预期退出码 0，报告包含恰好 106 个 task 终态、`benchmarkTaskCount=106`，`frameworkEffectScore` 与全部 `taskScore` 的算术平均一致且 JSON/Markdown 相同

  实施记录：2026-08-04 以环境变量安全引用真实 provider/credential，执行无 CLI 参数标准入口 `node tests/harnessbench/run.mjs`；Windows 短暂文件占用中断后，以 `HARNESSBENCH_RESUME_RUN_ROOT=test-output/harnessbench/runs/2026-08-04T12-02-12-634Z-41cf47c0` 在同一不可变 manifest 上恢复并退出 0。模型 `glm-5.2`，672 次请求，总 token 8,014,493；106 个 task 终态为 54 `scored`、41 `agent_failed`、10 `unsupported`、1 `grading_failed`，全部 `taskScore` 之和 40.1862，固定分母得分 `frameworkEffectScore=0.3791`。JSON/Markdown 一致，报告相对路径为 `test-output/harnessbench/runs/2026-08-04T12-02-12-634Z-41cf47c0/report/report.json`。provider 未返回费用金额，因此仅记录可审计的请求/token 用量，不伪造成本数值。

- [x] 1.13 为 grader 独立预检和评分有效性建立失败优先测试并实现：profile 显式固定 grader model/provider/credential 安全引用，候选模型和 grader 分别 preflight；grader 鉴权或评分 shape 无效时首 task 前 fail closed；报告汇总 rubric/process 覆盖并只在 `evaluationValidity=valid` 时发布 `frameworkEffectScore`
  来源：`FN-10.13 HarnessBench 评测` + `计分运行验证 grader 前置条件` 的全部 Scenarios；`统一计算逐任务分数与框架效果得分` + `评分覆盖退化不得发布可比分数`；design `真实模型与 usage proxy`、`计分与失败分类`
  验证：先运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/model-evidence.test.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts` 并确认新增 case 失败；实现后预期 grader 401/invalid shape 在首 task 前失败，完整 rubric coverage 产生正式分数，rubric skipped 只产生 `diagnosticFrameworkEffectScore`

  实施记录：2026-08-05 新增 case 首次运行失败；实现后包含该范围的 HarnessBench 7 个测试文件共 32 项测试通过。`full-suite.json` 已显式声明 grader 三项配置，runner 在首 task 前分别执行 candidate/grader preflight，退化评分报告只保留 `diagnosticFrameworkEffectScore`。

- [x] 1.14 为安全失败诊断和有界恢复建立失败优先测试并实现：从 public stream/adapter/upstream 事实投影 `failurePhase`、`failureReasonCode`、模型请求与工作区产物观测值；只对零请求、零工作区结果、无上游 result 的 `harness_process` 失败重试一次，并记录 run-relative attempt ledger
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“审计/可追溯性” + `评测失败提供安全诊断` 的全部 Scenarios；系统质量属性“可靠性/恢复” + `评测基础设施失败有界恢复` 的全部 Scenarios；design `评测候选包与工作区桥接`、`计分与失败分类`
  验证：先运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts tests/harnessbench/tests/report.test.ts` 并确认新增 case 失败；实现后预期 terminal SafeError code 可观察、未知值为 `UNKNOWN`、已有模型请求/产物/terminal 的失败不重试、纯基础设施失败最多两次

  实施记录：2026-08-05 新增 case 首次运行失败；实现后 public SSE SafeError code、adapter 结构化失败、workspace diff 观测和 runner 分类测试通过。自动重试严格收窄为 child process 启动失败的 `retrySafe` 子集，terminal 或已有执行证据的失败不重试；attempt ledger 不包含 prompt、输出或 credential。

- [x] 1.15 新增固定非计分定向回归 profile 与入口：覆盖 grading、terminal failure、sandbox 和 infrastructure 四类任务集合，全部 task id 必须来自全量 catalog，报告固定 `nonScoring` 且无 `frameworkEffectScore`
  来源：`FN-10.13 HarnessBench 评测` + `定向回归运行不得计分` + `执行定向回归 profile`；design `目录与职责`、`私有 profile 与 run manifest`
  验证：先运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/preflight.test.ts tests/harnessbench/tests/full-suite.test.ts` 并确认新增 case 失败；实现后运行同一命令并确认未知 profile、重复/未知 task id fail closed，四个 profile 均为 `nonScoring` 且不改变 `full-suite` 106 项支持矩阵

  实施记录：2026-08-05 新增 case 首次运行失败；实现后四个 committed regression profile 均通过 catalog/重复项校验，`--profile <name>` 与 `--smoke` 互斥，报告固定 `nonScoring`。完整 HarnessBench 8 个测试文件共 33 项测试通过。

## 2. Change 整体验证

- [ ] 2.1 执行 HarnessBench Function 的无凭据自动化回归与仓库门禁，确认实现范围只新增 `tests/harnessbench/**`，生产构建、契约和架构边界无回归
  来源：proposal `What Changes`、`影响范围（Impact）`；design `验证策略（Verification Strategy）`
  验证：`npm run build && npx vitest run --config vitest.config.release.ts tests/harnessbench/tests && npm run test:contract && npm run lint:architecture && openspec validate add-ts-harnessbench-evaluation-gate --strict && openspec validate --all --strict`；预期全部退出码为 0，`git diff --name-only -- packages` 无输出

  当前验证记录：2026-08-05 `npm run build`、HarnessBench 8 个测试文件共 35 项测试、`npm run lint:architecture` 和目标 change strict validate 通过，`git diff --name-only -- packages` 无输出；`npm run lint:code` 仅报告 17 个本 change 范围外既有 warning。整体门禁仍被本 change 范围外的当前仓库基线阻断：`npm run test:contract` 中 `model-invocation-contracts.test.ts` 仍期望 8 个 inference fields，而当前 schema 已包含第 9 个 `modelParams`；`openspec validate --all --strict` 仅 `add-bash-structured-argv` 失败。未修改上述无关范围，因此本任务保持未完成。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”新增 `harnessbench-evaluation` stable spec、`FN-10.13`、`F-10.13` 及导航，并确认全量任务范围、框架效果得分、owner 和报告语义没有在 stable spec、Function、Feature、architecture 与 module 文档间重复定义。
