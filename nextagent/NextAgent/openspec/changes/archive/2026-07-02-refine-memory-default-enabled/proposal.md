## 背景与问题（Why）

长期记忆核心、工具、配置、dreaming extraction 和 aging 已经进入稳定能力集合，但当前默认配置仍以关闭为主。用户在默认部署中必须先知道 `nextAgent.memory.*` 的多层开关，才能使用记忆工具、检索、手动触发 extraction 或手动触发 aging。这导致长期记忆虽然已实现，但默认黑盒效果接近不可用，手工验证和产品启用路径都不够直接。

本变更的目标是把长期记忆能力默认改为可用，同时让默认部署具备 nightly dreaming 黑盒效果。当前代码保持两个内部 scheduler：extraction scheduler 负责 dreaming/extraction/fusion，aging scheduler 负责 lifecycle aging。两个内部 scheduler 都默认开启，并默认使用同一个午夜 cron `0 0 0 * * ?`（每天 00:00）。

## 变更范围（What Changes）

- 将 `nextAgent.memory.enabled` 缺省语义从 `false` 调整为 `true`；省略该字段时，配置快照进入 `VALID`，并使用已定义的 search、extraction、aging 默认值。
- 将 `nextAgent.memory.extraction.enabled` 缺省语义从 `false` 调整为 `true`，并将 `nextAgent.memory.extraction.crossSessionSchedule` 缺省语义调整为 `0 0 0 * * ?`。
- 将 `nextAgent.memory.aging.enabled` 缺省语义从 `false` 调整为 `true`，并将 `nextAgent.memory.aging.schedule` 缺省语义调整为 `0 0 0 * * ?`。
- 保留显式关闭优先级：`nextAgent.memory.enabled=false` 必须禁用所有长期记忆能力；子能力 `enabled=false` 只禁用对应子能力。
- 保留配置 fail-closed：非法字段、非法范围、非法 cron 或依赖缺失不得被默认开启覆盖。
- 保留 remote complete-service 边界：remote 模式下，远端长期记忆服务拥有自身 extraction/aging 生命周期，本地 scheduler 不因默认 schedule 而启动。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `memory-configuration`: 修改长期记忆配置默认值和 disabled/valid 状态语义。
- `memory-tools`: 修改工具暴露前置条件中的默认配置效果；默认配置有效时，工具仍需满足 Agent capability binding 和 memory core 依赖；产品内置 `default-agent` 通过自身 `agent.yaml` 显式绑定三项 memory tools。
- `memory-extraction`: 修改 extraction 默认 enabled 和默认午夜 schedule 语义。
- `memory-aging`: 修改 aging 默认 enabled 和默认午夜 schedule 语义。

## 影响范围（Impact）

- 配置归一化和 schema 校验：`agent-app` 中 `MemoryConfig` 冻结逻辑需要调整默认值和状态判断。
- 默认配置样例：`default-system.yaml` 或等价默认配置应列出长期记忆关键开关，默认值与新契约一致；其中 `nextAgent.memory.extraction.crossSessionSchedule` 和 `nextAgent.memory.aging.schedule` 均应展示为 `0 0 0 * * ?`。该文件是可见配置样例，不是运行时默认值的唯一来源。
- 能力组合：`agent-app` composition 仍是唯一注入点；默认配置有效时，memory core、memory tools、extraction 和 aging 消费同一个冻结配置快照。
- 工具暴露：默认配置不再让 `MemoryConfig.status=DISABLED`；内置 `default-agent` 显式绑定 `search_memory`、`get_memory_detail`、`add_memory`，因此默认产品 Agent 在 memory core 可用时具备工具暴露条件；其他 Agent 是否暴露仍受各自 AgentAssembly capability binding、memory core 可用性和 capability governance 约束。
- 后台任务：默认配置会让 local backend 下的 extraction scheduler 和 aging scheduler 使用 `0 0 0 * * ?` 进入 scheduled path。
- 测试：需要覆盖省略配置、显式 parent disabled、显式子能力 disabled、默认午夜 schedule、remote backend 和非法配置 fail-closed。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/memory-configuration/spec.md`：更新 `nextAgent.memory.enabled`、`nextAgent.memory.extraction.enabled`、`nextAgent.memory.aging.enabled` 的默认语义和状态判断。
- `openspec/specs/memory-tools/spec.md`：更新默认配置下工具暴露 gate 的预期。
- `openspec/specs/memory-extraction/spec.md`：更新默认 extraction enabled 和默认午夜 schedule 语义。
- `openspec/specs/memory-aging/spec.md`：更新默认 aging enabled 和默认午夜 schedule 语义。

长期背景：
- `openspec/overview.md`：补充长期记忆默认可用、nightly dreaming 默认在 00:00 运行的产品级原则。

设计视图：
- `openspec/designs/architecture/memory.md`：更新默认启用与两个内部 scheduler 默认午夜调度的跨模块流程。
- `openspec/designs/modules/agent-memory.md`：补充 agent-memory 消费默认 enabled 配置但不拥有 app 配置读取的职责边界。
- `openspec/designs/adr/memory-tools-boundary.md`：无。
- `openspec/designs/adr/memory-extraction-boundary.md`：补充 extraction 默认午夜 scheduler 的取舍。
- `openspec/designs/adr/memory-aging-state-lifecycle.md`：补充 aging 默认午夜 scheduler 的取舍。
- `openspec/designs/spec-to-design-map.md`：更新 memory-configuration、memory-extraction、memory-aging 到设计文档的导航摘要。

验证入口：
- `openspec validate refine-memory-default-enabled --strict`
- 聚焦单元测试：memory configuration normalization/defaults、memory tool exposure gate、extraction scheduler startup、aging scheduler startup。
- 集成/契约测试：默认配置可使用长期记忆工具；默认配置进入 extraction/aging midnight scheduled path；显式关闭和非法配置 fail-closed。
