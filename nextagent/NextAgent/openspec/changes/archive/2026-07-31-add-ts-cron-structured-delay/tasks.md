## 1. Tool 契约与投影

- [x] 1.1 将 Cron input/output schema 改为 action-aware union，支持结构化 delay、cron/delay 互斥和 delay one-shot 约束。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/cron-tools.test.ts` 覆盖正常、冲突、未知字段、负数、小数、零值和超上限。
  来源：Requirement: Cron Tool 结构化相对延迟创建；design 决策 1。
- [x] 1.2 扩展 `CronTaskPort.addTask` schedule union 和 Tool create result，移除 Tool 内时间读取。
  验证：Cron unit test spy 精确断言 delay input/result；`rg "Date\.now" packages/agent-capability/src/builtins/cron/cron-tool.ts` 无匹配。
  来源：两个 requirements；design 决策 2。
- [x] 1.3 扩展 Cron create safe projection，仅 allowlist 结构化 delay并保持 list/prompt 边界。
  验证：`packages/agent-channel-web/tests/cron-result-projection.test.ts`。
  来源：proposal safe result；design 决策 5。

## 2. 可信时间与 durable 创建

- [x] 2.1 在 gateway adapter 单次读取 clock，完成安全归一化、分钟向上取整、兼容 cron 和冻结 `nextRunAt`。
  验证：fake-clock tests 覆盖 1h10m、90m、48h、23:55:30+10m、最大值和 overflow 零写入。
  来源：Requirement: Cron 相对延迟使用可信分钟调度；design 决策 3、4。
- [x] 2.2 将 app-owned clock 注入 Cron adapter，并同步 test-only in-memory fixture。
  验证：`packages/agent-app/tests/cron-runtime-composition.test.ts` 与 Cron focused tests。
  来源：design 决策 3；可测试性结论。

## 3. 产品路径和恢复

- [x] 3.1 增加模型 delay create 与 durable adapter/one-shot trigger 集成验证，证明冻结时间不重算、无 sandbox 仍创建。
  验证：Cron capability integration、gateway adapter fake-clock、既有 local scheduler/full unit tests。
  来源：Requirement: Cron 相对延迟使用可信分钟调度；可靠性结论。
  结果：新增 capability integration 与 adapter tests 通过；既有 full unit 中 local scheduler/one-shot trigger 路径通过。SSE replay 缺陷不纳入本 change，且未修改其既有测试。

## 4. 验证和审查

- [x] 4.1 运行 build、unit、contract、architecture、focused integration 和 OpenSpec strict validation。
  验证：标准五项门禁与 Cron release tests。
  来源：AGENTS 验证门禁；design 验证映射。
  结果：build、unit 848/848、contract 295/295、architecture 224/224、OpenSpec 218/218 通过；新增 focused 20/20 通过。release config 的两个旧 session-scope 断言与当前 owner+Agent 实现不一致，不属于默认 gate 且未被本 change 修改。
- [x] 4.2 使用 `nextagent-skill-review` 检查唯一实现路径、无 agent-contracts/system-prompt/sandbox/REST contract 变化并清理临时产物。
  验证：审查 PASS；`git diff --check`；预期范围 status。
  来源：AGENTS OpenSpec 与实现质量门禁。
  结果：PASS；需群内确认：None。前序 change 归档顺序及 3.1/4.1 记录的既有测试基线差异不构成本 change 的评审阻断项。

## 归档前更新基线检查（非实施任务）

先归档 `add-ts-cron-tools`，再按 proposal/design 更新 cron-tools stable spec、overview、cron-task-execution architecture、agent-capability/agent-app modules、cron-scheduling-boundary ADR 和 spec-to-design-map。
