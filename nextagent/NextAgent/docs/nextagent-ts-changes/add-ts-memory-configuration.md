# add-ts-memory-configuration

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory

状态：candidate
类型：扩展候选 change
主要 owner：Owner 12 Memory / Learning
依赖：add-ts-memory-core

目标：
- 定义 `adnclaw.memory.*` 配置命名空间，支持记忆启停、检索默认参数和 Agent 级工具描述覆盖。

规格输入：

- 配置命名空间 `adnclaw.memory.*`（本 change 只定义以下字段，aging/extraction/maintenance/sharing 字段由对应后置 change 显式增加）：
  - `adnclaw.memory.enabled`：默认 `true`，允许值 `true|false`
  - `adnclaw.memory.search.default-limit`：检索默认返回条数，默认 20，范围 [1, 100]
  - `adnclaw.memory.search.min-confidence`：检索最低置信度过滤，默认 0.3，范围 [0.0, 1.0]
- 工具描述覆盖：
  - `agent.yaml` 已有字段 `capabilityBindings[].description` 直接覆盖内置工具描述文字
  - 未设置时使用内置描述；描述过长时截断并记录诊断
- 提取提示词（dreaming prompt）覆盖：
  - `agent.yaml` 已有字段 `promptTemplateIds` 中 `memory-extraction-{lang}` 约定命名自动识别
  - 支持 `zh`、`en`；未声明时使用内置提取提示词
  - 与普通 prompt template 共享解析通道，不新增文件格式
- 配置校验：启动时校验，非法值必须使配置失败（`INVALID` 状态），不得 warn 后使用默认值继续成功
- 工具描述未设置时使用内置描述；设置时直接覆盖；超长时截断并记录诊断
- 提取提示词未在 `promptTemplateIds` 中声明时使用内置提取提示词；不支持的语言后缀自动忽略
- 已有字段的值变更不要求代码变更

契约输入：
- `MemoryConfig` 运行时快照 type（`enabled`、search 默认参数、配置状态、冻结后只读语义）
- 配置诊断状态 type（`VALID`/`INVALID`/`DISABLED`）
- `capabilityBindings[].description` 覆盖值（字符串，可选）

实现约束：
- 配置由 app composition 加载、校验并冻结为单一快照；memory consumers 只消费快照，不得各自解析源配置
- 工具描述通过 `agent.yaml` 已有字段 `capabilityBindings[].description` 覆盖，不新增文件机制
- 提取提示词通过 `agent.yaml` 已有字段 `promptTemplateIds` 约定命名识别，与普通 prompt template 共享通道
- 配置不得包含 `tenantId`、`subjectId`、`agentId`、owner 或等价 scope 字段

非目标：
- NOT 定义 dreaming、curator、promotion 等 aging 配置字段（由 `add-ts-memory-aging` 定义）
- NOT 定义 maintenance.pin-limit 等维护配置字段（由 `add-ts-memory-maintenance` 定义）
- NOT 定义 LLM 提取策略路径配置（由 `add-ts-memory-extraction` 定义）
- NOT 定义 sharing/publish/fork 等共享配置字段（由 `add-ts-memory-sharing` 定义）
- NOT 定义任何运行时记忆行为、模型 provider、secret、gateway 或 channel 配置

验收要点：
- Config contract：各配置项默认值和边界校验；非法值使配置进入 INVALID 状态
- Config contract：未知 memory 字段被显式拒绝或标记为不生效
- Integration：`capabilityBindings[].description` 覆盖生效（未设置→内置，已设置→覆盖，超长→截断）
- Integration：`promptTemplateIds` 中 `memory-extraction-{lang}` 识别生效（已声明→匹配，未声明→内置，不支持语言→忽略）
- Security：配置拒绝 tenantId/subjectId/agentId/owner 字段
- Resilience：非法配置值不导致进程崩溃，但阻止 memory-enabled 启动
- Observability：配置诊断脱敏，不含完整 tool schema 或 prompt 全文

并行边界：
- 不得修改 agent-core/agent-runtime 的运行时行为
- 不得修改 model tool schema 的代码校验逻辑（仅覆盖描述内容）
- 不得定义 platform endpoint 或 session store schema
- 不得预定义 extraction、aging、maintenance、sharing 的配置字段