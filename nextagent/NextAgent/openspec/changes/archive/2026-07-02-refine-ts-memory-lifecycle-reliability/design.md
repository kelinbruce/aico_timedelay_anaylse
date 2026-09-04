## 背景和现状（Context）

Memory core 将普通 list/search 的默认 `minConfidence` 固定为 `0.3`，这是用户检索噪声控制，不是 lifecycle policy。当前 aging 复用 list port 时未覆盖该默认值，使 lifecycle coverage 被检索策略意外截断。Aging 与 extraction scheduler 以 60 秒 `setInterval` 调用精确到秒的 cron matcher；若进程启动秒不为 cron 秒值，轮询相位会长期错开。Extraction 仅在 trajectory query 前比较耗时，没有创建覆盖整个 cycle 的 deadline signal。

本 change 只调整 `agent-memory` orchestration 和 `agent-app` 配置校验。Gateway contract、SQLite schema、owner/agent scope、request terminal commit 和 observability shape 保持不变。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- aging 通过 public list port 覆盖全部 retained confidence，并确保低置信 archive 可按期物理删除。
- memory cron 采用可验证的六段受限语法，并按分钟窗口匹配，消除进程启动秒相位依赖。
- extraction 使用一个 cycle deadline，向 LLM 等可取消慢边界传播信号，并正确表达 timeout 前的部分完成。
- 为既有 FACTUAL convenience input 建立 OpenSpec refinement 追溯。

**非目标：**

- 不引入 cron 第三方依赖，不支持列表、范围、步长、月份/星期名称或秒级 memory job。
- 不修改 gateway port 以增加 `AbortSignal`；local atomic persistence 仍以事务一致性优先。
- 不改变 memory ranking、decayFactor、retention 配置默认值或 lifecycle 状态机。
- 不修改 runtime scheduler lane、terminal commit、context assembly 或 model-facing权限。

## 设计决策（Decisions）

### 1. Lifecycle 查询显式覆盖普通检索默认值

Aging 的 ACTIVE 和 ARCHIVED list query 均显式传 `minConfidence: 0`。该值表达 lifecycle owner 需要扫描所有 retained facts，而不是修改 core 的普通读取默认值。测试替身必须实现与真实 gateway 相同的 minConfidence 过滤，另用真实 SQLite contract/integration test 验证跨 cycle 行为。

### 2. Cron 采用分钟窗口匹配和受限六段语法

保留现有轻量 `setInterval` scheduler，但 `isMemory*AgingCronDue` 不再要求当前秒与 cron 秒精确相等；配置边界要求第一段必须为 `0`，其余字段只允许单个整数、`*` 或 `?`。Matcher 使用当前本地年月日时分，并用 `lastScheduledAt` 保证同一分钟最多运行一次。

该方案比引入 cron library 或递归计算下一绝对触发时间更小，足以覆盖当前每日低峰调度契约；不支持的表达式在 app readiness 前显式拒绝，而不是静默永不触发。

### 3. Extraction cycle 只创建一个 deadline owner

`runMemoryExtractionCycle` 在通过 enabled/config 前置检查后创建一个 deadline controller，并把调用方 signal 合并到同一 cycle signal。多 scope 执行复用该 deadline，不为每个 scope重置预算。Timer 到期时标记 `timedOut=true` 并 abort；所有阶段通过统一 stop reason 将 deadline abort 映射为 `MEMORY_EXTRACTION_TIMEOUT`，外部 abort 映射为 `MEMORY_EXTRACTION_CANCELED`。

LLM strategy 接收 cycle signal。Gateway public contract 不因本 change 改动；每个不可中断的 local atomic write 完成后立即复查 deadline，保留已经提交的结果，停止后续 candidate。已有成功写入时 diagnostic 为 PARTIAL，否则为 FAILED。

### 4. FACTUAL convenience input 只属于 tool adapter

现有 `memory-tools` 归一化行为保持不变：字符串和 claim aliases 在 `agent-memory` tool implementation 内转换，gateway request 只包含 core-defined content。公共 capability executor 和 gateway contract 不增加 memory-specific branch。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | scope 来源、工具输入拒绝、日志脱敏不变；cron 非法输入在配置边界拒绝。 | configuration negative tests、memory architecture tests |
| 性能/容量 | aging 仍受 batchLimit；全 confidence 扫描不取消分页上限。Cron 每分钟最多检查一次。 | aging batch tests、scheduler unit tests |
| 可靠性/恢复 | 低置信记录不再逃逸 lifecycle；scheduler 不依赖启动秒；extraction deadline 不在 scope 间重置。 | SQLite lifecycle integration、timeout/resilience tests |
| 可维护性 | 不引入依赖；cron validation/matching 共享一个 app-public-free helper，memory 模块只消费已验证 schedule。 | build、lint:architecture、code review |
| 可测试性 | matcher、validator 和 deadline stop reason 均可由确定性时间/信号测试；真实 gateway 补充黑盒回归。 | focused Vitest suites |
| 审计/可追溯性 | 保留现有 safe reason code；FACTUAL compatibility 由 active change 追溯。 | OpenSpec strict validation、diagnostic assertions |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Aging 覆盖 `[0,1]` confidence | 2.1-2.2 | memory-aging unit + SQLite integration |
| Cron 与启动秒无关且一分钟至多一次 | 3.1-3.3 | aging/extraction scheduler tests |
| 非法 cron fail fast | 3.1、3.3 | memory configuration contract tests |
| Extraction timeout 覆盖全 cycle | 4.1-4.3 | hanging LLM、partial write resilience tests |
| FACTUAL tool input 不扩大 core | 1.2、5.1 | memory-tools provider tests、architecture review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/memory-aging/spec.md`、`memory-extraction/spec.md`、`memory-configuration/spec.md`、`memory-tools/spec.md`。
- 架构和跨模块设计：`openspec/designs/architecture/memory.md` 主承载 background lifecycle、scope、deadline 和 tool/core 边界。
- 模块设计：`openspec/designs/modules/agent-memory.md` 主承载 scheduler/orchestration；`agent-app` 配置文档只承载 cron validation owner。
- ADR：`openspec/designs/adr/memory-background-scheduling.md` 主承载受限 cron、分钟窗口和 cycle deadline 取舍。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [受限 cron 不支持复杂表达式] -> 配置阶段明确拒绝，未来需要时通过独立 refinement 引入完整 parser。
- [Event loop 阻塞可能跳过整个分钟] -> 当前后台任务只承诺进程正常调度下的分钟窗口；不增加 durable scheduler。跨进程补偿需独立 anchored job change。
- [Local atomic gateway write 无法中途取消] -> deadline 后不启动新写入，已开始事务完成并计入结果，避免不确定提交状态。
- [全 confidence scan 增加候选量] -> 继续受 batchLimit、分页和 timeout 约束。

## 迁移计划（Migration Plan）

无数据迁移。发布前先校验现有 memory schedule 是否属于受支持子集；不符合的部署配置必须改为六段单值/通配形式。代码回滚不会改变已持久化 record shape，但会重新暴露低置信 lifecycle 和调度可靠性缺口。

## 归档前更新基线（Baseline Promotion Plan）

- 更新四个 stable memory specs，归并新增 requirement，避免重复定义。
- 更新 `openspec/designs/architecture/memory.md` 和 `openspec/designs/modules/agent-memory.md`。
- 按现有 agent-app module 文档结构补充 cron validation owner。
- 新增 `openspec/designs/adr/memory-background-scheduling.md`。
- 更新 `openspec/designs/spec-to-design-map.md` 的设计与验证导航。

## 待确认问题（Open Questions）

无。
