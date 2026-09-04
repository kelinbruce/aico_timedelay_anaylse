## 1. 规格与既有兼容边界

- [x] 1.1 严格验证 active change artifacts，并确认四个 modified capability 均有可执行场景。
  验证：`openspec.cmd validate refine-ts-memory-lifecycle-reliability --strict`
  来源：proposal Capability 影响；design 验证映射
- [x] 1.2 验证既有 FACTUAL string/claim alias 只在 memory tool boundary 归一化，未扩大 gateway contract 或公共 executor。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-tools-provider.test.ts tests/architecture/memory-extraction-boundary.test.ts`；code review 检查 `agent-capability` 无 memory-specific branch
  来源：spec `FACTUAL convenience input is normalized only at the memory tool boundary`

## 2. Aging 全 confidence lifecycle

- [x] 2.1 在 ACTIVE decay 和 ARCHIVED delete list query 中显式使用 `minConfidence: 0`，保持 scope、state、pin、time 和 batch 约束不变。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-aging.test.ts`
  来源：spec `Aging scans cover the full retained confidence range`；design 决策 1
- [x] 2.2 增加真实 SQLite 回归，验证低于 0.3 的 ACTIVE 继续衰减/归档，低于 0.3 的到期 ARCHIVED 被物理删除。
  验证：`npx.cmd vitest run tests/contract/memory-core-contracts.test.ts tests/agent-kernel/memory-runtime-integration.test.ts`
  来源：spec `Low-confidence ACTIVE memory continues to decay`、`Low-confidence ARCHIVED memory is physically deleted`

## 3. Memory cron 配置和调度

- [x] 3.1 在 app configuration owner 中校验受支持的六段 memory cron 子集，并拒绝非零秒、列表、范围、步长、名称、字段数量和范围非法表达式。
  验证：`npx.cmd vitest run tests/contract/memory-configuration-contracts.test.ts tests/agent-kernel/config-assembly.test.ts`
  来源：spec `Memory scheduler cron configuration is validated before readiness`；design 决策 2
- [x] 3.2 将 aging 和 extraction cron due 判断改为分钟窗口匹配，并用 lastScheduledAt 保证同一分钟最多一次。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-aging.test.ts packages/agent-memory/tests/memory-extraction.test.ts`
  来源：spec `Aging schedule is independent of process startup second`、`Extraction schedule is independent of process startup second`
- [x] 3.3 增加任意启动秒数触发和非法 cron negative tests，实际断言 scheduler 在目标分钟触发且非法配置不 ready。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-aging.test.ts packages/agent-memory/tests/memory-extraction.test.ts tests/contract/memory-configuration-contracts.test.ts`
  来源：spec cron scenarios；tasks negative verification rule

## 4. Extraction 全周期 deadline

- [x] 4.1 为单次 extraction cycle 创建一个 timeout controller，并在多 scope、LLM、融合和写入阶段复用同一 signal/deadline。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-extraction.test.ts`
  来源：spec `Extraction timeout governs the complete cycle`；design 决策 3
- [x] 4.2 超时后停止启动新工作，将无成功写入映射为 FAILED、已有成功写入映射为 PARTIAL，并保留安全计数和 reason code。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-extraction.test.ts`
  来源：spec timeout scenarios
- [x] 4.3 增加 hanging LLM、写入后超时、外部 cancellation negative tests，断言不会继续后台写入。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-extraction.test.ts tests/agent-kernel/memory-runtime-integration.test.ts`
  来源：spec `Hanging LLM is canceled by the cycle deadline`、`Timeout after a completed write is partial`

## 5. 验证和收尾

- [x] 5.1 运行目标 build、unit、contract、architecture 和 OpenSpec strict validation。
  验证：`npm.cmd run build`、`npm.cmd test`、`npm.cmd run test:contract`、`npm.cmd run lint:architecture`、`openspec.cmd validate --all --strict`
  来源：AGENTS.md 验证门禁；design 质量属性
- [x] 5.2 检查实现未修改 frozen core contract、SQLite schema、runtime terminal lifecycle、context assembly 或 Web/stream surface，并清理本次产生的 dead code。
  验证：`git diff --check`；`git diff -- packages/agent-contracts packages/agent-runtime packages/agent-context-engine packages/agent-channel-web`；模型 code review 检查点
  来源：proposal 非目标；design 模块边界

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前：

- 归并四个 memory stable specs，避免重复 requirement。
- 更新 `openspec/designs/architecture/memory.md` 和 `openspec/designs/modules/agent-memory.md`。
- 按现有 app 配置文档结构补充 cron validation owner。
- 新增 `openspec/designs/adr/memory-background-scheduling.md`。
- 更新 `openspec/designs/spec-to-design-map.md` 和验证入口。
