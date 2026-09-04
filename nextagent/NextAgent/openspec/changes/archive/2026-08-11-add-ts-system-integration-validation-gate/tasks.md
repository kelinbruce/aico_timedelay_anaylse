## 任务引用与验证约定

以下缩写只用于避免 122 个原子任务重复长路径；每个任务仍有唯一来源和可重复命令。

- `S111`：历史任务沿用的同步范围缩写；当前指向 `FN-10.31` + Requirement `现有场景逐条同步到 TestClaw` + Scenario `114 个来源场景完整同步` + `122个独立验证用例清单.md` 对应行。
- `SINT`：`FN-10.31` + Requirement `三个新增系统集成用例覆盖外部真实边界` + Scenario `三个系统集成用例全部执行` + 对应 case 行。
- `SE2E`：`FN-10.31` + Requirement `五个新增 E2E 流程覆盖跨边界产品路径` + Scenario `新增五个 E2E 流程全部通过` + 对应 case 行。
- `VB(ID)`：先运行 `npm --prefix tests/TESTClaw run test -- tests/suites/add-ts-system-integration-validation-gate/e2e/backend/ID.test.ts` 并确认目标测试因行为未实现而失败；实现后重跑，预期 1 case passed、0 skipped/todo 且产生该 ID 的 evidence。
- `VW(ID)`：先运行 `npm --prefix tests/TESTClaw run test:e2e -- tests/suites/add-ts-system-integration-validation-gate/e2e/browser/ID.spec.ts` 并确认目标测试因行为未实现而失败；实现后重跑，预期 1 case passed、0 skipped/todo 且产生该 ID 的 evidence。
- `VI(ID)`：先运行 `npm --prefix tests/TESTClaw run test -- tests/suites/add-ts-system-integration-validation-gate/integration/ID.test.ts` 并确认目标测试因行为未实现而失败；实现后重跑，预期 1 case passed、0 skipped/todo 且产生该 ID 的 evidence。

## 1. `FN-10.31 验证系统集成`

### 1.1 先建立失败的清单与独立性验证

- [x] 1.1.1 新增 manifest contract test：连续 `TC-SI-001..119`、总数 119、INTEGRATION 3、E2E 116、五类 origin 范围和唯一 `executionRef`；无 manifest 时先确认失败。来源：`FN-10.31` + Requirement `TestClaw 系统集成清单具有完整且唯一的 activated 范围` + Scenario `完整清单被接受`、`清单缺失、重复或越界`。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/manifest.test.ts`；实现前因 `case-manifest.js` 缺失失败，实现后 5 tests passed。
- [x] 1.1.2 新增双向映射 target test：41 fixed、49 backend、21 browser 与 TestClaw cases 一对一；零映射、多映射、共享结果均失败。来源：`FN-10.31` + Requirement `现有 111 个场景逐条同步到 TestClaw` + Scenarios `111 个来源场景完整同步`、`来源场景发生漂移`。验证：2026-07-31 同一 `manifest.test.ts` 验证 111 条 source refs 唯一，missing/duplicate case 与 duplicate executionRef 反例均通过。
- [x] 1.1.3 新增 independence negative test：source/private/testing import、source report、mock target、skip/todo、源码 package fallback 均失败。来源：`FN-10.31` + Requirement `TestClaw 验证不依赖源码测试结果` + Scenario `源码结果被用于判定`。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/independence.test.ts`，7 tests passed。
- [x] 1.1.4 新增 input preflight test：候选根或 external packages 根缺失时，受影响 case 为 `UNAVAILABLE` 且 runner 非零退出。来源：`FN-10.31` + Requirement `TestClaw 验证不依赖源码测试结果` + Scenario `必需 artifact 缺失`。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/preflight.test.ts tests/suites/add-ts-system-integration-validation-gate/runner.test.ts`；6 tests passed，两个缺失分支分别产生 116/7 个 `UNAVAILABLE`、完整 119-case report，runner 均退出 1 且 stderr 不泄漏路径或异常。
- [x] 1.1.5 新增 deferred coverage test：planned/excluded 没有 activated case id/executionRef，不进入结果和 verdict；独立 `ts-performance-test-gate` 使用单独 coverage entry，容量/集群/AgentLink 使用无稳定系统级契约的 entry。来源：`FN-10.31` + Requirement `Deferred coverage 保持可见但不冒充通过` + 三个 Scenarios。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/deferred-coverage.test.ts`；刷新后 3 tests passed，包含 performance 独立 owner 和未规格化系统范围分离断言。

### 1.2 固化来源与执行基础设施

- [x] 1.2.1 建立 41 个 fixed gate source manifest。来源：design `现有 111 个场景的同步策略`。验证：2026-07-31 运行 `npm run test:system-integration:sync`，精确报告 fixed `41/41`，并逐项确认 gate inventory/security/resilience source token 存在。
- [x] 1.2.2 建立 49 个 backend E2E source manifest。来源：design `现有 111 个场景的同步策略`。验证：2026-07-31 同一 sync 命令精确报告 backend `49/49`、20 个来源文件；source-sync negative test 删除一个文件的可执行声明后按 backend drift 失败。
- [x] 1.2.3 建立 21 个 browser E2E source manifest。来源：design `现有 111 个场景的同步策略`。验证：2026-07-31 同一 sync 命令精确报告 browser `21/21`、7 个来源文件并校验每文件用例基数。
- [x] 1.2.4 实现 `test:system-integration:sync` 且独立 gate 不读取源码。来源：design `现有 111 个场景的同步策略`。验证：2026-07-31 运行 sync 得到 `41/41 + 49/49 + 21/21 = 111/111`；运行 `independence.test.ts` 8 tests passed，静态确认标准 runner 不导入 source-sync/source manifests/source workspace；独立运行 `npm run test:system-integration` 在 external artifact 未配置时生成 119-case `UNAVAILABLE` report 并退出 1，而非读取源码回退。
- [x] 1.2.5 实现私有 manifest/deferred schemas 和 119 definitions。来源：design `119 用例 manifest`。验证：2026-07-31 联合运行 manifest/deferred/independence/preflight targeted suite，4 files、17 tests passed；非法范围、activated-looking deferred id 和非唯一映射均被拒绝。
- [x] 1.2.6 实现 candidate/external roots 只读 preflight。来源：design `两个显式输入根`。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/preflight.test.ts`；4 tests passed，candidate 缺失映射 116 个、external packages 缺失映射 7 个 `UNAVAILABLE` 结果，完整输入可用且执行前后两个输入树 hash 不变。
- [x] 1.2.7 实现隔离 run root、随机端口、进程登记、浏览器状态、restricted diagnostic root、evidence root 和 finally cleanup；两个输出根不得重叠，restricted diagnostic root 不得进入 `evidenceRefs`。来源：design `Runner 与结果归一化`。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/isolation.test.ts`；3 tests passed，连续 run 根不同，正常/异常路径均回收进程、监听端口和临时状态，restricted diagnostic root 被删除且不能转换为 evidence ref，安全 evidence root 保留。
- [x] 1.2.8 实现 Vitest/Playwright reporter adapter。来源：design `Runner 与结果归一化`。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/reporter.test.ts`；7 tests passed，每个 expected executionRef 恰好归一为一项，缺失为 `MISSING`、timeout 为 `TIMEOUT`、skip/todo 为 `FAILED`，重复和未知结果被拒绝且 raw reporter error 未导出。
- [x] 1.2.9 在 TestClaw 固定 `typescript` 和匹配 Node LTS 的 `@types/node`，并实现临时 consumer 到只读 external `node_modules` 的 Windows junction/其他平台 symlink。来源：design `两个显式输入根`。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/external-consumer-root.test.ts`；3 tests passed，确认只使用 junction/symlink、无安装/下载/包管理器进程，输入树 hash 不变且 cleanup 后临时根不存在。

### 1.3 同步 41 个固定 gate cases

- [x] 1.3.001 完成 `TC-SI-001` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-001)` 因 execution file 不存在失败；实现候选包副本、loopback OpenAI、HTTP/SSE/history 断言后，聚合复跑 `TC-SI-001..005` 为 5 files、5 tests passed，生成 `cases/TC-SI-001.json`，候选输入树 hash 前后一致。
- [x] 1.3.002 完成 `TC-SI-002` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首轮真实候选执行因误把 live stream 与 terminal replay 做字节比较而失败；按来源场景改为 terminal 后两次 replay 后，`VB(TC-SI-002)` 和 `TC-SI-001..005` 聚合复跑均通过，生成 `cases/TC-SI-002.json`。
- [x] 1.3.003 完成 `TC-SI-003` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首轮真实候选执行因只接受 409 而失败；同步来源场景定义的“409 安全冲突或 200 串行 follow-up”后，`VB(TC-SI-003)` 和聚合复跑均通过，另验证不同 session run 隔离，生成 `cases/TC-SI-003.json`。
- [x] 1.3.004 完成 `TC-SI-004` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 聚合运行 `TC-SI-001..005`，5 files、5 tests passed；缺失 input 和 malformed JSON 两个失败分支均 fail closed，未调用 provider，生成经 canary 扫描的 `cases/TC-SI-004.json`。
- [x] 1.3.005 完成 `TC-SI-005` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 聚合运行 `TC-SI-001..005`，5 files、5 tests passed；重复 key 返回相同 session/request/run，history 和 session list 各仅一份事实，生成 `cases/TC-SI-005.json`。
- [x] 1.3.006 完成 `TC-SI-006` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-006)`。
- [x] 1.3.007 完成 `TC-SI-007` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-007)`。
- [x] 1.3.008 完成 `TC-SI-008` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 运行 `VB(TC-SI-008)` 所在聚合命令，3 files、3 tests passed；验证自动 session、terminal SSE、conversation 一致并生成 `cases/TC-SI-008.json`。
- [x] 1.3.009 完成 `TC-SI-009` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 同一聚合命令通过；live/replay 均为 accepted 在前、completed terminal 在后，生成 `cases/TC-SI-009.json`。
- [x] 1.3.010 完成 `TC-SI-010` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 同一聚合命令通过；候选包公开 SSE 和 WebSocket replay 均观察到同一 run 的 completed terminal，生成 `cases/TC-SI-010.json`。
- [x] 1.3.011 完成 `TC-SI-011` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 运行 `VB(TC-SI-011)` 所在聚合命令，3 files、3 tests passed；terminal stream、history 和 refresh replay 一致，生成 `cases/TC-SI-011.json`。
- [x] 1.3.012 完成 `TC-SI-012` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 同一聚合命令通过；同 session 第二次 submit 产生不同 request/run 且持久化两个 turn，生成 `cases/TC-SI-012.json`。
- [x] 1.3.013 完成 `TC-SI-013` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 同一聚合命令通过；延迟 provider 下 cancel 返回 200，stream 仅含 canceled terminal、不含 completed terminal，生成 `cases/TC-SI-013.json`。
- [x] 1.3.014 完成 `TC-SI-014` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 运行 `VB(TC-SI-014)` 与 `TC-SI-015` 聚合命令，2 files、2 tests passed；retry 创建不同 run 且原 run replay 可追踪，生成 `cases/TC-SI-014.json`。
- [x] 1.3.015 完成 `TC-SI-015` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 同一聚合命令通过；revised submit 创建不同 request/run 并持久化两个 mainline turn，生成 `cases/TC-SI-015.json`。
- [x] 1.3.016 完成 `TC-SI-016` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-016)` 因执行文件不存在失败；实现真实 multipart 上传、附件 finalize、submit 和 stream/history 黑盒断言后，1 file、1 test passed，生成 `cases/TC-SI-016.json`，并确认模型边界只看到附件文件名、不含附件正文，公开结果不泄露正文或绝对路径，候选输入 hash 未变化。
- [x] 1.3.017 完成 `TC-SI-017` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-017)` 因执行文件不存在失败；实现真实候选包同 session 五轮 submit、逐轮 terminal 和最终 10 条 conversation 顺序/完整性后，1 file、1 test passed，生成 `cases/TC-SI-017.json`，候选输入 hash 未变化。
- [x] 1.3.018 完成 `TC-SI-018` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-018)`。
- [x] 1.3.019 完成 `TC-SI-019` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-019)`。
- [x] 1.3.020 完成 `TC-SI-020` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-020)`。
- [x] 1.3.021 完成 `TC-SI-021` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-021)`。
- [x] 1.3.022 完成 `TC-SI-022` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-022)` 因执行文件不存在失败；实现真实候选包自动标题活动、manual title 更新、后续同 session turn 和 session list 优先级断言后，1 file、1 test passed，生成 `cases/TC-SI-022.json`，候选输入 hash 未变化。
- [x] 1.3.023 完成 `TC-SI-023` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-023)` 因执行文件不存在失败；loopback 按真实模型请求中的 `zh-CN`/`en-US` 指示返回对应语言，候选 stream/history 均保持 `LTE KPI` 术语并持久化正确语言输出，1 file、1 test passed，生成 `cases/TC-SI-023.json`，候选输入 hash 未变化。
- [x] 1.3.024 完成 `TC-SI-024` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-024)`。
- [x] 1.3.025 完成 `TC-SI-025` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-025)`。
- [x] 1.3.026 完成 `TC-SI-026` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-026)`。
- [x] 1.3.027 完成 `TC-SI-027` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-027)` 因执行文件不存在失败；真实 loopback provider 返回带 raw canary 的 HTTP 503 后，候选只产生 `REQUEST_FAILED` terminal，stream 不含 raw provider message、secret、路径、stack 或 completed terminal，1 file、1 test passed，生成 `cases/TC-SI-027.json`，候选输入 hash 未变化。
- [x] 1.3.028 完成 `TC-SI-028` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-028)`。
- [x] 1.3.029 完成 `TC-SI-029` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-029)` 因执行文件不存在失败；实现真实 SSE 读取后主动断连并以 `lastSeenSequence` 重连，首次行为运行识别 `LIVE_ONLY` envelope 可复用当前 sequence，按公开契约收敛为 sequence 不回退、至少一个持久化事件推进且原 run 到达 completed terminal；最终 1 file、1 test passed，生成 `cases/TC-SI-029.json`，候选输入 hash 未变化。
- [x] 1.3.030 完成 `TC-SI-030` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-030)`。
- [x] 1.3.031 完成 `TC-SI-031` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-031)`。
- [x] 1.3.032 完成 `TC-SI-032` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-032)`。
- [x] 1.3.033 完成 `TC-SI-033` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-033)`。
- [x] 1.3.034 完成 `TC-SI-034` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-034)` 因执行文件不存在失败；真实 with-frontend 候选进程分别验证 SPA home/fallback、FEBs prelude、backend sessions API 和 unknown API，确认浏览器 fallback 不覆盖 extension/backend route，1 file、1 test passed，生成 `cases/TC-SI-034.json`，候选输入 hash 未变化。
- [x] 1.3.035 完成 `TC-SI-035` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-035)`。
- [x] 1.3.036 完成 `TC-SI-036` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-036)`。
- [x] 1.3.037 完成 `TC-SI-037` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-037)`。
- [x] 1.3.038 完成 `TC-SI-038` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-038)`。
- [x] 1.3.039 完成 `TC-SI-039` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-039)`。
- [x] 1.3.040 完成 `TC-SI-040` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-040)`。
- [x] 1.3.041 完成 `TC-SI-041` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-041)`。

### 1.4 同步 49 个独立 backend E2E 场景

- [x] 1.4.042 完成 `TC-SI-042` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次聚合运行 `VB(TC-SI-042..043)` 因两个执行文件均不存在失败；实现真实 packaged HTTP service、分块模型响应、累计 content stream、terminal 和 conversation 后，TC-SI-042 在聚合行为运行中通过，生成 `cases/TC-SI-042.json`，候选输入 hash 未变化。
- [x] 1.4.043 完成 `TC-SI-043` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次实现运行发现真实候选会在两条 reasoning 增量后再投影最终累计 thinking snapshot；按当前“delta 累计全量 + 最终累计 thinking”契约收敛为前两步、单调前缀、最终 reasoning 和三条累计 content snapshot，独立重跑 1 file、1 test passed，生成 `cases/TC-SI-043.json`，候选输入 hash 未变化。
- [x] 1.4.044 完成 `TC-SI-044` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-044)`。
- [x] 1.4.045 完成 `TC-SI-045` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-045)`。
- [x] 1.4.046 完成 `TC-SI-046` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-046)`。
- [x] 1.4.047 完成 `TC-SI-047` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-047)`。
- [x] 1.4.048 完成 `TC-SI-048` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-048)`。
- [x] 1.4.049 完成 `TC-SI-049` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-049)`。
- [x] 1.4.050 完成 `TC-SI-050` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次聚合运行 `VB(TC-SI-050..051)` 因两个执行文件均不存在失败；实现 Web acceptance、累计 stream、terminal 和 history 一致性后，聚合运行 2 files、2 tests passed，TC-SI-050 生成独立 `cases/TC-SI-050.json`，候选输入 hash 未变化。
- [x] 1.4.051 完成 `TC-SI-051` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 同一聚合命令通过；第二次真实模型 HTTP 请求同时观察到第一轮 assistant 结果与第二轮 user 输入，最终 conversation 为 USER/ASSISTANT/USER/ASSISTANT 四条有序事实，生成 `cases/TC-SI-051.json`，候选输入 hash 未变化。
- [x] 1.4.052 完成 `TC-SI-052` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-052)`。
- [x] 1.4.053 完成 `TC-SI-053` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-053)`。
- [x] 1.4.054 完成 `TC-SI-054` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-054)`。
- [x] 1.4.055 完成 `TC-SI-055` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-055)`。
- [x] 1.4.056 完成 `TC-SI-056` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-056)`。
- [x] 1.4.057 完成 `TC-SI-057` 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-07-31 首次运行 `VB(TC-SI-057)` 因执行文件不存在失败；真实 provider HTTP 边界收到与 acceptance 完全一致的 trusted agent/session/request/run headers，坐标未注入模型 message body，1 file、1 test passed，生成 `cases/TC-SI-057.json`，候选输入 hash 未变化。
- [x] 1.4.058 完成 `TC-SI-058` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-058)`。
- [x] 1.4.059 完成 `TC-SI-059` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-059)`。
- [x] 1.4.060 完成 `TC-SI-060` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-060)`。
- [x] 1.4.061 完成 `TC-SI-061` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-061)`。
- [x] 1.4.062 完成 `TC-SI-062` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-062)`。
- [x] 1.4.063 完成 `TC-SI-063` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-063)`。
- [x] 1.4.064 完成 `TC-SI-064` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-064)`。
- [x] 1.4.065 完成 `TC-SI-065` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-065)`。
- [x] 1.4.066 完成 `TC-SI-066` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-066)`。
- [x] 1.4.067 完成 `TC-SI-067` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-067)`。
- [x] 1.4.068 完成 `TC-SI-068` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-068)`。
- [x] 1.4.069 完成 `TC-SI-069` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-069)`。
- [x] 1.4.070 完成 `TC-SI-070` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-070)`。
- [x] 1.4.071 完成 `TC-SI-071` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-071)`。
- [x] 1.4.072 完成 `TC-SI-072` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-072)`。
- [x] 1.4.073 完成 `TC-SI-073` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-073)`。
- [x] 1.4.074 完成 `TC-SI-074` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-074)`。
- [x] 1.4.075 完成 `TC-SI-075` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-075)`。
- [x] 1.4.076 完成 `TC-SI-076` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-076)`。
- [x] 1.4.077 完成 `TC-SI-077` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-077)`。
- [x] 1.4.078 完成 `TC-SI-078` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-078)`。
- [x] 1.4.079 完成 `TC-SI-079` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-079)`。
- [x] 1.4.080 完成 `TC-SI-080` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-080)`。
- [x] 1.4.081 完成 `TC-SI-081` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-081)`。
- [x] 1.4.082 完成 `TC-SI-082` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-082)`。
- [x] 1.4.083 完成 `TC-SI-083` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-083)`。
- [x] 1.4.084 完成 `TC-SI-084` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-084)`。
- [x] 1.4.085 完成 `TC-SI-085` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-085)`。
- [x] 1.4.086 完成 `TC-SI-086` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-086)`。
- [x] 1.4.087 完成 `TC-SI-087` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-087)`。
- [x] 1.4.088 完成 `TC-SI-088` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-088)`。
- [x] 1.4.089 完成 `TC-SI-089` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-089)`。
- [x] 1.4.090 完成 `TC-SI-090` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VB(TC-SI-090)`。

### 1.5 同步 24 个 browser E2E 场景

- [x] 1.5.091 完成 `TC-SI-091` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-091)`。
- [x] 1.5.092 完成 `TC-SI-092` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-092)`。
- [x] 1.5.093 完成 `TC-SI-093` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-093)`。
- [x] 1.5.094 完成 `TC-SI-094` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-094)`。
- [x] 1.5.095 完成 `TC-SI-095` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-095)`。
- [x] 1.5.096 完成 `TC-SI-096` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-096)`。
- [x] 1.5.097 完成 `TC-SI-097` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-097)`。
- [x] 1.5.098 完成 `TC-SI-098` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-098)`。
- [x] 1.5.099 完成 `TC-SI-099` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-099)`。
- [x] 1.5.100 完成 `TC-SI-100` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-100)`。
- [x] 1.5.101 完成 `TC-SI-101` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-101)`。
- [x] 1.5.102 完成 `TC-SI-102` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-102)`。
- [x] 1.5.103 完成 `TC-SI-103` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-103)`。
- [x] 1.5.104 完成 `TC-SI-104` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-104)`。
- [x] 1.5.105 完成 `TC-SI-105` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-105)`。
- [x] 1.5.106 完成 `TC-SI-106` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-106)`。
- [x] 1.5.107 完成 `TC-SI-107` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-107)`。
- [x] 1.5.108 完成 `TC-SI-108` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-108)`。
- [x] 1.5.109 完成 `TC-SI-109` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-109)`。
- [x] 1.5.110 完成 `TC-SI-110` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-110)`。
- [x] 1.5.111 完成 `TC-SI-111` 的失败测试、实现和独立 evidence。来源：`S111`。验证：`VW(TC-SI-111)`。
- [x] 1.5.120 完成 `TC-SI-120` pending tool-round output process bridge 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-08-04 单独运行 `TC-SI-120.spec.ts` 为 1/1 passed；标准门禁 runId `8e0d31a3-7c7f-4a21-b6a2-49211a068266` 中生成 identity 匹配的独立 evidence 并纳入 121/121 PASSED。
- [x] 1.5.121 完成 `TC-SI-121` pending output final-answer handoff 的失败测试、实现和独立 evidence。来源：`S111`。验证：2026-08-04 单独运行 `TC-SI-121.spec.ts` 为 1/1 passed；标准门禁 runId `8e0d31a3-7c7f-4a21-b6a2-49211a068266` 中生成 identity 匹配的独立 evidence 并纳入 121/121 PASSED。
- [x] 1.5.122 完成 `TC-SI-122` 单一事实失败原因和默认折叠安全技术详情的失败测试、实现和独立 evidence，覆盖 local、immersive、collaborative 三宿主。来源：`S111`。验证：2026-08-04 单独运行 `TC-SI-122.spec.ts` 为 1/1 passed；标准门禁 runId `b80c3da5-df98-4eb4-a452-706f7af98622` 中生成 identity 匹配的独立 evidence，并纳入 122/122 PASSED。

### 1.6 新增 3 个系统集成和 5 个 E2E

- [x] 1.6.112 完成 `TC-SI-112` packed external ESM consumer 的失败测试、实现和独立 evidence。来源：`SINT`。验证：2026-07-31 首轮 `VI(TC-SI-112)` 先因 public declaration 使用错误属性失败，再暴露 side-effect-only private import 未触发 TS resolution；改为真实 public declaration/runtime parity 和 named private subpath import 后，1 file、1 test passed。consumer 仅通过 external `node_modules` junction 使用 packed artifacts，`tsc` 与 Node ESM import 通过，private subpath 编译失败，生成 `cases/TC-SI-112.json` 且 external 输入树 hash 前后一致。
- [x] 1.6.113 完成 `TC-SI-113` remote gateways loopback 的失败测试、实现和独立 evidence，覆盖 schema、trusted scope/correlation、Workflow `inputText`/`inputVariables` 分离、取消和 safe failure。来源：`SINT`。验证：2026-07-31 首次运行 `VI(TC-SI-113)` 因 execution file 不存在失败；实现 packed public exports consumer 与随机端口 sandbox、RAG、Workflow RAG、问题推荐、Workflow execution HTTP/SSE loopback 后，单文件 1 test passed；与 `TC-SI-112/114`、manifest、independence 聚合复跑为 5 files、16 tests passed，生成 `cases/TC-SI-113.json`，external 输入树 hash 前后一致。
- [x] 1.6.114 完成 `TC-SI-114` SkillHub HTTP/filesystem 的失败测试、实现和独立 evidence，覆盖下载前 hash、archive/folder normalization、staged validation、原子提交及失败替换保留已提交 Skill。来源：`SINT`。验证：2026-07-31 首次运行 `VI(TC-SI-114)` 因 execution file 不存在失败；实现真实 SkillHub search/package HTTP、ZIP hash/路径规范化、公开 capability subsystem staging/commit 后，单文件 1 test passed；聚合复跑 5 files、16 tests passed，验证 traversal、hash mismatch、HTTP failure、cancel 均不发布半成品，无效替换保留 v1 installed fact/manifest，并生成 `cases/TC-SI-114.json`。
- [x] 1.6.115 完成 `TC-SI-115` remote deployment mainline 的失败测试、实现和独立 evidence。来源：`SE2E`。验证：remote deployment public export、真实 HTTP/SSE、session/history/唯一 terminal 均通过；纳入 97/97 backend/integration 全量与 119/119 标准门禁。
- [x] 1.6.116 完成 `TC-SI-116` telecom RAG+sandbox 的失败测试、实现和独立 evidence。来源：`SE2E`。验证：远端 RAG/sandbox、terminal/history/audit/安全诊断一致性通过；纳入 97/97 backend/integration 全量与 119/119 标准门禁。
- [x] 1.6.117 完成 `TC-SI-117` SkillHub acquire-to-execute 的失败测试、实现和独立 evidence，覆盖 source metadata/localized display-name、Skill disclosure、资源投影和 `SKILL.md` 正文不投影。来源：`SE2E`。验证：真实 HTTP 下载、安装、catalog、localized metadata、Skill body 延迟披露及仅辅助资源投影通过；单跑 1/1、全量 97/97、标准门禁 119/119。
- [x] 1.6.118 完成 `TC-SI-118` invalid/failure/timeout/cancel 的失败测试、实现和独立 evidence，覆盖取消传播和 stream/history/replay 唯一安全终态。来源：`SE2E`。验证：四个失败分支与安全终态一致性通过；纳入 97/97 backend/integration 全量与 119/119 标准门禁。
- [x] 1.6.119 完成 `TC-SI-119` 三宿主真实后端的失败测试、实现和独立 evidence，覆盖 active-run replay 与 refresh 恢复。来源：`SE2E`。验证：external local test-host public artifact、候选 immersive 与 collaborative PIU 共享同一 pending input/终态/刷新恢复；单跑 1/1、browser 22/22、标准门禁 119/119。

### 1.7 报告、安全和 Change 验收

- [x] 1.7.1 实现 report schema 和 verdict。来源：`FN-10.31` + 可测试性 + Requirement `TestClaw 门禁命令和报告结论唯一确定` + 两个 Scenarios。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/report.test.ts`；7 tests passed，报告恰好 119 个结果、3/116 分层、无未声明字段，并验证 `FAILED > TIMEOUT > UNAVAILABLE > MISSING > PASSED`、缺失补 `MISSING` 和安全 evidence ref。
- [x] 1.7.2 实现 exported evidence 安全扫描和 restricted diagnostic 隔离。来源：`FN-10.31` + 安全 + Requirement `系统集成证据不泄漏敏感内容` + 两个 Scenarios。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/evidence-safety.test.ts`；4 tests passed，全部 10 类禁止内容及内置 credential/绝对路径命中均覆盖 affected case 和总 verdict 为 `FAILED` 且报告不复制原文；相同 Tool/execution diagnostic 位于 restricted root 时只导出 hash/opaque ref，复制到导出边界即失败，cleanup 后 restricted root 不存在。
- [x] 1.7.3 实现双向追踪。来源：`FN-10.31` + 审计/可追溯性 + Requirement `系统集成结果支持端到端追踪` + 两个 Scenarios。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/traceability.test.ts`；2 tests passed，119 条 source/spec → case → execution → result/evidence 均可正反向定位，source metadata 漂移被拒绝。
- [x] 1.7.4 实现连续运行和失败清理。来源：`FN-10.31` + 可靠性/恢复 + Requirement `重复执行不依赖残留外部状态` + 两个 Scenarios。验证：2026-07-31 运行 `npm run test -- tests/suites/add-ts-system-integration-validation-gate/isolation.test.ts`；4 tests passed，不同 run root、正常/失败 finally cleanup、进程和端口回收、restricted diagnostic 删除均通过；连续运行不读取旧 report 或旧 diagnostic。
- [x] 1.7.5 实现 `scripts/run-system-integration-gate.mjs` 和 `test:system-integration`。来源：design `Runner 与结果归一化`。验证：2026-08-01 标准命令退出 0，runId `5fe7f22f-d236-481c-9723-fa25bfd74a0b`，report 为 `119/119 PASSED`、`INTEGRATION=PASSED`、`E2E=PASSED`，每条至少一个 evidence ref。
- [x] 1.7.6 完成 Change 整体验证。来源：proposal `影响范围` + design `验证策略`。验证：source-sync 为 41/41、49/49、21/21；结构门禁 12 files/52 tests；backend/integration 97/97；browser 22/22；标准门禁 119/119。仓库 build/test/contract/architecture、前端 build/test/modes 和 OpenSpec strict 结果记录于 `review.md`。
- [x] 1.7.7 将 Feature 追踪收敛到权威 OpenSpec 的 `F-10.8 验证门禁`，并移除 manifest 中旧 docs 编号体系的平行 Function 引用。来源：proposal `Feature 影响` + design `119 用例 manifest`。验证：2026-08-01 运行 `manifest.test.ts` 与 `traceability.test.ts`，7 tests passed；119 个 case 均唯一引用 `F-10.8` 和 `FN-10.31`。
- [x] 1.7.8 将每个通过结果关联到本次 output root 中唯一、可解析且 case identity 匹配的 evidence 文件；缺失、重复或非法 evidence fail closed。来源：`FN-10.31` + 审计/可追溯性 + Requirement `系统集成结果支持端到端追踪` + Scenario `追踪或证据缺失`。验证：2026-08-01 运行 `runner-evidence.test.ts` 与 `traceability.test.ts`，4 tests passed，覆盖真实相对路径、缺失失败和 119 个唯一 evidence refs。
- [x] 1.7.9 为 Vitest/Playwright 子进程增加有界输出捕获、固定 deadline、终止和非零退出 fail-closed，并在导出前扫描 summary/report/evidence。来源：`FN-10.31` + 安全、可靠性/恢复 + Requirements `系统集成证据不泄漏敏感内容`、`重复执行不依赖残留外部状态`。验证：2026-08-01 运行 `framework-process.test.ts`、`runner.test.ts`、`evidence-safety.test.ts`，8 tests passed，覆盖非零退出、deadline 终止、缺失输入报告和禁止内容失败。
- [x] 1.7.10 使用当前源码重新构建候选包和 test-host artifact，重跑 119-case 标准门禁并审计每条 evidence ref 可解析且唯一。来源：proposal `影响范围` + design `验证策略`。验证：2026-08-01 运行 `npm run build:testclaw-host-artifact`、`npm run pack:release`，从当前 archive 解压全新 candidate 后运行 `npm --prefix tests/TESTClaw run test:system-integration`；runId `2a623066-a706-4ca1-bc97-ef0f4e3dd98b` 为 119/119 PASSED，119 个 evidence refs 全部唯一、可解析且 `caseId/result` 匹配。runner 仅执行 manifest 精确文件并固定两个 Vitest file workers；8 workers 的 I/O 间歇失败和纯串行超过 20 分钟的 TIMEOUT 均已用真实运行复现后消除。
- [x] 1.7.11 在 `origin/main` 新增 2 个 browser 来源场景后刷新 source-sync、121-case manifest/报告/OpenSpec，并用当前源码重建候选包和 test-host artifact，重跑标准门禁及仓库受影响门禁。来源：Requirement `现有场景逐条同步到 TestClaw` + Scenario `来源场景发生漂移`。验证：2026-08-04 source-sync 为 fixed 41/41、backend 49/49（20 files）、browser 23/23（7 files）；从当前 `origin/main` 重建并解压 `with-frontend` win32-x64 候选后运行标准门禁，runId `8e0d31a3-7c7f-4a21-b6a2-49211a068266` 为 121/121 PASSED、INTEGRATION 3/3、E2E 118/118，121 个 evidence refs 全部唯一、可解析且 `caseId/result` 匹配。121-case 双 worker 实测超过旧 20 分钟 Vitest 上限后，将仍然有界的阶段 deadline 收敛为 30 分钟并以 runner 单测和完整门禁复验。
- [x] 1.7.12 在最新 `origin/main` 新增 1 个 browser 来源场景后刷新 source-sync、122-case manifest/报告/OpenSpec，用当前源码重建候选包和 test-host artifact，并重跑标准门禁及仓库受影响门禁。来源：Requirement `现有场景逐条同步到 TestClaw` + Scenario `来源场景发生漂移`。验证：2026-08-04 source-sync 为 fixed 41/41、backend 49/49（20 files）、browser 24/24（7 files）；从当前源码重建并解压 `with-frontend` win32-x64 candidate，标准门禁 runId `b80c3da5-df98-4eb4-a452-706f7af98622` 为 122/122 PASSED、INTEGRATION 3/3、E2E 119/119，122 个 evidence refs 全部唯一、可解析且 `caseId/result` 匹配。根 build、142 files/1578 tests、architecture 45 files/279 tests、Workflow bridge 1/1、目标 change strict 均通过；全仓 OpenSpec、contract、smoke 和前端 typecheck 的既有主线失败及其无分支差异证据记录于 `review.md`。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design `长期基线刷新计划` 同步 stable spec、Function、Feature、测试特性树、E2E 架构、spec-to-design-map、TestClaw README 和 testcase baseline；本节不作为实施 checkbox。
