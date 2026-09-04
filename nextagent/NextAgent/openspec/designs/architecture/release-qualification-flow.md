# 发布资格链路

## 背景（Background）

本设计承载稳定的本地 runtime 发布资格事实。发布加固把候选包的可发布性固化成一条固定、最小、可追溯、fail-closed 的资格链路。它消费上游权威证据；它不定义子系统事实，也不成为发布治理平台。

## 决策（Decisions）

### D1. 结论只能来自固定链路

唯一执行入口是 `npm run release:qualify -- --candidate <candidate-root> --scope <scope-file>`。应用入口是 `agent-app/src/release/run-release-qualification.ts`。它只接受 candidate 和 scope。它不得接受任意 shell 命令、预构建的结论、必需检查的跳过标志或调用方自有的报告目录。

### D2. 必需命令固定

`release:qualify` 只调用这些标准命令：

- `npm run test:contract`
- `npm run lint:architecture`
- `npm run test:gate:security`
- `npm run test:gate:resilience`
- `npm run test:e2e:release-package -- --candidate <candidate-root> --scope <scope-file>`
- `npm run test:e2e:product-journey -- --candidate <candidate-root> --scope <scope-file>`
- `npm run test:gate:capacity -- --candidate <candidate-root> --scope <scope-file>`

退出码 `0` 为 `PASSED`，非零为 `FAILED`，命令缺失为 `MISSING`，超时为 `TIMEOUT`。可选的 JSON 报告可以补充安全原因和证据引用，但不能把失败变成通过。

### D3. 阶段顺序固定

阶段顺序是：输入校验、硬门禁、release-package 证据、config 证据解引用、健康证明、产品旅程 smoke、容量基线、结论聚合。

所有硬门禁都在候选包构建或启动之前运行。任何非 `PASSED` 的必需阶段返回 `BLOCKED`；阻塞阶段之后的阶段不再运行。

### D4. 上游 owner 产生证据

release-package 命令调用真实 candidate root 并产生完整的 `PackageCandidateEvidence` 和 `HealthProof`。资格链路只消费已校验的结构；它不接受调用方预构建的 package 证据，也不定义另一种 health/config 证据形态。

`PackageCandidateEvidence.configValidationEvidenceRef` 指向来自实际 candidate 启动的精确 `ConfigValidationEvidence`。`BLOCKED` 的 config 证据阻塞发布。`DEGRADED_READY` 只有在其降级被显式声明并批准时才能继续。

### D5. ReleaseQualificationResult 是唯一的结论形态

唯一输出类型是 `ReleaseQualificationResult`，包含 `candidateId`、`qualificationStatus`、`blockingReasons[]`、`declaredDegradations[]`、`evidenceRefs[]` 和 `evaluatedAt`。不得新增 `ReleaseVerdict` 或等价的平行结果对象。

结论和证据引用不得包含 prompt、模型输出、原始 provider 错误、credential、原始路径、stack 或高基数字段。

## 归属（Owners）

- `agent-app`：发布资格 CLI/应用入口、固定命令编排、结果规范化、release 输入构建器和结论聚合。
- 门禁 owner：维护其标准命令和安全机器可读输出。
- release-package E2E owner：从实际 candidate 产生候选包证据、启动证明和 health/readiness 证明。
- Health owner：提供 health/readiness 事实；`agent-app` 通过公开 release helper 将其映射为 `HealthProof`。

## 验证（Verification）

- 发布资格 contract 测试
- 固定命令调用 integration 测试
- 命令/报告缺失阻塞测试
- package 证据和 config 证据关联测试
- health proof 映射测试
- smoke scope 校验测试
- 容量状态校验测试
- `npm run release:qualify -- --candidate <candidate-root> --scope <scope-file>`
- `openspec validate --all --strict`

## 文档（Documentation）

- Spec：`local-runtime-release`
- Package 证据边界：`openspec/designs/architecture/local-runtime-packaging.md`
- 主设计：`openspec/designs/architecture/release-qualification-flow.md`
- 模块设计：`openspec/designs/modules/agent-app.md`
