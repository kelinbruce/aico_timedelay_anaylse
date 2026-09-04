## 背景和现状（Context）

长期记忆已经形成 core、configuration、tools、extraction、aging 的完整链路，但当前稳定规格和实现仍把多个关键开关默认设为关闭：

- `packages/agent-app/src/config/validation.ts` 中 `memory.enabled` 只有显式 `true` 才开启。
- `memory.extraction.enabled` 和 `memory.aging.enabled` 缺省为 `false`。
- memory tools 通过现有 exposure gate 依赖 `MemoryConfig.status=VALID`、Agent capability binding 和 memory core 可用性；产品内置 `default-agent` 需要在 `agent.yaml` 中显式绑定 memory tools 才能让默认黑盒路径实际可用。
- extraction / aging scheduler 已经在运行时检查 schedule 是否存在；当前代码形态是两个内部 scheduler，而不是一个统一 dreaming scheduler。

当前 gap：用户省略 memory 配置时，长期记忆黑盒效果是 disabled；这与“长期记忆能力 ready 后默认可用”的产品目标不一致。本 change 调整默认配置语义，并通过内置 `default-agent/agent.yaml` 显式绑定 memory tools；不引入新的 memory backend、gateway、工具 schema、数据库字段或运行时入口。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 省略 `nextAgent.memory.enabled` 时，长期记忆配置默认为 enabled 且快照为 `VALID`。
- 省略 `nextAgent.memory.extraction.enabled` 和 `nextAgent.memory.aging.enabled` 时，两个子能力默认为 enabled。
- 省略 `crossSessionSchedule` / `schedule` 时，两个内部 scheduler 默认使用 `0 0 0 * * ?`，即每天 00:00 进入 scheduled path。
- 显式 `nextAgent.memory.enabled=false` 仍可一键关闭所有长期记忆能力。
- 显式子能力 `enabled=false` 只关闭对应子能力。
- 默认配置文档和验证用例清楚展示可修改的 key。

**非目标：**

- 不把两个内部 scheduler 合并成新的 `nextAgent.memory.dreaming.*` 配置入口。
- 不让 context assembly 自动检索或注入长期记忆。
- 不改变 memory core gateway contract、memory record schema、SQLite schema 或 remote service contract。
- 不改变 memory tools 的输入输出 schema、工具 id、provider id 或 capability SPI。
- 不改变 AgentAssembly capability binding 机制；默认 enabled 不创建隐式工具绑定。仅产品内置 `default-agent` 通过自身 `agent.yaml` 显式 opt in memory tools，其他 Agent 不被隐式绑定。

## 设计决策（Decisions）

1. **唯一实现路径：配置默认值由 app normalization 产生，产品默认工具可用性由内置 Agent 显式绑定产生。**  
   `agent-app` 仍是唯一 composition root。实现阶段调整 `packages/agent-app/src/config/validation.ts` 中 `MemoryConfig` 的默认计算：parent memory 缺省视为 `enabled=true`；extraction 和 aging 缺省视为 `enabled=true`；`extraction.crossSessionSchedule` 和 `aging.schedule` 缺省视为 `0 0 0 * * ?`。同时更新产品内置 `default-agent/agent.yaml` 的 `capabilityBindings[]`，显式绑定 `search_memory`、`get_memory_detail` 和 `add_memory`。所有 memory consumer 继续消费冻结后的 `MemoryConfig`，不得直接读取 raw YAML；其他 Agent 不得因系统默认 enabled 获得隐式工具绑定。

2. **保留两个内部 scheduler，并默认午夜运行。**  
   产品语义上 nightly dreaming 覆盖 extraction/fusion 和 aging 两部分；实现上仍保留现有两个内部 scheduler。默认配置下，local backend 的 extraction scheduler 使用 `nextAgent.memory.extraction.crossSessionSchedule=0 0 0 * * ?`，aging scheduler 使用 `nextAgent.memory.aging.schedule=0 0 0 * * ?`。该方案最小化实现改动，不新增 `dreaming.*` 配置入口，也不改变两个 scheduler 各自的职责边界。

3. **显式关闭优先。**  
   `nextAgent.memory.enabled=false` 的优先级高于所有子能力默认值。实现时应保持 `MemoryConfig.status=DISABLED`，并让 tools、extraction、aging 的 effective enabled 为 false。子能力显式 `false` 不影响 memory core 和 search。

4. **工具暴露仍由既有 capability gate 决定。**  
   默认配置只让 `MemoryConfig.status` 不再默认阻断。memory tools 仍必须满足：active AgentAssembly 绑定、`providerId=memory-tools`、memory core 可用、owner/agent scope 可用、capability governance 允许。产品内置 `default-agent` 的默认可用性通过显式 `agent.yaml` binding 实现，而不是通过系统配置或 runtime 注入实现。该方案不需要修改 Tool SPI。

5. **remote complete-service 继续隔离本地生命周期任务。**  
   remote 模式下，默认 enabled 可以让远端长期记忆能力可用；本地 extraction/aging scheduler 不应启动。远端服务拥有自身 lifecycle 和 extraction 语义，本 change 不新增本地替代实现。

6. **默认配置文件只承载可见样例，不承载唯一默认来源。**  
   `packages/agent-app/config/default-system.yaml` 应列出 `nextAgent.memory` 的主要可调 key，方便用户直接按 key 修改；但运行时默认值的权威来源仍是 `MemoryConfig` 归一化逻辑。即使部署 overlay 省略整个 `nextAgent.memory` group，系统也必须得到相同的默认 enabled 快照。默认配置样例必须包含：

   ```yaml
   nextAgent:
     memory:
       enabled: true
       search:
         default-limit: 20
         min-confidence: 0.3
       extraction:
         enabled: true
         strategy: "RULE_FIRST"
         crossSessionSchedule: "0 0 0 * * ?"
         maxCycleTrajectories: 20
         maxCandidates: 50
         timeoutMs: 60000
         lookbackDays: 7
       aging:
         enabled: true
         schedule: "0 0 0 * * ?"
         decayStaleDays: 30
         archiveRetentionDays: 90
         decayFactor: 0.05
         batchLimit: 1000
         timeoutMs: 30000
         reviveConfidenceBoost: 0.1
   ```

   Agent tool opt-in 仍归 `agent.yaml` / Agent definition 的 `capabilityBindings[]`，不得把 Agent 绑定写进 `default-system.yaml`，也不得通过系统默认配置隐式给所有 Agent 绑定 memory tools。本 change 只更新产品内置 `default-agent/agent.yaml`，让默认产品 Agent 显式 opt in memory tools。

放弃的方案：
- **新增统一 `nextAgent.memory.dreaming.*` schedule。** 放弃原因：当前实现已经有 extraction 和 aging 两个内部 scheduler；新增第三个用户侧配置入口会扩大改动面，并让现有 `extraction.*` / `aging.*` schedule 的兼容语义变复杂。
- **在 tools 层绕过配置 gate。** 放弃原因：会破坏统一配置快照和 capability governance。
- **新增独立 memory-defaults 文件。** 放弃原因：已有 `nextAgent.memory.*` 命名空间足够，新增入口会增加配置歧义。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 默认 enabled 不改变 owner scope、agent scope、capability binding、tool input validation 或 remote/local backend 选择；显式 disabled 仍 fail-closed。 | memory configuration tests；memory tool exposure gate tests；architecture review |
| 性能/容量 | 默认每天 00:00 触发两个内部 scheduler，可能产生 LLM extraction、扫描和 aging 写入；该行为是本 change 的产品默认值，remote backend 下本地 scheduler 仍不启动。 | scheduler startup tests；manual dev run observation |
| 可靠性/恢复 | 非法配置仍进入 `INVALID`；显式 disabled 仍进入 `DISABLED`；默认 schedule 是有效 cron，不是 degraded。两个内部 scheduler 不提供跨 scheduler 顺序保证，仍依赖各自现有幂等/并发保护。 | config validation tests；extraction/aging trigger tests |
| 可维护性 | 只改一个默认值来源和相关测试，所有下游继续消费 `MemoryConfig`；不引入新接口或平行配置入口。 | `npm run lint:architecture`；code review |
| 可测试性 | 默认值、默认午夜 schedule、显式 schedule 覆盖、显式关闭、子能力关闭、remote backend 都可以用 deterministic unit/integration tests 覆盖。 | focused Vitest suites for config/composition/memory schedulers |
| 审计/可追溯性 | 默认值变化由 OpenSpec change 记录；运行时仍使用现有 safe diagnostics，不新增原始内容日志。 | OpenSpec validation；observability assertions where existing diagnostics are tested |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 省略 `nextAgent.memory.enabled` 得到 `MemoryConfig.status=VALID` 且 enabled true | 1.1, 3.1 | memory config unit tests |
| 显式 `nextAgent.memory.enabled=false` 关闭所有长期记忆能力 | 1.2, 3.1 | memory config unit tests；tool exposure tests |
| extraction/aging 缺省 enabled，缺省 schedule 均为 `0 0 0 * * ?` | 1.3, 2.2, 3.2 | scheduler startup tests |
| 默认 enabled 不创建隐式 Agent tool binding；产品内置 `default-agent` 通过 `agent.yaml` 显式绑定 memory tools | 2.1, 2.5, 3.3 | capability composition tests；builtin default-agent assembly tests |
| remote complete-service 不启动本地 extraction/aging scheduler | 2.3, 3.2 | app composition tests |
| `default-system.yaml` 列出默认配置样例但不成为唯一默认来源 | 2.4, 3.1, 3.3 | config load tests；diff review |
| 非法字段和非法 cron 仍 fail-closed | 1.4, 3.1 | config validation tests |
| 默认 enabled 诊断不再报告 disabled default | 1.5, 3.1 | memory config diagnostic tests |
| OpenSpec 行为 delta 可归档 | 3.2 | `openspec validate refine-memory-default-enabled --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/memory-configuration/spec.md` 主承载默认配置和状态语义；`memory-tools`、`memory-extraction`、`memory-aging` spec 只承载各自消费默认配置后的可验证行为。
- 架构和跨模块设计：`openspec/designs/architecture/memory.md` 主承载默认 enabled 与两个内部 scheduler 默认午夜调度的跨模块流程。
- 模块设计：`openspec/designs/modules/agent-memory.md` 主承载 agent-memory 消费冻结配置、但不读取 raw config 的模块职责。
- ADR：`openspec/designs/adr/memory-extraction-boundary.md` 和 `openspec/designs/adr/memory-aging-state-lifecycle.md` 记录两个内部 scheduler 默认午夜运行的取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 更新相关 spec 到设计文档的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] 已绑定 memory tools 的默认 Agent 会在默认配置下暴露工具。 -> 保持 AgentAssembly binding 和 capability governance gate；没有绑定的 Agent 不暴露。
- [风险] 两个内部 scheduler 都在 00:00 触发，可能产生同一分钟内的 extraction 与 aging 并发。 -> 保持现有两个 scheduler 的职责隔离和各自并发保护；本 change 不引入跨 scheduler 顺序保证，如后续需要严格 phase ordering，应由独立 orchestrated dreaming change 定义。
- [风险] 默认午夜任务会产生 LLM 成本和 aging 写入。 -> 这是用户明确要求的产品默认值；显式 `enabled=false` 和子能力 `enabled=false` 仍可关闭。
- [风险] remote 模式下本地 lifecycle 任务误启动。 -> composition tests 覆盖 remote backend 下 scheduler 不启动。

## 迁移计划（Migration Plan）

- 对没有 memory 配置的部署：升级后长期记忆能力默认变为 enabled；如果不希望使用长期记忆，需显式设置 `nextAgent.memory.enabled=false`。
- 对已显式关闭 memory 的部署：行为保持 disabled。
- 对没有 memory schedule 配置的部署：升级后 local backend 会在每天 00:00 默认运行 extraction scheduler 和 aging scheduler；如果不想自动运行，需显式设置对应子能力 `enabled=false`。
- 对已配置 schedule 的部署：继续使用显式 schedule 覆盖默认午夜 schedule。
- 对使用仓库 `default-system.yaml` 的部署：升级后配置文件会展示完整 `nextAgent.memory` 默认 key，其中 `crossSessionSchedule` 和 `aging.schedule` 均为 `0 0 0 * * ?`；用户可通过 deployment overlay 覆盖这些值。实施时不得混入本地模型、credential 或环境私有配置变更。
- 回滚策略：恢复默认值为 false，或在 deployment overlay 中显式设置 `nextAgent.memory.enabled=false`。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/memory-configuration/spec.md`：归并默认 enabled、显式 disabled、extraction/aging 默认午夜 schedule 的行为契约。
- `openspec/specs/memory-tools/spec.md`：归并默认配置只通过配置 gate、不绕过 Agent binding 的行为契约。
- `openspec/specs/memory-extraction/spec.md`：归并 extraction 默认 enabled 和默认午夜 schedule 的行为契约。
- `openspec/specs/memory-aging/spec.md`：归并 aging 默认 enabled 和默认午夜 schedule 的行为契约。
- `openspec/overview.md`：补充长期记忆默认可用的产品背景。
- `openspec/designs/architecture/memory.md`：补充默认 enabled 与两个内部 scheduler 默认午夜调度的跨模块流程。
- `openspec/designs/modules/agent-memory.md`：补充 agent-memory 消费冻结配置的职责边界。
- `openspec/designs/adr/memory-extraction-boundary.md`：补充 extraction 默认午夜 scheduler 的决策。
- `openspec/designs/adr/memory-aging-state-lifecycle.md`：补充 aging 默认午夜 scheduler 的决策。
- `openspec/designs/spec-to-design-map.md`：更新导航和验证入口。

## 待确认问题（Open Questions）

无。
