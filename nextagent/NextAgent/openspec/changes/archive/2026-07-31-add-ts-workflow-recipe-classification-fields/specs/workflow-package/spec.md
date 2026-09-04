## MODIFIED Requirements

### Requirement: Local Recipe Loading

Recipe 静态资源 MUST 通过运行时目录扫描从 `agents/{agentId}/recipes/` 发现，并作为 WORKFLOW capability 贡献到当前 Agent Scope 的 capability catalog。recipe MUST NOT 引入 `RecipeStoreGateway`、`RecipeRecord` 或 durable store。

**运行时目录扫描策略：** capability `search` 每次被 catalog 调用时全量扫描 `agents/{agentId}/recipes/` 目录（与 agent-owned skill discovery 一致），解析每个 `.yaml`/`.yml` 文件的索引字段（`recipeName`/`domain`/`scene`/`lang`/`description`）并产出 `CapabilityDescriptor(kind="WORKFLOW")`，不全量解析 `flowGraph`。`require` 按需懒加载完整 DSL（含 `flowGraph`）到内存并缓存。

**文件格式：** 首版仅支持 `.yaml`/`.yml`，MUST NOT 扫描 `.json`。TS 代码注册 deferred 到未来 change。

loader 兼容层 MUST 透传 YAML 顶层的 `domain`/`scene`/`lang` 字段到 `RecipeDefinition`，不做归一、重命名或合并到 `metadata`。

**Default-enabled provider：** recipe capability provider 是 default-enabled trusted search provider（与 `local-skills-agent-owned` 同类），catalog 在 `searchDefaultEnabledProviders` 中调用其 `search()`，MUST NOT 要求 Agent assembly 显式 binding 即可发现 recipe capability。运行时新增的 recipe 文件在下次 `search` 调用时即可被发现，无需重启。

**触发机制：**
- 运行时目录扫描（search）：catalog `resolve`/`listAvailable` 触发 `search(criteria)` 时全量扫描目录
- 执行期懒加载（require）：runtime `resolveRecipeDefinition` 回调触发 `require(agentId, recipeName)` 时按需加载
- 均在请求执行阶段触发；search 为 async，require 为同步

**输入与前置条件：**
- trusted `agentAssemblies` 已加载（agent scope 来自可信 app composition）
- `agents/{agentId}/recipes/` 目录存在或不存在（不存在视为空）
- recipe 文件为 `.yaml`/`.yml`，`parseBuiltInConfig` 和 `RecipeDefinitionSchema` 可用

**输出与副作用：**
- search：扫描目录 → 解析索引字段 → 返回 `CapabilityDescriptor[]`（不全量解析 `flowGraph`）；无持久状态，每次调用独立扫描
- require：返回完整 `RecipeDefinition`（含 `flowGraph`），加载后缓存到内存
- 无 durable store 写入、无 gateway 调用、无 event、无 audit、无 metric
- 非法 recipe 产出 diagnostic log（`workflow.recipe.skip`），不中断扫描

**核心判断逻辑：**

运行时目录扫描（search）：
1. `search(criteria)` 被 catalog 调用，传入 `agentId`
2. 从 `agents/{agentId}/recipes/` 递归收集 `.yaml`/`.yml` 文件（不收集 `.json`）；symlink 跳过、路径逃逸拒绝
3. 每个文件经 `parseBuiltInConfig` 解析，提取索引字段（`recipeName`/`domain`/`scene`/`lang`/`description`）
4. 产出 `CapabilityDescriptor(kind="WORKFLOW")`，不全量解析 `flowGraph`；非法 recipe diagnostic + skip，继续其他
5. 目录不存在、为空或无 `.yaml`/`.yml` 文件 → 返回空 descriptor 列表（非错误、非降级）

执行期懒加载（require）：
1. `require(agentId, recipeName)` 被调用
2. 命中缓存 → 直接返回完整 `RecipeDefinition`
3. 未命中 → 扫描 `agents/{agentId}/recipes/` 目录定位匹配 `recipeName` 的文件 → `parseBuiltInConfig` 解析 → `normalizeRecipeDefinition` v1→v2 归一（含 `domain`/`scene`/`lang` 透传）→ `RecipeDefinitionSchema` 校验 → 缓存 → 返回
4. 目录中无匹配 recipe → `AgentError`（`RECIPE_NOT_FOUND`）
5. 校验失败 → `AgentError`（`RECIPE_INVALID`），不缓存

**状态 / 产物契约：**
- recipe definition source DSL 缓存：`require` 懒加载后缓存完整 `RecipeDefinition`（含 `flowGraph`），per-agent FIFO 淘汰，硬编码上限 100 条，重复 `require` 命中缓存；淘汰时移除最早插入的条目，下次 `require` 重新加载
- 无启动期索引缓存、无持久索引（search 每次扫描目录，与 agent-owned skill 一致）
- 无 durable 事实、无 `RecipeRecord`、无 `RecipeStoreGateway`、无 checkpoint
- `domain`/`scene`/`lang` 是 `RecipeDefinition` 的一等可选字段，不进 `metadata`，可被下游 routing/dispatch 显式消费

**流程接入：**
- 上游：agent package 部署（recipe YAML 文件随 package 分发到 `agents/{agentId}/recipes/`）
- 下游：WORKFLOW capability descriptor 由 `workflow-routing` 和 Workflow tool 可用性检查消费；recipe definition source 由 `workflow-execution-engine`(执行期 `require` 懒加载完整 DSL)/`workflow-interaction-nodes`(sub-recipe require)/`workflow-knowledge-nodes`(recipe-choice 候选) 消费
- recipe capability provider 作为 default-enabled search provider 注册到 capability catalog，无需 Agent assembly 显式 binding

**失败与降级：**
- 单 recipe 文件解析非法 → diagnostic + skip 该 recipe，继续其他，不得静默吞错
- recipe 目录不存在或无 YAML 文件 → search 返回空列表（表示该 agent 无 recipe，非错误）
- recipe 目录路径逃逸 → search 失败（由 `Recipe Path Ownership` 约束）
- 执行期懒加载校验失败 → `AgentError`（`RECIPE_INVALID`），不缓存，请求失败
- 执行期目录中无匹配 recipe → `AgentError`（`RECIPE_NOT_FOUND`），routing 回退 agent loop
- 不得静默截断、静默丢弃或静默吞错

#### Scenario: Runtime Recipe Discovery
- **WHEN** catalog `resolve`/`listAvailable` 触发 recipe capability provider 的 `search(criteria)`
- **THEN** loader MUST 扫描 `agents/{agentId}/recipes/` 目录，解析所有合法 `.yaml`/`.yml` 文件的索引字段
- **AND** MUST 产出 `CapabilityDescriptor(kind="WORKFLOW")` 列表
- **AND** `flowGraph` MUST NOT 出现在 descriptor 中

#### Scenario: Default-Enabled Without Binding
- **WHEN** Agent assembly 不包含 RECIPE 类型的 `capabilityBindings`
- **AND** catalog `resolve` 评估 recipe capability
- **THEN** catalog MUST 通过 `searchDefaultEnabledProviders` 调用 recipe provider 的 `search()`
- **AND** 返回的 recipe descriptors MUST 进入 catalog 可见视图

#### Scenario: Lazy Load Full DSL On Require
- **WHEN** 执行期 `require(agentId, recipeName)` 被调用且缓存未命中
- **THEN** loader MUST 扫描目录定位匹配 `recipeName` 的文件、加载完整 DSL（含 `flowGraph`）、校验并缓存
- **AND** 后续相同 `recipeName` 的 `require` MUST 命中缓存

#### Scenario: Recipe Not Found
- **WHEN** 执行期 `require(agentId, recipeName)` 被调用且目录中无匹配 `recipeName` 的 recipe 文件
- **THEN** `require` MUST 抛出 `AgentError`（`RECIPE_NOT_FOUND`）
- **AND** routing MUST 回退到 agent loop

#### Scenario: Invalid Recipe Skip
- **WHEN** 单个 recipe 文件非法
- **THEN** 该 recipe MUST 被跳过
- **AND** search MUST 继续处理其他文件

#### Scenario: Classification Field Passthrough
- **WHEN** `normalizeRecipeDefinition` 处理含 `domain`/`scene`/`lang` 的 YAML 解析结果
- **THEN** 三个字段 MUST 原样保留到 `RecipeDefinition`
- **AND** MUST NOT 被合并到 `metadata`

#### Scenario: YAML Only No JSON
- **WHEN** recipe 目录含 `.json` 文件
- **THEN** loader MUST NOT 扫描或加载 `.json` 文件
- **AND** 仅 `.yaml`/`.yml` 文件 MUST 被处理

#### Scenario: No Durable Store
- **WHEN** recipe 加载执行
- **THEN** MUST NOT 调用任何 `RecipeStoreGateway` 或写入 durable store
- **AND** MUST NOT 引入 `RecipeRecord` persistence DTO

#### Scenario: No Recipe Means Empty Search Result
- **WHEN** `agents/{agentId}/recipes/` 目录不存在、为空或无 `.yaml`/`.yml` 文件
- **THEN** `search` MUST 返回空 descriptor 列表
- **AND** routing 对该 agent 的 workflow dispatch 自然回退到 model loop

#### Scenario: Lazy Load Validation Failure
- **WHEN** 执行期懒加载的 recipe DSL 校验失败
- **THEN** `require` MUST 抛出 `AgentError`（`RECIPE_INVALID`）
- **AND** 该 recipe MUST NOT 被缓存

#### Scenario: Recipe Cache FIFO Eviction
- **WHEN** 某 agent 的已缓存 recipe definition 数量达到上限（100）
- **AND** `require` 加载一个新的 recipe definition
- **THEN** loader MUST 移除该 agent 缓存中最早插入的条目
- **AND** 新加载的 recipe definition MUST 被缓存
- **AND** 被移除的 recipe 在下次 `require` 时 MUST 重新从目录加载

### Requirement: Recipe Path Ownership

recipe 路径 MUST 为 `paths.agentRoot` 配置值（与 Agent package 根路径一致）下的 `{agentId}/recipes/`，默认 `agents/{agentId}/recipes/`，且 MUST 只允许 workspace 内相对路径。路径逃逸防护在运行时目录扫描（`search`）和懒加载（`require`）时同步触发，MUST NOT 依赖启动期一次性校验。

#### Scenario: Default Recipe Paths
- **WHEN** recipe `search` 或 `require` 扫描 recipe 目录
- **THEN** 系统 MUST 扫描 `<paths.agentRoot>/{agentId}/recipes/`（默认 `agents/{agentId}/recipes/`）

#### Scenario: Configured AgentRoot Recipe Paths
- **WHEN** application config sets `paths.agentRoot` to a non-default location
- **THEN** recipe `search` 和 `require` MUST 扫描配置值下的 `{agentId}/recipes/`
- **AND** MUST NOT 回退到默认 `agents/{agentId}/recipes/`

#### Scenario: Unsafe Trusted Root Rejection
- **WHEN** recipe 目录路径解析到工程打包根目录之外
- **THEN** 扫描 MUST 失败，产出 diagnostic log
- **AND** `search` MUST 返回空 descriptor 列表
- **AND** `require` MUST 抛出 `AgentError`
