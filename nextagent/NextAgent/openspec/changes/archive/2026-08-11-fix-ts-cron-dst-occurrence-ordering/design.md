## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.9 Cron 工具` | 保证进程本地 Cron 的下一次命中严格位于起点之后，并冻结 DST 缺口与重叠行为 | `cron-tools` | `FN-10.9 Cron 工具` |

## `FN-10.9 Cron 工具`

### 目标与规范依据

Cron 任务继续使用现有五段表达式、进程本地时区和 UTC `nextRunAt`，但任何下一次日历命中都必须严格晚于计算起点，且 DST 缺口与重叠只有一种可验收解释。

#### 本 Function 的目标 Requirements

canonical spec：`cron-tools`

- `ADDED`：`Cron 本地日历匹配保持未来顺序`

### 当前实现

- `packages/agent-capability/src/builtins/cron/cron-expression.ts` 已拥有五段 cron parser、日历字段匹配和 `nextCronRunMs` 入口。
- `findNextOccurrence` 清零输入秒和毫秒后，使用本地 `Date` setter 推进游标，并在字段匹配时直接返回。
- ECMAScript `Date` 在 DST 重叠本地时间上选择较早 offset。起点位于回退后的第二个重复小时内时，游标可能移回较早 offset，而当前返回分支没有校验 candidate 是否晚于 origin。
- `LocalCronTaskScheduler` 只消费注入的 `computeNextRunAt` 并以 UTC epoch 判断到期；Cron Record、SQLite row、claim transaction 与 trigger 幂等锚点不是本次缺陷来源。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `nextRunAt` 严格晚于输入起点 | 字段命中后不比较 candidate 与 origin 的 epoch 顺序 | DST 重叠窗口可以返回过去的 instant |
| 春季不存在分钟被跳过 | 当前依赖 `Date` setter 的隐式跳转 | 缺少明确、可重复的验证证据 |
| 秋季重复分钟只采用较早 offset 一次 | 从切换前遍历时满足，但从第二个重复小时起算会回到过去 | 缺少顺序门禁和两个方向的测试 |

### 修改方案

`agent-capability` 是本 change 的唯一主要 owner 和唯一生产代码写入模块。保留现有 parser、字段数组、day matching、搜索上限和本地 `Date` setter 推进路径，只收紧 `findNextOccurrence` 的命中返回分支：

1. 记录不可变的 `originEpochMs`。
2. 字段全部匹配后，仅当 `cursor.getTime() > originEpochMs` 时返回 candidate。
3. candidate 不晚于起点时，沿用现有本地分钟推进继续搜索。
4. 达到既有搜索上限仍无未来 candidate 时，继续返回 `null`。

该路径利用既有 `Date` setter 对 DST 缺口的前向归一化和对 DST 重叠的较早 offset 选择，并以 epoch 顺序门禁消除过去结果。它不改 parser，不引入 UTC 分钟扫描或日期依赖，也不改变 scheduler、gateway、持久化或 trigger claim。失败路径维持既有 `null` 结果，因此无需兼容迁移或回滚数据。

测试在 `packages/agent-capability/tests/cron-expression.test.ts` 使用固定 ISO instant 和受控 `TZ`。每个时区用例必须保存并在 `finally` 中恢复原 `TZ`，避免污染同 worker 的其他用例。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；由功能性 Requirement 派生 | 返回前执行严格 epoch 顺序门禁 | DST 重叠中不得返回过去或第二个重复分钟 |
| 可测试性 | 无新增黑盒质量目标；由 Requirement Scenarios 派生 | 受控进程时区与固定 instant | UTC、spring gap、fall overlap 均有确定断言 |
| 审计/可追溯性 | 无新增黑盒质量目标；由功能性 Requirement 派生 | 不改变 trigger fact，只保证 occurrence 顺序合法 | 新 `nextRunAt` 始终晚于 origin |

## 验证策略（Verification Strategy）

- Unit：验证普通顺序、spring gap、fall overlap 和第二个重复小时。
- Characterization：保留 parser、day matching、搜索上限和 UTC 行为。
- Negative：断言不得返回过去或较晚 offset 的重复分钟。
- Integration regression：运行 LOCAL Cron scheduler 既有测试，确认到期比较、claim 和 delivery 未改变。
- Architecture/contract：确认不修改 `agent-contracts`、gateway Record、SQLite schema、配置或依赖图。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/cron-tools/spec.md`：增加本地日历严格未来顺序和 DST 行为。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.9-Cron工具.md`：移除过期“在建”表述，刷新主规格、处理过程、结果和规格摘要。
- `openspec/designs/features/D10-二次开发与平台集成/D10.3-测试与扩展/F-10.9-Cron工具.md`：补充 DST 确定性质量保证摘要。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/core-contracts.md`：无；本 change 落实现有日历规则。
- `openspec/designs/architecture/`：无其他更新。
- `openspec/designs/modules/agent-capability.md`：补充 Cron 日历求值和验证入口。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：增加 `cron-tools` 导航与验证入口。

## 风险与取舍（Risks / Trade-offs）

- 继续依赖 Node.js `Date` 的进程本地 DST 规则；以固定 Node runtime 和受控 DST 测试约束行为。显式任务时区属于后续独立 change，不在本 change 预埋抽象。
- 秋季重叠采用较早 offset；在第二个重复小时内创建当日相同分钟任务时，该日唯一命中已过去，下一次进入后续日历日。这避免重复触发并保持现有正常遍历行为。
- `refine-ts-cron-tool-guidance` 修改 `cron-tools` 的另一 Requirement；两者没有相同合并键，后归档者必须基于届时 stable spec 重新 strict validation。

## 待确认问题（Open Questions）

无。
