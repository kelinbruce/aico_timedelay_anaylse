## 1. 配置默认值和快照语义

- [x] 1.1 调整 `packages/agent-app/src/config/validation.ts` 的 `MemoryConfig` 归一化逻辑：省略 `nextAgent.memory.enabled` 时默认 `enabled=true` 且状态为 `VALID`。
  验证：新增或更新 memory configuration unit tests，断言省略 `nextAgent.memory.enabled` 时 `MemoryConfig.status=VALID`、`enabled=true`、search 默认值不变。
  来源：`memory-configuration` Requirement: Memory configuration namespace and defaults；design 决策 1。
- [x] 1.2 保持 `nextAgent.memory.enabled=false` 的显式关闭优先级，并让 tools、extraction、aging 的 effective enabled 都为 false。
  验证：memory configuration unit tests 断言 parent disabled 返回 `DISABLED`，并断言子能力不会因自身默认 true 而生效。
  来源：`memory-configuration` Scenario: Explicit parent disabled disables all memory capabilities；design 决策 3。
- [x] 1.3 调整 extraction 和 aging 子能力默认值：省略 `nextAgent.memory.extraction.enabled`、`nextAgent.memory.aging.enabled` 时默认 true；省略 `nextAgent.memory.extraction.crossSessionSchedule` 和 `nextAgent.memory.aging.schedule` 时默认 `0 0 0 * * ?`；显式 false 只关闭对应子能力。
  验证：memory configuration unit tests 覆盖默认 true、默认午夜 schedule、显式 false、parent true + child false。
  来源：`memory-configuration` Scenario: Child capability can be explicitly disabled；`memory-extraction` / `memory-aging` 默认 enabled 契约。
- [x] 1.4 保持非法配置 fail-closed，包括非法字段、非法范围和非法 cron；不得因默认 enabled 回退到成功配置。
  验证：memory configuration negative tests 实际传入非法字段、非法 range、非法 cron 并断言 `INVALID` 或 schema validation failure。
  来源：`memory-configuration` Scenario: Invalid range fails validation；Scenario: Undefined consumer field is not silently accepted。
- [x] 1.5 更新 memory configuration diagnostic 语义：默认缺失 `nextAgent.memory.enabled` 时必须报告 default enabled，不得继续报告 `MEMORY_CONFIG_DISABLED_DEFAULT`。
  验证：memory configuration diagnostic unit tests 断言默认配置产生 `VALID`/enabled 诊断，显式 `false` 才产生 disabled explicit 诊断。
  来源：`memory-configuration` Requirement: Configuration failure and degradation semantics；design 验证映射。

## 2. 组合、工具和调度 gate

- [x] 2.1 更新 memory tools exposure gate 的测试：默认 memory 配置不再阻断已绑定 Agent 的 memory tools，但没有 Agent capability binding 时仍不暴露。
  验证：capability composition / create-app focused tests 覆盖已绑定和未绑定两种场景。
  来源：`memory-tools` Requirement: Default-enabled memory configuration participates in memory tool exposure gate；design 决策 4。
- [x] 2.2 验证 extraction / aging 默认 schedule 为 `0 0 0 * * ?` 且进入 scheduled path；显式子能力 disabled 时不得触发对应 scheduled cycle。
  验证：memory extraction scheduler 和 memory aging scheduler tests，断言默认配置使用 midnight cron，valid schedule 进入 scheduled path，子能力 disabled 返回 skipped 或不触发 scheduled cycle。
  来源：`memory-extraction` Scenario: Default configuration schedules extraction at midnight；`memory-aging` Scenario: Default configuration schedules aging at midnight；design 决策 2。
- [x] 2.3 验证 remote complete-service backend 下本地 extraction / aging scheduler 不启动。
  验证：app composition tests 使用 remote deployment mode，断言本地 memory extraction / aging scheduler 未注册或未启动。
  来源：`memory-aging` 流程接入；`memory-extraction` scheduler startup preconditions；design 决策 5。
- [x] 2.4 更新仓库默认配置样例 `packages/agent-app/config/default-system.yaml`，列出完整 `nextAgent.memory` 默认 key：`enabled=true`、search 默认值、`extraction.enabled=true`、`extraction.strategy=RULE_FIRST`、`extraction.crossSessionSchedule="0 0 0 * * ?"`、extraction 限额默认值、`aging.enabled=true`、`aging.schedule="0 0 0 * * ?"` 和 aging lifecycle 默认值；该文件只作为可见配置样例，运行时默认值仍来自 `MemoryConfig` 归一化逻辑。不得在该任务中修改模型、credential、Agent binding 或环境私有配置。
  验证：diff review 检查只修改仓库默认配置所需 memory 字段；配置加载测试覆盖默认配置文件；省略整个 `nextAgent.memory` group 的测试仍断言归一化默认值生效。
  来源：proposal 影响范围；design 决策 6；design 迁移计划。
- [x] 2.5 更新产品内置 `default-agent` 的 `agent.yaml`，在 `capabilityBindings[]` 中显式绑定 `search_memory`、`get_memory_detail` 和 `add_memory`，三者均使用 `capabilityType=TOOL`、`providerId=memory-tools`、`enabled=true`；不得通过 `default-system.yaml` 或 runtime fallback 给其他 Agent 隐式绑定。
  验证：builtin default-agent assembly / config-assembly tests 断言默认 Agent 包含三项 memory tool binding；memory tools runtime integration tests 继续覆盖没有 Agent binding 时不暴露工具。
  来源：`memory-tools` Scenario: Builtin default Agent explicitly opts in to memory tools；design 决策 1、4、6。

## 3. 验证和收尾

- [x] 3.1 运行聚焦测试，覆盖配置默认值、默认午夜 schedule、配置诊断、tools exposure gate、scheduler scheduled path 和 remote backend gate。
  验证：相关 Vitest suites，至少覆盖 `packages/agent-app` 配置/组合测试和 `packages/agent-memory` scheduler 测试。
  来源：design 验证映射。
- [x] 3.2 运行 OpenSpec 严格校验。
  验证：`openspec validate refine-memory-default-enabled --strict`；必要时再运行 `openspec validate --all --strict`。
  来源：proposal 验证入口。
- [x] 3.3 执行架构边界检查：确认本 change 没有让 context assembly 自动检索/注入长期记忆，没有新增 Tool SPI、gateway contract、数据库字段或平行配置入口。
  验证：`npm run lint:architecture`；code review 检查 `agent-context-engine`、`agent-capability`、`agent-contracts` 没有不必要改动。
  来源：design 非目标；AGENTS.md 架构边界。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/memory-configuration/spec.md`、`openspec/specs/memory-tools/spec.md`、`openspec/specs/memory-extraction/spec.md`、`openspec/specs/memory-aging/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/memory.md`。
- 按需更新 `openspec/designs/modules/agent-memory.md`。
- 按需更新 `openspec/designs/adr/memory-extraction-boundary.md` 和 `openspec/designs/adr/memory-aging-state-lifecycle.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
