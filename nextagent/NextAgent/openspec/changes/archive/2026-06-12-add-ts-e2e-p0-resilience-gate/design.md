## 背景和现状（Context）

已有恢复相关 change 定义了 lastSeenSequence replay、local process restart recovery 和非幂等 capability replay guard。本 gate 不再定义恢复规则，只用真实故障证明规则跨 process/network/persistence 边界成立。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 可控断开真实 stream connection，并基于最后确认 sequence 恢复。
- 可控终止并重启真实 local product process，复用同一持久化目录验证 run 收敛。
- 使用真实副作用 probe 证明不确定恢复点不会重复执行非幂等 capability。

**非目标：**
- 不验证 PaaS 多实例、distributed lease 或 non-sticky routing。
- 不把普通 cancel/retry/edit 成功路径复制到本 gate。
- 不重新定义 recovery timeout 或状态机。

## 设计决策（Decisions）

### D1. 唯一执行路径

`npm run test:e2e:resilience` 使用受控 process controller 启动 candidate，测试可在预定义故障点断开连接或终止进程，随后使用相同 candidate 配置和 persistence root 重启。故障注入只存在于测试 composition，不进入产品入口。

### D2. 用例唯一归属

| 用例 | 主要验证目标 |
|---|---|
| e2e-P0-05 | 断连后基于 lastSeenSequence 恢复且终态一致 |
| e2e-P0-27 | process restart 后 queued/executing run 恢复或安全失败 |
| e2e-P0-28 | 非幂等 capability 在不确定恢复点不重复执行 |

### D3. 可观察不变量

恢复前后必须使用同一 session/run 持久化事实验证：sequence 不回绕或重复、最多一个 terminal result、history 与 terminal result 一致、非幂等副作用 probe 次数不超过一次。仅观察 UI 文本不足以满足本 gate。

### D4. 失败和清理

无法触发目标故障点、重启失败、恢复未在测试定义的有界 timeout 内收敛、持久化状态不可读取或临时 process 未关闭，均视为 gate failed。

### D5. 最小实现边界

故障控制只允许存在于 test composition、process controller 或测试 fixture，不得进入产品 entrypoint、产品配置 schema、runtime public API 或 candidate package。side-effect probe 只服务 e2e-P0-28，不得泛化为新的 capability replay framework 或产品可见幂等策略。统一不变量断言只读取已有 session/run 持久化事实和 stream/history 外部结果，不新增 recovery 状态或 checkpoint contract。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 测试控制接口仅在 test composition 可用，不进入产品入口 | architecture/source assertion |
| 性能/容量 | 只定义有界收敛 timeout，不定义生产恢复 SLA | resilience report |
| 可靠性/恢复 | 验证 sequence、terminal、history 和副作用不变量 | resilience E2E |
| 可维护性 | 三个真实故障 case 唯一归属 | inventory check |
| 可测试性 | 故障点显式、可重复，不依赖随机 kill timing，且不进入产品入口 | fixture tests + architecture assertion |
| 审计/可追溯性 | report 记录故障点、恢复阶段和安全 evidence ref | report assertion |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 真实断连和 process restart | 1.1、2.1、2.2 | `npm run test:e2e:resilience` |
| 非幂等能力不重复执行 | 2.3 | side-effect probe assertion |
| test control 不进入产品入口 | 3.1 | architecture negative assertion |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-e2e-resilience-gate/spec.md`
- E2E 故障和 evidence：`openspec/designs/architecture/e2e-quality-gates.md`
- 恢复验证导航：`openspec/designs/architecture/request-run.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 随机时序造成 flaky。 -> 只允许显式测试故障点和可观察持久化屏障。
- [风险] 测试控制能力泄漏到产品。 -> test composition 独占并增加 architecture negative assertion。

## 测试归属整合（Test Ownership Consolidation）

保留低层 recovery characterization tests；将真实连接和 process lifecycle 场景集中到本 gate。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/ts-e2e-resilience-gate/spec.md`。
- 更新 `openspec/designs/architecture/e2e-quality-gates.md`、`openspec/designs/architecture/request-run.md` 和 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
