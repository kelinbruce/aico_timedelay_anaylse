## Function

- **所属 Function**：`FN-3.2 编译智能体装配`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Agent Package Assembly Compiles Runtime-Ready Assembly At Startup

系统 MUST 在 request acceptance 开放前，把每个受信任选中的 Agent package 输入编译为 runtime-ready `AgentAssembly`，并发布为请求处理可读取的 accepted assembly。该编译行为 MUST 在启动成功条件满足前完成，MUST NOT 延迟到 request path、后台刷新或 lazy lookup。

受信任启动选择 MUST 在编译前决定哪些 Agent package 输入参与本次装配。本 capability 只约束“被选中的 package 输入如何形成 runtime-facing assembly”，MUST NOT 定义产品入口选择、default-agent 打包布局或 release-packaging 文件同步。

Agent definition MAY 省略 `modelIds` 以继承 frozen `systemConfig.modelProfiles` 中全部已校验模型的 canonical `modelId`，并保持 provider/profile 配置顺序；显式 `modelIds` MUST 是非空、有序且无重复的模型激活范围，Agent config MUST NOT 使用 singular `modelId` 代替该集合。编译后的 `AgentAssembly` MUST 始终携带解析后的非空、有序且无重复 `modelIds`。可选 `defaultModelId` MAY 省略；存在时 MUST 是解析后 `modelIds` 中恰好一个 exact canonical id。省略 `defaultModelId` 时，initial selection MUST 使用解析后 `modelIds` 顺序中的第一个 eligible model，MUST NOT 合成 global default。assembly MUST NOT 复制 `ModelProfile` 默认调用参数、`providerId`、endpoint、credential reference、provider options 或 transport。

**需求类别**：功能性需求

#### Scenario: 启动编译发布 runtime-ready assembly

- **GIVEN** 受信任启动选择已接受一个 enabled Agent package 输入
- **WHEN** 系统执行 Agent assembly
- **THEN** 系统 MUST 在任何 request acceptance 对外服务前完成 compile
- **AND** MUST 产出 runtime-ready accepted `AgentAssembly`
- **AND** 请求处理、恢复和后台模型消费者 MUST 只消费该 accepted assembly
- **AND** assembly 中的模型事实 MUST 只包含激活 `modelIds` 和可选 `defaultModelId`，不包含全局模型配置或模型接入事实

#### Scenario: Agent 省略 default model

- **GIVEN** Agent definition 提供非空且无重复的 `modelIds`
- **AND** 省略 `defaultModelId`
- **WHEN** 系统编译并发布 runtime-ready assembly
- **THEN** assembly MUST 保留有序 `modelIds` 并省略 `defaultModelId`
- **AND** 后续 initial selection MUST 从该顺序中选择第一个 eligible model

#### Scenario: Agent 省略模型激活范围

- **GIVEN** Agent definition 省略 `modelIds`
- **WHEN** 系统使用已校验且冻结的 `systemConfig.modelProfiles` 编译 Agent assembly
- **THEN** assembly MUST 按 provider/profile 配置顺序携带其中全部 canonical `modelId`
- **AND** builtin、顶层 local Agent 与 parent subagent MUST 使用同一解析规则
- **AND** 系统 MUST NOT 读取运行期 catalog health、Gateway metadata、环境变量或请求输入决定该范围

#### Scenario: Agent 模型激活配置非法

- **WHEN** Agent definition 提供空 `modelIds`、重复或未知 id，提供 singular `modelId`，或让 `defaultModelId` 不属于解析后的 `modelIds`
- **THEN** package compilation MUST 在 assembly publication 前安全失败
- **AND** MUST NOT 把显式非法值按省略处理或用 system config 覆盖

#### Scenario: 请求路径不重新编译 package 输入

- **WHEN** 请求处理、恢复或后台模型消费者需要 Agent assembly 数据
- **THEN** 它们 MUST 读取 accepted assembly facts
- **AND** MUST NOT 在 request path 重新解析或重新编译 Agent package 输入

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：Agent definition 可省略 `modelIds` 以继承 frozen system config 中全部已校验模型；显式 `modelIds` 必须是 non-empty ordered unique canonical ids，`defaultModelId` 可省略且存在时必须属于解析后的集合。
- **依据 Requirements**：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`

### 处理过程

- **变更类型**：修改
- **目标内容**：启动编译按 frozen system config 的 provider/profile 顺序解析省略的模型激活范围，对 builtin、顶层 local Agent 和 parent subagent 使用同一规则；显式非法模型配置在 publication 前失败。
- **依据 Requirements**：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`

### 输出

- **变更类型**：修改
- **目标内容**：输出可供请求处理使用的 runtime-ready `AgentAssembly`；Agent definition 省略 `modelIds` 时从 frozen system config 继承全部已校验模型，显式配置时保持 non-empty ordered unique 约束；runtime assembly 始终携带解析后的 `modelIds` 和可选且必须属于该集合的 `defaultModelId`，不复制 `ModelProfile` 默认调用参数、`providerId`、endpoint、credential reference、provider options 或 transport。省略 `defaultModelId` 时由 selection 使用第一个 eligible model。
- **依据 Requirements**：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-package-assembly`
- **依据 Requirements**：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`extension-registration` 继续承载未触及的扩展注册行为。
- **依据 Requirements**：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`
