## 背景与问题（Why）

长期记忆当前存在三类会让后台治理“配置已启用但事实未被治理”的可靠性缺口。第一，memory core 的 list 查询在未指定 `minConfidence` 时默认使用 `0.3`，而 aging 的 decay 和 retention delete 扫描未覆盖低于该阈值的 retained record，导致低置信 ACTIVE 记忆无法继续衰减、低置信 ARCHIVED 记忆无法按保留期物理删除。第二，aging 与 extraction scheduler 使用固定间隔轮询并要求 cron 秒字段精确匹配，进程启动秒偏移可能让每日任务永久错过。第三，extraction 的 `timeoutMs` 只在输入查询前检查，没有约束 LLM、融合和写入阶段，后台 cycle 可能超过配置 deadline。

此外，稳定 memory-tools 行为已经允许 `FACTUAL` 字符串和 claim alias 输入，但原始 change 没有留下对应 refinement 追溯。本 change 同时把该既有兼容行为正式纳入可审查的增量规格，不扩展新的模型权限或 gateway contract。

## 变更范围（What Changes）

- aging 的 ACTIVE decay 与 ARCHIVED retention delete 扫描显式覆盖 `[0, 1]` confidence，不再继承普通读取的默认 `minConfidence=0.3`。
- aging 和 extraction scheduler 改为按 cron 下一分钟窗口对齐触发；支持并校验当前实现所需的六段、单值/`*`/`?` cron 子集，非法表达式在 app configuration boundary fail fast。
- extraction 为整个 cycle 建立单一 deadline/cancellation context，覆盖 trajectory query、LLM、融合读取和写入；超时后停止未开始工作，保留已完成 side effect 并返回 FAILED 或 PARTIAL 安全诊断。
- 正式记录 `add_memory` 的既有受控兼容输入：`FACTUAL` 非空字符串、`fact`/`text`/`value` claim alias 在 tool boundary 归一化为严格 core content；不得把 alias 或额外字段写入 gateway。
- 不修改 memory core gateway contract、SQLite schema、request terminal commit、context assembly、Web API 或 stream event。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `memory-aging`：修正全 confidence aging/retention scan 和可靠 cron 触发语义。
- `memory-extraction`：修正可靠 cron 触发和全 cycle deadline/cancellation 语义。
- `memory-configuration`：补充 memory scheduler cron 子集的 runtime schema validation 和非法配置拒绝。
- `memory-tools`：为既有 `FACTUAL` convenience input 建立正式 refinement 追溯，不改变 core persisted contract。

## 影响范围（Impact）

- 代码：`packages/agent-memory` scheduler、aging、extraction；`packages/agent-app` memory configuration validation。
- 测试：memory unit/resilience tests、真实 SQLite memory lifecycle integration/contract tests、configuration negative tests。
- 运维：已启用的 aging/extraction schedule 将按配置窗口可靠执行；非法 cron 在启动配置阶段显式失败。
- 安全与一致性：owner scope、agent scope、SafeError、observability redaction 和 request terminal state 不变。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/memory-aging/spec.md`：补充全 confidence lifecycle scan 与可靠 schedule 行为。
- `openspec/specs/memory-extraction/spec.md`：补充可靠 schedule 和全 cycle deadline 行为。
- `openspec/specs/memory-configuration/spec.md`：补充 memory cron 子集校验与 fail-fast 语义。
- `openspec/specs/memory-tools/spec.md`：保留并正式归并 FACTUAL convenience input refinement。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/memory.md`：补充后台 lifecycle 全 confidence 扫描、scheduler 对齐和 cycle deadline。
- `openspec/designs/modules/agent-memory.md`：补充 scheduler/deadline 实现职责。
- `openspec/designs/modules/agent-app.md`：补充 memory cron 配置校验职责；若当前文档已有统一配置 owner 描述则只增加导航摘要。
- `openspec/designs/adr/memory-background-scheduling.md`：记录采用分钟窗口对齐、受限 cron 子集和单 cycle deadline 的长期决策。
- `openspec/designs/spec-to-design-map.md`：更新上述 capability 的设计与验证入口。

验证入口：
- `packages/agent-memory/tests/memory-aging.test.ts`
- `packages/agent-memory/tests/memory-extraction.test.ts`
- `tests/contract/memory-core-contracts.test.ts`
- `tests/contract/memory-configuration-contracts.test.ts`
- `tests/agent-kernel/memory-runtime-integration.test.ts`
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`
