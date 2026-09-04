# Change review

状态：**PASS WITH FOLLOW-UP**

Change：`add-ts-system-integration-validation-gate`

检查日期：2026-08-04

## 结论

本 change 的 OpenSpec、TestClaw 清单、122 个独立执行用例、标准 runner、证据归一化和安全边界已经全部落地。`openspec instructions apply` 报告 `148/148` tasks 完成；基于最新 `origin/main` 源码重建 candidate 和 test-host artifact 后，标准命令产生 `122/122 PASSED`，其中 `INTEGRATION=3/3`、`E2E=119/119`，122 个 case 都有唯一、可解析且 `caseId/result` 匹配的 `evidenceRefs`。

change 范围内未发现 P0/P1。follow-up 是 4 项相对 `origin/main` 无分支差异的仓库基线：一个 contract 计数字段断言、两个 smoke 旧行为断言、一个前端 TypeScript 推断错误，以及一个其他 active OpenSpec change 的规范关键词错误。它们不影响 TestClaw system-integration verdict，也没有被本 change 隐藏或改写。

## 落地范围

- `tests/TESTClaw` 是唯一验证 owner，固定映射 41 个后端 gate cases、49 个 backend E2E 场景、24 个 browser E2E 场景。
- 新增并执行 3 个系统集成用例：external ESM consumer、remote gateway loopback、SkillHub HTTP/文件系统。
- 新增 5 个系统级 E2E：remote deployment、telecom RAG+sandbox、SkillHub acquire-to-execute、failure/timeout/cancel、三宿主共享后端真相。
- `TC-SI-120..122` 同步当前 browser 来源场景；`TC-SI-122` 通过正式 candidate local/immersive 与版本匹配 test-host collaborative 入口验证单一事实失败原因、默认折叠和安全技术详情。
- 每个 `TC-SI-001..122` 都有唯一 execution file、唯一结果和独立 evidence；不存在 skip、todo、source-test result 复用或源码 package fallback。
- 当前公开 capability result 的 `STATUS_ONLY` 治理保持不变；TestClaw 通过 capability 元数据、最终回答、模型可见的受治理 metadata 和真实副作用验证能力，不重新暴露内部结果正文。
- remote workflow bridge 在 HTTP/SSE 反序列化边界恢复 `Date`，保持 local/remote workflow result contract 同形；新增对应单元测试。
- `agent-contracts`、产品 Web API、runtime lifecycle、gateway persistence owner 和浏览器 ownership 未被修改。

## 核心证据

| 验证 | 结果 |
|---|---|
| `npm --prefix tests/TESTClaw run test:system-integration` | PASS；runId `b80c3da5-df98-4eb4-a452-706f7af98622`；122/122 |
| report 分层与 evidence | INTEGRATION 3/3；E2E 119/119；122 refs 全部唯一、可解析、identity 匹配 |
| source sync | fixed 41/41；backend 49/49（20 files）；browser 24/24（7 files） |
| TestClaw manifest/report/runner/source-sync/traceability | 5 files、18 tests passed |
| 10 个主线刷新失败场景定向复验 | backend 8/8、browser 2/2 passed |
| `TC-SI-122.spec.ts` 定向复验 | 1/1 passed |
| Workflow remote bridge targeted UT | 1/1 passed |
| TestClaw local host artifact build | PASS |
| 当前源码 win32-x64 with-frontend candidate | build、pack、全新解压 PASS |
| `openspec validate add-ts-system-integration-validation-gate --strict` | PASS |
| `npm run build` | PASS |
| `npm test` | 142 files、1578 tests passed |
| `npm run lint:architecture` | dependency policy PASS；45 files、279 tests passed |
| `git diff --check` | PASS |

## 已知仓库基线 follow-up

1. `npm run test:contract` 为 356/357 passed。`tests/contract/model-invocation-contracts.test.ts` 仍断言 inference options 恰好 8 个字段，而当前 `ModelInferenceOptionsSchema` 已包含第 9 个 `modelParams`；相关 schema/test 相对 `origin/main` 无分支差异。
2. `npm run test:smoke` 为 17/19 files、31/33 tests passed。`daily-happy-path.test.ts` 仍从已治理为空的 capability result 正文识别 Tool 名称；`extension-development.smoke.test.ts` 的 governed Write 未生成旧断言路径文件。单独复跑仍稳定失败，相关 smoke 文件相对 `origin/main` 无分支差异。
3. `frontend/agent-web` 的 `npm run build` 因 `src/features/chat/process/processDetails.ts:1293` 的 `targetEntry` 触发 TS7022；该文件相对 `origin/main` 无分支差异。当前正式 candidate browser E2E 24/24 与 TestClaw 122/122 已通过。
4. `openspec validate --all --strict` 为 268 passed、1 failed；失败来自其他 active change `add-bash-structured-argv` 的 Requirement `Bash Accepts Structured Argv Input` 缺少 SHALL/MUST。目标 change 定向 strict 已通过。

## 架构、安全与 KISS 审查

- 候选包和 external packages root 在 preflight 与执行前后做只读 hash 校验；TestClaw 不安装依赖、不下载 package、不回退源码 workspace。
- evidence root 与 restricted diagnostic root 互斥；credential、token、prompt、路径、raw provider error、stack 和本地诊断原文不得进入 report/evidence。
- runner 对缺失输入、失败、超时、不可用和缺失结果 fail closed，并保持 `FAILED > TIMEOUT > UNAVAILABLE > MISSING > PASSED` 唯一 verdict 优先级。
- browser 三宿主只验证公共投影与同一后端 canonical truth，不把 lifecycle、identity、Agent Scope、Owner Scope 或 persistence 迁移到前端。
- 测试专用 local/collaborative host artifact 只提供独立验证入口，不进入正式产品 artifact，也不形成平行业务语义。
- 本次刷新只增加一个 source-mapped wrapper，并复用既有 browser helper、manifest、runner、report 和 evidence contract；没有新增配置开关、平行 DTO、重复 runner 或 speculative abstraction。

## OpenSpec 完整性

- `F-10.8 → FN-10.31 → ts-system-integration-validation-gate` 保持唯一 Feature → Function → capability/spec 映射。
- proposal、design、spec、tasks 与 TestClaw manifest 对 122、3/119、41/49/24/3/5 的口径一致。
- activated 与 deferred coverage 分离；性能 gate 继续由 `ts-performance-test-gate` 独立拥有。
- `openspec instructions apply --change add-ts-system-integration-validation-gate --json` 为 `148 complete / 0 remaining`。

结论：本 change 已达到可独立执行、可重复验证、证据可追踪的完成态；push 结论为 **PASS WITH FOLLOW-UP**，上述 4 项主线基线应由各自 owner 单独修复。
