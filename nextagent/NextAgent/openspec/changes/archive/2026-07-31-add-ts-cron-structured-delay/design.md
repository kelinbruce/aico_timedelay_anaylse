## 背景和现状（Context）

当前产品已有 `Cron` Tool → `CronTaskPort` → durable `CronTaskGatewayPort` → LOCAL/REMOTE trigger → runtime submit 主路径；最新 main 还增加了独立 REST management surface。Tool 目前重复使用 `Date.now()` 检查 cron，adapter 再读取 `now()` 计算 `nextRunAt`。`cron-tools` 仍处于已完成待归档 change，因此本 change 以当前代码为增量基线并在其后归档。

## 目标和非目标（Goals / Non-Goals）

**目标：**结构化表达 days/hours/minutes；系统归一化 1..525600 分钟；单次可信时钟读取；向上取整分钟；复用既有 durable one-shot 路径。

**非目标：**不增加秒/月/年/工作日/runAt/周期 delay；不修改标准 cron；不修改 system prompt、sandbox、gateway/channel contracts、REST API 或持久化 schema。

## 设计决策（Decisions）

1. `cronInputSchema` 使用 action-aware `oneOf`。create 分为标准 cron 与结构化 delay 两个互斥分支；delay object `additionalProperties=false`，字段为非负整数。schema 拒绝明显非法 shape，adapter 负责总量与安全整数校验。
2. `CronTaskPort.addTask` 使用仅属于 `agent-capability` 的判别联合：`{cron, recurring}` 或 `{delay, recurring:false}`。Tool 不读取时间；标准 cron 的 future-match 检查也统一下沉 adapter，避免双时钟。
3. adapter 是唯一计算 owner。它调用一次注入 `now()`，用安全整数算术归一化总分钟，计算 `ceil((createdAt + delayMs)/60000)*60000`。app composition 必须注入已有 monotonic clock。
4. durable contract 不变。delay task 写入根据冻结目标生成的本地时区 `minute hour day month *` 兼容 cron、`recurring=false` 和权威 `nextRunAt`。首次 claim 后既有状态机完成任务，不从 cron 生成第二次执行。
5. create result 回显原始 delay 和 `Once after ...` 摘要；list 仍展示 durable cron/humanSchedule，不伪造原始 delay。Web safe projection只为 create allowlist 增加 delay。
6. REST management 面向机机标准 cron 且由独立 channel contract 拥有，本 change 不扩大它；若产品要求 REST 相对任务，必须另开 channel contract refinement。

放弃 Bash/CurrentTime Tool、system prompt 时间和自定义 `+10 +1` cron，因为它们仍让模型换算、依赖 sandbox 或破坏标准语法。放弃新增 gateway schedule union，因为 `nextRunAt` 已足够保证一次性执行。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | scope 仍来自 trusted context；未知字段 fail closed；不暴露物理时间/路径/prompt | schema negative、projection tests |
| 性能/容量 | O(1) 加法和取整；任务上限与扫描批量不变 | adapter/unit tests |
| 可靠性/恢复 | 创建时冻结 `nextRunAt`；重启和 misfire 继续使用 durable fact；one-shot claim 不变 | SQLite/scheduler/e2e |
| 可维护性 | 只扩展现有 SPI/adapter，gateway contract 不变 | build、architecture review |
| 可测试性 | fake clock 覆盖跨日、取整、自然大字段和溢出 | focused tests |
| 审计/可追溯性 | 复用 `CRON_TASK_CREATED` 和 task id，不新增高基数字段 | observation tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| schema 互斥、one-shot、边界 | 1.1 | cron-tools tests |
| 单 clock、归一化、向上取整 | 1.2、2.1 | fake-clock adapter/app tests |
| durable/重启/trigger 不回归 | 2.2、3.1 | SQLite/scheduler/product tests |
| safe projection 和无 sandbox | 1.3、3.2 | projection/product tests |
| 全仓门禁 | 4.1、4.2 | standard commands + semantic review |

## 文档承载决策（Documentation Ownership）

行为归 `specs/cron-tools`；跨模块时间流程归 `architecture/cron-task-execution.md`；SPI/adapter 与 clock wiring 分别归 `modules/agent-capability.md`、`modules/agent-app.md`；取舍归 `adr/cron-scheduling-boundary.md`；导航归 spec-to-design-map。

## 风险与取舍（Risks / Trade-offs）

- [兼容 cron 只有分钟精度] -> 权威 `nextRunAt` 同样量化到分钟，二者一致。
- [days 的日历歧义] -> 明确定义为固定 24 小时；日历时间不属于 delay。
- [前序 change 未归档] -> 固定归档顺序，实施可基于 main 当前代码。
- [REST 未同步 delay] -> 明确入口差异和后续 contract refinement 门禁，不在本 change 偷渡 public contract。

## 迁移计划（Migration Plan）

无数据迁移。旧 cron 调用兼容；回滚后已创建 delay task 仍是合法 one-shot durable record并按冻结时间执行。

## 归档前更新基线（Baseline Promotion Plan）

先归档 `add-ts-cron-tools`，再更新 `specs/cron-tools`、overview、`architecture/cron-task-execution.md`、`modules/agent-capability.md`、`modules/agent-app.md`、`adr/cron-scheduling-boundary.md` 和 spec-to-design-map。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.9-Cron工具` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/cron-tools/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
