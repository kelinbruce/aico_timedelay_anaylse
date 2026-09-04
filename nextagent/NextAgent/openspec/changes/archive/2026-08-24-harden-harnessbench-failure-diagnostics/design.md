## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | 保真汇聚多轮安全诊断，独立暴露模型输出上限观测，并提供固定非计分恢复回归入口 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

本设计在不改变 HarnessBench terminal、重试和计分语义的前提下，使开发者能直接从报告复核多轮失败的最后一个明确安全诊断、任一轮工作区观测和模型输出达到候选上限的事实，并用一个固定 profile 重跑本轮代表失败类型。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`多轮 adapter 证据形成单一安全诊断`
- `ADDED`：`模型输出上限仅形成观测事实`
- `ADDED`：`剩余失败类型具有固定恢复回归入口`
- `MODIFIED`：`评测失败提供安全诊断`

设计约束：`adapter_results` 的数组顺序是 HarnessBench 给出的轮次顺序；输出上限事实以生成候选配置时使用的同一个 `maxOutputTokens` 常量为唯一阈值；报告只消费结构化 JSON，不解析自然语言错误正文。

### 当前实现

- `harness-runner.mjs` 的 `classifyUpstreamTaskResult` 只解析顶层 `adapter_result.stdout`，没有遍历 `adapter_results[]`。HarnessBench 多轮执行的顶层 stdout 是包含 transcript 的摘要对象时，前序轮次已经产生的 `failurePhase`、`failureReasonCode` 和 `workspaceOutcomeObserved` 会丢失。
- `runHarnessTask` 从上游结果读取后只返回顶层 `adapter_result`，因此新运行即使上游文件包含 `adapter_results[]`，也不会把它交给后续分类路径。
- `nextagent-cli.mjs` 在候选配置内直接写入 `maxOutputTokens: 8192`；报告分类和汇总不知道该边界，原始多轮摘要中的 `usage.output_tokens` 也没有安全投影。
- `nextagent-cli.mjs` 已为 timeout 和 cancel terminal 提供闭集 fallback，但 `failed` terminal 在公开 stream 缺少安全原因码时仍返回 `UNKNOWN`。
- `report.mjs` 当前生成 schema version 2；逐 task 已包含安全失败字段和工作区观测，但 Markdown task 表没有展示这些诊断，汇总也没有输出上限计数。
- 版本控制内已有 grader、terminal、sandbox 和 infrastructure 定向 profile；没有一个 profile 同时固定本轮需要复测的多轮诊断、本地辅助服务和输出上限代表任务。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 多轮 adapter 证据形成单一安全诊断 | 分类只查看顶层末轮摘要，fresh run 还丢弃 `adapter_results[]` | 缺少按轮次汇聚、最后明确失败优先和任一轮工作区观测规则 |
| 模型输出上限仅形成观测事实 | 候选配置有固定上限，报告无法消费轮次 usage | 缺少共享阈值、安全布尔投影、逐 task 默认值、汇总和 Markdown 一致展示 |
| 剩余失败类型具有固定恢复回归入口 | 现有 profile 分散覆盖，未覆盖多轮诊断与输出上限组合 | 缺少固定五任务、显式 `nonScoring` 的恢复回归 profile 及入口文档 |
| 评测失败提供安全诊断 | 公开 stream reason 已优先；`failed` terminal 的 fallback 为 `UNKNOWN` | failed terminal 默认原因码未闭合 |

### 修改方案

唯一实施路径如下：

1. 在 `tests/harnessbench/` 现有目录内新增轻量配置模块，唯一导出候选模型输出上限常量。`nextagent-cli.mjs` 用该常量生成候选配置，`harness-runner.mjs` 用同一常量判断结构化轮次 usage；不新增产品配置、环境变量或 profile 可变项。
2. `runHarnessTask` 在保留顶层 `adapter_result` 的同时保留上游 `adapter_results[]`。`classifyUpstreamTaskResult` 按 `adapter_results[]` 的既有顺序检查每轮 stdout，再检查不重复的顶层 adapter result；每个 stdout 只接受可解析的 JSON 对象。
3. 对合法 adapter JSON 形成私有归一化证据：失败证据只有在 `ok=false`、`failurePhase` 和 `failureReasonCode` 均为合法安全标识时有效；最后一个有效失败证据提供唯一阶段和原因码；`workspaceOutcomeObserved` 对所有合法对象做 OR 汇总。没有合法证据时继续使用既有报告 fallback，不从文本推断。
4. 对包含 `rounds[]` 的结构化 adapter 摘要检查每轮 `usage.output_tokens`。任一非负整数达到或超过共享上限时，分类结果写入 `modelOutputLimitObserved=true`；其他情况为 `false`。该布尔值与 terminal 分类、失败证据选择和计分分支完全分离。
5. `report.mjs` 将报告升级为 schema version 3。`normalizeTaskResult` 和未执行/不支持结果均输出必填布尔值；`diagnostics` 计算全部 execute task 的 `modelOutputLimitObservedCount`；Markdown 增加汇总行和逐 task 的安全失败、工作区与输出上限列。安全扫描规则保持不变，因为只新增布尔、计数和已有安全枚举。
6. 新增 `profiles/failure-recovery-regression.json`，固定五个 task 且声明 `nonScoring=true`；把它加入 profile contract 测试和 README 的按需命令。该入口复用现有 preflight、manifest、执行、报告与退出语义。
7. `terminalReasonCode` 对 `failed` 返回 `TERMINAL_FAILED`，保留 `timed_out → TASK_TIMED_OUT`、`canceled → REQUEST_CANCELED` 和非法 status 的 `UNKNOWN`；调用方继续以公开 stream reason 为第一优先级。该私有 helper 仅为确定性单元测试导出，不进入产品公共 exports。

私有结构化证据映射：

| 输入位置 | 合法输入 | 私有归一化结果 | 无效或缺失 |
|---|---|---|---|
| `adapter_results[i].stdout` / `adapter_result.stdout` | 可解析 JSON；失败字段满足安全标识格式 | `failureEvidence?`、`workspaceOutcomeObserved?` | 忽略该对象，不解析正文 |
| 摘要对象 `rounds[i].usage.output_tokens` | 非负整数 | 与共享 `maxOutputTokens` 比较后形成布尔观测 | 该轮不构成上限证据 |
| 全部轮次 | 一个或多个合法失败证据 | 取数组顺序中的最后一个 | 交给既有安全 fallback |
| 全部轮次 | 任一明确 `workspaceOutcomeObserved=true` | 汇总为 `true` | 汇总为 `false` |

共享输出上限常量由 TestHarness 候选配置拥有，单位为 output token，值为 `8192`。它不是产品默认值，也不接受 task、模型输出或外部结果覆盖。报告 v3 中 `modelOutputLimitObserved` 和 `diagnostics.modelOutputLimitObservedCount` 均为必填；旧报告文件保持不可变，不执行迁移或重写。

#### 备选方案（Alternatives Considered）

- 把达到 `8192` 直接归类为 `MODEL_OUTPUT_LIMIT`：未选择。现有结果中存在达到上限后仍成功的 task，该推断会覆盖真实 terminal 事实并改变失败语义。
- 只在 Markdown 中提示原始 stdout 路径：未选择。它继续要求人工解析敏感且庞大的 transcript，无法提供机器可读、稳定和安全的审计事实。
- 提高 `maxOutputTokens` 后重跑：未选择。当前证据不足以证明该配置是失败根因，而且这会改变候选运行预算，不属于诊断保真。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 审计/可追溯性 | `多轮 adapter 证据形成单一安全诊断` | 仅汇聚结构化安全字段，最后明确失败优先，工作区观测按任一轮汇总 | 多轮顺序、末轮摘要缺字段、多个失败、无合法证据和禁止正文泄漏 |
| 审计/可追溯性 | `模型输出上限仅形成观测事实` | 候选配置与分类共享阈值；布尔观测与 terminal/计分分支隔离 | 达到、低于、缺失 usage、成功达到上限及 JSON/Markdown 一致性 |
| 审计/可追溯性 | `评测失败提供安全诊断` | 公开 stream reason 优先，缺失时按 terminal status 使用闭集 fallback | failed、timeout、cancel、非法 status 与公开原因码优先级 |

## 验证策略（Verification Strategy）

- unit/contract：以合成的多轮上游结果断言最后明确失败、任一轮工作区观测、无结构化证据 fallback、达到与低于输出上限，以及 terminal 和评分不受布尔观测影响。
- adapter unit：直接断言四类 terminal status fallback，并通过既有 terminal SSE 测试锁定公开安全原因码优先路径。
- report contract：断言 schema version 3、逐 task 必填布尔、汇总计数、unsupported/not-completed 默认值，以及 JSON 与 Markdown 的诊断内容一致。
- integration：断言 task runner 从上游文件保留 `adapter_results[]`，固定恢复 profile 通过现有 preflight schema 且 task 集合恰好一致。
- architecture/security：断言实现范围不越出 `tests/harnessbench/**` 与 active change，不修改 `packages/**`、公共 contract、产品默认配置或 HarnessBench 上游；报告安全扫描仍拒绝 prompt、模型输出、credential 和绝对路径。
- OpenSpec/semantic review：验证 Function/Requirement 追踪、单一 owner、同形同策、KISS 和 push 前 NextAgent 语义门禁。真实模型定向运行按需执行，不作为无凭据常规测试的前置条件。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/harnessbench-evaluation/spec.md`：新增多轮 adapter 安全诊断、输出上限观测和固定恢复回归 Requirements，并保留 `FN-10.13` 归属元数据。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：同步输出、处理过程、报告格式与恢复回归 profile 规格。
- `openspec/designs/features/D10-二次开发与平台集成/D10.3-测试与扩展/F-10.13-HarnessBench能力评测.md`：同步多轮诊断、输出上限观测和恢复 profile 用户价值。
- `openspec/overview.md`：同步 HarnessBench 安全诊断和定向恢复能力摘要。
- `openspec/designs/architecture/e2e-quality-gates.md`：同步 TestHarness 报告 v3 与恢复回归边界。
- `openspec/designs/modules/agent-test-kit.md`：无。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：更新 `harnessbench-evaluation` 的设计摘要，不改变导航关系。

## 风险与取舍（Risks / Trade-offs）

- 上游 adapter 输出 shape 不是 NextAgent 公共契约；固定 HarnessBench commit 降低漂移风险，解析器对未知或非法 shape fail closed 为“无证据”，并保留既有 fallback。
- `usage.output_tokens` 等于上限只能证明边界被触达，不能证明内容被截断或任务因此失败；字段名称和文档刻意使用 `Observed`，且测试锁定它不改变终态与计分。
- 报告 schema 升级会影响本仓私有消费者；通过明确 version 3 和 contract 测试一次性收敛，不为旧 shape 增加兼容分支。
- 五任务真实回归需要模型和 grader 凭据且耗时较长；常规无凭据门禁只验证 profile 与诊断 contract，实际运行保持按需。

## 待确认问题（Open Questions）

无。
