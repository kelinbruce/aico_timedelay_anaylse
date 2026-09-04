## MODIFIED Requirements

### Requirement: Memory configuration snapshot

系统 SHALL 在应用启动和 Agent 装配进入可执行状态之前，加载、校验并冻结长期记忆配置为稳定的 `MemoryConfig` 运行时快照。已定义的 memory gateway/core consumers、capability consumers 和后续通过 OpenSpec 明确接入的 memory consumers 只能消费该快照或 app composition 派生的窄投影，不得重新解析源配置。

**触发机制**：
1. 应用 composition 加载产品配置时同步触发 memory configuration 加载。
2. Agent 装配需要 memory 资源覆盖解析结果时，同步读取已经冻结的配置快照和资源解析结果。
3. 该流程不属于 request lifecycle，不由用户请求、模型输出、capability invocation、后台 job 或 stream reconnect 触发。
4. 该流程没有异步后台调度；配置快照在应用 ready 前必须已经稳定。

**输入与前置条件**：
- 源配置已经由 app configuration 边界读取。
- 配置源属于不可信输入，必须接受 runtime schema validation。
- 当前代码基线的 app 配置 schema 中，`nextAgent` 已作为 app-private namespace 存在；本 change 必须在同一个 app-private `RawDefaultSystemConfig` / runtime schema 边界中把 `memory` 作为 `nextAgent.system` 的 sibling group 接入，不得新增第二套配置文件或绕过 `defaultSystemSchema`。
- `nextAgent` 对象允许只包含已定义的 `system` group、只包含已定义的 `memory` group，或同时包含二者；缺失 `nextAgent.memory` 等价于 memory 使用默认 enabled 配置，不要求在默认配置文件中显式写入 `nextAgent.memory.enabled=true`。
- 如需解析 Agent 级覆盖资源，必须具备已校验的 agent id、agent workspace/root ref 或等价安全装配上下文。
- 配置不得包含 `tenantId`、`subjectId`、owner、userId 或等价身份覆盖字段。

**输出与副作用**：
- 产生一个冻结的 `MemoryConfig` 快照。
- 产生配置诊断状态，至少包含 `VALID`、`INVALID`、`DISABLED` 三类可观察结果。
- 产生脱敏 structured log 和 metric；不得产生用户可见 stream delta、session message、memory record、learning event、checkpoint、artifact 或 pending input。

**核心判断逻辑**：
1. 校验配置字段名、类型和数值范围。
2. 拒绝任何身份/owner 覆盖字段；该拒绝不得被后续模块覆盖。
3. 若关键配置无效，配置状态为 `INVALID`，应用不得以 memory-enabled 状态启动。
4. 若 `nextAgent.memory.enabled=false`，配置状态为 `DISABLED`，memory consumers 必须看到稳定 disabled 快照。
5. 若 `nextAgent.memory.enabled` 缺失或为 `true` 且配置有效，则填充默认值并冻结 `VALID` 快照；冻结后同一进程内不得热更新。

**状态 / 产物契约**：
- `MemoryConfig` 是配置快照，不是 memory record、learning event、audit fact 或用户偏好。
- `MemoryConfig` 生命周期与当前应用进程的 app composition 生命周期一致。
- `MemoryConfig` 不代表授权事实；owner scope 仍只能来自 trusted identity boundary。
- 配置诊断只用于运维、测试和健康检查消费，不得进入模型输入或用户对话历史。

**流程接入**：
- 上游是 app configuration loading 和 Agent assembly。
- 下游是 app-composed selected memory ports / core consumer boundaries、agent-capability、后续显式接入的 memory consumers、observability，以及后续 local memory 编排实际接入时的 `agent-memory`。
- Runtime request lifecycle、channel stream projection 和 context assembly 不得拥有或修改该配置快照。

#### Scenario: Valid configuration becomes frozen snapshot
- **WHEN** 应用启动时源配置包含合法的 `nextAgent.memory.*` 字段且 `nextAgent.memory.enabled=true`
- **THEN** 系统 MUST 生成一个状态为 `VALID` 的 `MemoryConfig` 快照
- **AND** 所有已接入 memory consumers MUST 消费同一个快照
- **AND** 同一进程内后续源配置变化 MUST NOT 改变该快照

#### Scenario: Default memory configuration becomes valid snapshot
- **WHEN** 应用启动时源配置省略 `nextAgent.memory` 或省略 `nextAgent.memory.enabled`
- **AND** 源配置没有非法 memory 字段
- **THEN** 系统 MUST 生成一个状态为 `VALID` 且 `enabled=true` 的 `MemoryConfig` 快照
- **AND** 配置诊断 MUST 显示 memory enabled 来自默认值

#### Scenario: Owner override fields are rejected
- **WHEN** 源配置中出现 `tenantId`、`subjectId`、`owner`、`userId` 或等价身份覆盖字段
- **THEN** 系统 MUST 将 memory configuration 标记为 `INVALID`
- **AND** MUST 产生安全诊断 `MEMORY_CONFIG_OWNER_OVERRIDE_FORBIDDEN`
- **AND** 不得以这些字段作为任何 memory owner scope

#### Scenario: Memory explicitly disabled snapshot
- **WHEN** `nextAgent.memory.enabled=false`
- **THEN** 系统 MUST 生成状态为 `DISABLED` 的 `MemoryConfig` 快照
- **AND** app-composed selected memory port / core consumer boundary MUST 按 memory core 的 disabled 契约返回 `LTM_DISABLED`
- **AND** memory consumers MUST 不得把 disabled 伪装为成功空结果

### Requirement: Memory configuration namespace and defaults

系统 SHALL 定义 `nextAgent.memory.*` 外部配置命名空间。本 requirement 作为命名空间注册中心和校验入口，定义全局字段（`enabled`、`search.*`）并汇总已由对应 memory change 明确定义且获准进入实施范围的配置字段。后续新增 memory change 的配置字段 MUST 通过显式 spec delta 增加。

运行时配置的物理入口固定为 `default-system.yaml` / application overlay 中的 `nextAgent.memory` group。`search`、`extraction`、`aging` 等长期记忆子能力只允许作为 `nextAgent.memory.<subsystem>` 子组出现；系统 MUST NOT 接受 `nextAgent.extraction.*`、`nextAgent.aging.*`、`memory-extraction.*`、`memory-aging.*` 或独立 memory 子能力配置文件作为同等运行时入口。Agent 级绑定仍归已有 `agent.yaml` / Agent definition，不写入 `default-system.yaml`。

**配置契约**：
- `nextAgent.memory.enabled`：默认 `true`，允许值 `true|false`。显式 `false` MUST 禁用所有长期记忆能力。
- `nextAgent.memory.search.default-limit`：默认 `20`，范围 `[1, 100]`。
- `nextAgent.memory.search.min-confidence`：默认 `0.3`，范围 `[0.0, 1.0]`。
- `nextAgent.memory.extraction.enabled`：默认 `true`。该字段控制 extraction scheduler gate 和受控触发是否可用。
- `nextAgent.memory.extraction.crossSessionSchedule`：默认 `0 0 0 * * ?`，表示每天 00:00 触发本地 extraction scheduler。
- `nextAgent.memory.aging.enabled`：默认 `true`。该字段控制 aging scheduler gate 和受控触发是否可用。
- `nextAgent.memory.aging.schedule`：默认 `0 0 0 * * ?`，表示每天 00:00 触发本地 aging scheduler。
- App config schema MUST treat `nextAgent.system` and `nextAgent.memory` as sibling groups. `nextAgent.system` MUST NOT be required merely because `nextAgent.memory` is present, and `nextAgent.memory` MUST NOT be required merely because `nextAgent.system` is present.
- If owning memory changes register `extraction`, `aging`, `maintenance`, or similar runtime fields, those fields MUST remain child groups under `nextAgent.memory`; equivalent sibling groups under `nextAgent` MUST be rejected or marked explicitly inactive.

**命名空间扩展规则**：
- 后续 memory change MAY 在 `nextAgent.memory.*` 下新增字段，但必须在自身 OpenSpec delta 中定义触发机制、输入、输出、副作用、失败规则和验收样例。
- 已获准进入实施范围的 memory change 已在 `nextAgent.memory.*` 下注册了自身配置字段。`promotion`、`curator` 和 `sharing` 配置字段由后续 change 定义。
- 未被当前已合并规格定义的字段 MUST 被视为未知字段并拒绝，除非 app configuration 边界已经通过明确的兼容策略标记为非生效字段。

**触发机制**：
- 命名空间校验只在配置加载和快照冻结阶段触发。
- 本 requirement 不创建 scheduler、background job、maintenance job 或 sharing policy。

**输入与前置条件**：
- 源配置中缺失的字段使用上述默认值。
- 源配置中存在但非法的字段必须使配置校验失败；不得 warn 后使用默认值继续作为成功配置。

**输出与副作用**：
- 输出标准化后的配置值和字段级诊断。
- 不产生 memory lifecycle transition，不启动后台任务，不触发 extraction，不改变 capability catalog。

**核心判断逻辑**：
1. 对每个字段执行类型校验。
2. 对数值字段执行闭区间范围校验。
3. 对布尔字段执行允许值校验。
4. 任一非法字段使快照进入 `INVALID`，并阻止 memory-enabled 启动。
5. `nextAgent.memory.enabled=false` 使快照进入 `DISABLED`，并使所有长期记忆子能力 effective disabled。
6. `nextAgent.memory.enabled` 省略或为 `true` 且所有字段合法时，快照进入 `VALID`。
7. 省略 `extraction.crossSessionSchedule` 或 `aging.schedule` 时必须填充默认 cron `0 0 0 * * ?`；不得把字段缺失解释为对应 scheduler disabled。
8. 任一未定义的 memory 配置字段必须显式拒绝或由 app configuration 的兼容策略标记为不生效，不得被某个 consumer 私自解释。

**状态 / 产物契约**：
- `search.default-limit` 和 `search.min-confidence` 只是默认查询参数；搜索排序公式和 owner scope 语义由 memory core 规格定义。
- 配置快照不表达 maintenance、sharing 的状态机、调度计划、保留策略、共享策略、策略资源路径或写入策略。

#### Scenario: Defaults enable memory configuration
- **WHEN** 源配置省略 `nextAgent.memory.enabled` 且没有非法 memory 字段
- **THEN** `MemoryConfig` MUST 使用 `enabled=true`
- **AND** 配置状态 MUST 为 `VALID`
- **AND** search、extraction 和 aging MUST 使用各自已定义的默认值

#### Scenario: Explicit parent disabled disables all memory capabilities
- **WHEN** 源配置设置 `nextAgent.memory.enabled=false`
- **THEN** `MemoryConfig` MUST 使用 `enabled=false`
- **AND** 配置状态 MUST 为 `DISABLED`
- **AND** app-composed selected memory port / core consumer boundary MUST 按 memory core 的 disabled 契约返回 `LTM_DISABLED`
- **AND** memory tools、extraction、aging 的 effective enabled MUST 为 `false`

#### Scenario: Default-enabled background capabilities use midnight schedules
- **WHEN** 源配置省略 `nextAgent.memory.enabled`
- **AND** 源配置省略 `nextAgent.memory.extraction.crossSessionSchedule`
- **AND** 源配置省略 `nextAgent.memory.aging.schedule`
- **THEN** `MemoryConfig` MUST 为 `VALID`
- **AND** extraction 和 aging 的 effective enabled MUST 为 `true`
- **AND** `MemoryConfig.extraction.crossSessionSchedule` MUST 为 `0 0 0 * * ?`
- **AND** `MemoryConfig.aging.schedule` MUST 为 `0 0 0 * * ?`

#### Scenario: Child capability can be explicitly disabled
- **WHEN** 源配置设置 `nextAgent.memory.enabled=true`
- **AND** 源配置设置 `nextAgent.memory.extraction.enabled=false`
- **AND** 源配置设置 `nextAgent.memory.aging.enabled=false`
- **THEN** `MemoryConfig` MUST 为 `VALID`
- **AND** extraction 和 aging 的 effective enabled MUST 为 `false`
- **AND** search 和 memory core enabled 状态 MUST 不被子能力关闭影响

#### Scenario: Memory namespace coexists with existing system namespace
- **WHEN** 源配置包含 `nextAgent.memory.enabled=true` 但未包含 `nextAgent.system`
- **THEN** app config schema validation MUST accept the configuration if all defined memory fields are valid
- **AND** `MemoryConfig` MUST be derived from `nextAgent.memory`
- **AND** `userCapabilityProviders` MUST use its existing default/empty provider behavior
- **WHEN** 源配置只包含 `nextAgent.system.capability-providers` 且省略 `nextAgent.memory`
- **THEN** app config schema validation MUST accept the configuration
- **AND** `MemoryConfig` MUST use default-enabled memory values

#### Scenario: Memory sub-capability configuration remains nested
- **WHEN** merged memory changes define runtime fields for extraction or aging
- **THEN** source configuration MUST express them as `nextAgent.memory.extraction.*` and `nextAgent.memory.aging.*`
- **AND** app config schema validation MUST reject or mark inactive equivalent sibling groups such as `nextAgent.extraction.*` and `nextAgent.aging.*`
- **AND** `default-system.yaml` and application overlays MUST NOT split memory, extraction, and aging into three top-level runtime configuration blocks

#### Scenario: Invalid range fails validation
- **WHEN** `nextAgent.memory.search.default-limit=101`
- **THEN** 配置校验 MUST 失败
- **AND** 诊断 MUST 包含字段名 `nextAgent.memory.search.default-limit` 和约束 `[1, 100]`
- **AND** 系统 MUST NOT 将该字段改回默认值后继续报告配置成功

#### Scenario: Undefined consumer field is not silently accepted
- **WHEN** 源配置包含尚未被当前 OpenSpec 定义的 `nextAgent.memory.future.unreviewed-field`
- **THEN** 配置校验 MUST 失败或将该字段标记为明确不生效
- **AND** 任何 memory consumer MUST NOT 私自解释该字段
- **AND** 诊断 MUST 提示需要对应 memory change 定义该字段

### Requirement: Configuration failure and degradation semantics

系统 SHALL 对 memory 配置失败、trusted override 失败、资源引用失败、依赖缺失和预算超限给出明确结果。配置相关失败不得静默截断、静默丢弃或静默吞错。

**失败与降级规则**：
1. 源配置读取失败：配置状态 `INVALID`，错误码 `MEMORY_CONFIG_SOURCE_UNAVAILABLE`。
2. schema 校验失败：配置状态 `INVALID`，错误码 `MEMORY_CONFIG_INVALID`。
3. 非法 owner 字段：配置状态 `INVALID`，错误码 `MEMORY_CONFIG_OWNER_OVERRIDE_FORBIDDEN`。
4. 未定义 memory 配置字段：配置状态 `INVALID` 或明确不生效诊断，错误码 `MEMORY_CONFIG_FIELD_UNDEFINED`。
5. binding 工具描述 `description` 未设置：使用内置描述，不是失败。
6. binding 工具描述 `description` 非字符串：Agent assembly 校验失败或该 Agent configuration 标记为无效。
7. binding 工具描述 `description` 超长：按通用 Tool 描述上限截断并记录 `MEMORY_DESCRIPTION_TRUNCATED`，工具仍然可用。
8. extraction prompt 未在本 change 中解释；fallback 和 unsupported language 诊断由 memory extraction 定义。
9. memory disabled：`nextAgent.memory.enabled=false` 时，配置状态 `DISABLED`，app-composed selected memory port / core consumer boundary 按 `LTM_DISABLED` 行为处理。
10. memory default enabled：`nextAgent.memory.enabled` 缺失且其他 memory 配置合法时，配置状态 `VALID`，health 或配置诊断 MUST 能显示 memory enabled 来自默认值。

**输出与副作用**：
- 所有失败和降级必须产生 safe diagnostic。
- 配置失败不得创建 request terminal event、stream event、memory record 或 capability invocation。
- 覆盖资源拒绝只影响该资源的可用性，不得改变 request lifecycle。

#### Scenario: Source configuration unavailable
- **WHEN** 应用启动时 memory 源配置无法读取
- **THEN** 系统 MUST 产生 `MEMORY_CONFIG_SOURCE_UNAVAILABLE`
- **AND** memory configuration 状态 MUST 为 `INVALID`
- **AND** 应用 MUST NOT 以 memory-enabled 状态对外 ready

#### Scenario: Description exceeding limit is truncated
- **WHEN** 某 memory capability 的 `capabilityBindings[].description` 超过通用 Tool 描述上限
- **THEN** 系统 MUST 按通用 Tool 描述上限截断
- **AND** 诊断 MUST 包含 `MEMORY_DESCRIPTION_TRUNCATED` 和对应 `capabilityId`
- **AND** 工具 MUST 继续注册使用截断后的描述

#### Scenario: Explicit disabled memory is observable
- **WHEN** `nextAgent.memory.enabled=false`
- **THEN** memory configuration 状态 MUST 为 `DISABLED`
- **AND** health 或配置诊断 MUST 能显示 memory disabled 来自显式配置
- **AND** memory 调用失败 MUST 使用 stable disabled outcome，不得表现为存储不可用或空成功

#### Scenario: Default enabled memory is observable
- **WHEN** `nextAgent.memory.enabled` 缺失且 memory 配置合法
- **THEN** memory configuration 状态 MUST 为 `VALID`
- **AND** health 或配置诊断 MUST 能显示 memory enabled 来自默认值
- **AND** memory consumers MUST NOT 将默认 enabled 诊断报告为 `MEMORY_CONFIG_DISABLED_DEFAULT`
