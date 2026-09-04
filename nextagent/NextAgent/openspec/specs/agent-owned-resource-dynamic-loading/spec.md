# agent-owned-resource-dynamic-loading Specification

## Purpose
定义 agent-owned 本地资源（配置文件、静态资源目录）在运行时动态加载的行为契约。按部署模式分离 provider 实现：LOCAL 模式启动时加载一次静态返回，REMOTE 模式通过文件 fingerprint 动态检测变更并重载。

## Function

- **所属 Function**：`FN-5.2 调用能力`
- **spec 角色**：补充规格
## Requirements
### Requirement: ChatUploadConfigProvider implementation is selected by deployment mode
App composition MUST 按 `systemConfig.gateway.deploymentMode` 选择 `ChatUploadConfigProvider` 实现。LOCAL 模式 MUST 使用 `LocalChatUploadConfigProvider`，REMOTE 模式 MUST 使用 `RemoteChatUploadConfigProvider`。Provider 选择 MUST NOT 来自请求体、客户端 metadata 或模型输出。

#### Scenario: LOCAL 模式选择 LocalChatUploadConfigProvider
- **WHEN** `deploymentMode` 为 `LOCAL`
- **THEN** composition MUST 注入 `LocalChatUploadConfigProvider`
- **AND** MUST NOT 注入 `RemoteChatUploadConfigProvider`

#### Scenario: REMOTE 模式选择 RemoteChatUploadConfigProvider
- **WHEN** `deploymentMode` 为 `REMOTE`
- **THEN** composition MUST 注入 `RemoteChatUploadConfigProvider`
- **AND** MUST NOT 注入 `LocalChatUploadConfigProvider`

### Requirement: LocalChatUploadConfigProvider loads config once at startup and returns default when absent
`LocalChatUploadConfigProvider` MUST 在启动时加载一次 `config/config.json`，之后每次 `get()` 返回缓存的静态值。MUST NOT 做 fingerprint 检测（LOCAL 模式无 pub，配置不会运行时变化）。当配置文件不存在时，MUST 返回 `defaultChatUploadFileConfig()`（markdown-only 默认值），使文件上传功能在 local 模式下始终可用。

#### Scenario: Local 模式配置文件存在
- **WHEN** LOCAL 模式下 `config/config.json` 存在
- **THEN** provider MUST 在启动时加载并缓存 effective config
- **AND** 每次 `get()` MUST 返回缓存的静态值
- **AND** MUST NOT 在 `get()` 中做 `statSync` fingerprint 检测

#### Scenario: Local 模式配置文件不存在返回默认值
- **WHEN** LOCAL 模式下 `config/config.json` 不存在
- **THEN** provider MUST 返回 `defaultChatUploadFileConfig()`
- **AND** 上传功能 MUST 保持可用（markdown-only）
- **AND** bootstrap response MUST 包含 `chatUploadFileConfig` 字段

### Requirement: RemoteChatUploadConfigProvider detects config changes via fingerprint at request time
`RemoteChatUploadConfigProvider` MUST 在每次 `get()` 调用时通过文件 fingerprint（`statSync` 的 `size + mtimeMs`）检测 `config/config.json` 变更。fingerprint 未变化时返回缓存值；fingerprint 变化时重新加载并更新缓存。当配置文件不存在时，MUST 返回 `undefined`，且 MUST NOT 缓存该结果。当 provider 返回 `undefined` 时，bootstrap response MUST NOT 包含 `chatUploadFileConfig` 字段，上传路由 MUST 拒绝上传请求。

#### Scenario: Remote 模式配置文件在启动后到位
- **WHEN** REMOTE 模式下应用启动时 `config/config.json` 不存在
- **AND** 应用启动后该文件被创建（pub 流程）
- **THEN** 下一次请求 MUST 检测到文件已存在
- **AND** MUST 加载该文件并返回有效配置
- **AND** MUST NOT 返回 `undefined`

#### Scenario: Remote 模式配置文件内容变更后缓存失效
- **WHEN** REMOTE 模式下配置文件已被加载并缓存
- **AND** 文件内容被修改导致 `size` 或 `mtimeMs` 变化
- **THEN** 下一次请求 MUST 检测到 fingerprint 变化
- **AND** MUST 重新加载文件并更新缓存
- **AND** MUST NOT 返回修改前的缓存值

#### Scenario: Remote 模式配置文件不存在返回 undefined
- **WHEN** REMOTE 模式下配置文件不存在
- **THEN** provider MUST 返回 `undefined`
- **AND** MUST NOT 将 `undefined` 作为有效结果缓存
- **AND** bootstrap response MUST NOT 包含 `chatUploadFileConfig` 字段
- **AND** 上传路由 MUST 拒绝上传请求

#### Scenario: Remote 模式资源加载异常返回 undefined
- **WHEN** REMOTE 模式下配置文件存在但解析失败或校验异常
- **THEN** provider MUST 返回 `undefined`
- **AND** MUST NOT 抛出异常或阻断请求

### Requirement: Fingerprint detection uses stat metadata only
`RemoteChatUploadConfigProvider` 的 fingerprint 计算 MUST 使用 `statSync` 返回的 `size` 和 `mtimeMs`，MUST NOT 读取文件内容做 hash。文件不存在时 fingerprint MUST 为 `undefined`。fingerprint 比较使用字符串相等（`${path}:${size}:${mtimeMs}`）。

#### Scenario: fingerprint 不读取文件内容
- **WHEN** provider 检测资源文件是否变化
- **THEN** MUST 仅调用 `statSync` 获取文件元数据
- **AND** MUST NOT 调用 `readFile` 或 `createReadStream` 读取文件内容用于 fingerprint 计算

#### Scenario: 文件不存在时 fingerprint 为 undefined
- **WHEN** 资源文件不存在
- **THEN** fingerprint MUST 为 `undefined`
- **AND** provider MUST NOT 缓存任何结果

### Requirement: Bootstrap and upload routes resolve config through provider at request time
`/api/v1/runtime/bootstrap` 端点和上传路由 MUST 通过 `provider.get()` 获取 config，MUST NOT 使用启动时冻结的快照。

#### Scenario: bootstrap 返回当前生效配置
- **WHEN** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** 端点 MUST 调用 `ChatUploadConfigProvider.get()`
- **AND** MUST 返回 provider 当前返回的 config
- **AND** MUST NOT 返回启动时的快照

#### Scenario: 上传路由使用当前生效配置校验
- **WHEN** 用户上传文件
- **THEN** 上传路由 MUST 调用 `ChatUploadConfigProvider.get()` 获取当前 config
- **AND** MUST 使用当前 config 的文件类型、大小、数量限制进行校验

### Requirement: CategoryQuestionCatalog cache invalidates on file change
`DefaultCategoryQuestionCatalog` MUST NOT 永久缓存空结果。当 JSONL 文件不存在时，每次请求 MUST 重新尝试加载，MUST NOT 缓存空 catalog。当 JSONL 文件存在且已被缓存时，MUST 通过 fingerprint 检测文件变更，变化时清除缓存并重新加载。

#### Scenario: 空结果不被缓存
- **WHEN** `resource/` 目录存在但 `category-question-{locale}.jsonl` 文件不存在
- **THEN** catalog MUST 返回空分类列表
- **AND** MUST NOT 将空结果缓存
- **AND** 下次请求 MUST 再次尝试加载文件

#### Scenario: 文件到位后缓存自动更新
- **WHEN** 首次请求时 JSONL 文件不存在，返回空 catalog
- **AND** 文件后来被创建
- **THEN** 下次请求 MUST 检测到文件已存在
- **AND** MUST 加载文件内容并返回有效 catalog
- **AND** MUST NOT 返回之前的空结果

#### Scenario: 已缓存 catalog 在文件变更后失效
- **WHEN** catalog 已从 JSONL 文件加载并缓存
- **AND** JSONL 文件被修改
- **THEN** 下次请求 MUST 检测到 fingerprint 变化
- **AND** MUST 重新加载文件
- **AND** MUST NOT 返回修改前的缓存 catalog

### Requirement: Portal ability entry configuration fields and defaults

Agent package 的 `config/config.json` 顶层 `portal-ability-config` MUST 支持以下四个 boolean 字段：

- `cron-tasks-enabled`
- `long-term-memory-management-enabled`
- `knowledge-import-enabled`
- `full-process-enabled`

四个字段的默认值 MUST 均为 `true`。字段值仅接受 boolean；缺失、类型非法或值不是 boolean 时，对应字段 MUST 回退为 `true`，MUST NOT 抛出异常、阻断请求或把字符串 `"false"` 视为关闭。

四个字段 MUST 独立解析和回退。一个字段非法或缺失 MUST NOT 影响其他字段的 effective 值。未知字段 MUST 被忽略，MUST NOT 改变任何已解析字段的 effective 值。

字段值 MUST 来自 active Agent package 的受信 `config/config.json`，MUST NOT 来自请求体、客户端 metadata、模型输出或 Capability 参数。

**需求类别**：功能性需求

#### Scenario: 缺失字段使用默认值

- **WHEN** `portal-ability-config` 不存在，或缺少任一入口字段
- **THEN** 对应字段 effective 值 MUST 为 `true`

#### Scenario: 明确 false 关闭入口

- **WHEN** 任一入口字段为 `false`
- **THEN** 对应字段 effective 值 MUST 为 `false`

#### Scenario: 非法值回退默认值

- **WHEN** 任一入口字段不是 boolean
- **THEN** 对应字段 effective 值 MUST 为 `true`
- **AND** MUST NOT 抛出异常或阻断请求

#### Scenario: 字段独立回退

- **WHEN** 一个入口字段为 `false`，另一个入口字段为非法值
- **THEN** `false` 字段 MUST 保持 `false`
- **AND** 非法字段 MUST 回退为 `true`

#### Scenario: 未知字段不改变有效配置

- **WHEN** `portal-ability-config` 包含四个合法入口字段和一个未知字段
- **THEN** 四个入口字段 effective 值 MUST 保持不变
- **AND** 未知字段 MUST NOT 改变任何入口字段

### Requirement: Portal ability configuration fields and defaults

Agent package 的 `config/config.json` MUST 支持顶层 `portal-ability-config` 对象。系统 MUST 从以下推荐问题配置字段解析 effective 值：

- `suggested-questions-enabled`：boolean，默认 `true`；
- `ask-user-question-time-minutes`：integer，取值 `1..1440`，默认 `30`。

未知字段 MUST 被忽略，MUST NOT 改变 effective config 或使已解析字段失效。

`portal-ability-config` 缺失、不是 object、任一字段缺失或类型与范围非法时，系统 MUST 使用对应字段的安全默认值，MUST NOT 抛出异常、阻断请求或把非法值 clamp 到边界值。配置值 MUST 来自 active Agent package 的受信文件，MUST NOT 来自请求体、客户端 metadata、模型输出或 Capability 参数。

**需求类别**：功能性需求

#### Scenario: 缺失配置使用默认值
- **WHEN** active Agent package 的 `config/config.json` 不存在，或不含 `portal-ability-config`
- **THEN** effective config MUST 为 `suggested-questions-enabled=true` 且 `ask-user-question-time-minutes=30`

#### Scenario: 非法等待时间回到默认值
- **WHEN** `ask-user-question-time-minutes` 为 `0`、负数、非 integer、`1441` 或非 number
- **THEN** effective `ask-user-question-time-minutes` MUST 为 `30`
- **AND** MUST NOT 把非法值截断为 `1` 或 `1440`

#### Scenario: 边界值合法
- **WHEN** `ask-user-question-time-minutes` 为 `1` 或 `1440`
- **THEN** effective `ask-user-question-time-minutes` MUST 分别保持 `1` 或 `1440`

#### Scenario: 非法推荐问题开关回到默认值
- **WHEN** `suggested-questions-enabled` 不是 boolean
- **THEN** effective `suggested-questions-enabled` MUST 为 `true`

#### Scenario: 未知字段不改变有效配置
- **WHEN** `portal-ability-config` 同时包含两个合法字段和一个未知字段
- **THEN** 两个合法字段的 effective 值 MUST 保持不变
- **AND** 未知字段 MUST NOT 改变任何 effective 值

### Requirement: PortalAbilityConfigProvider follows deployment-mode loading policy

App composition MUST 按 deployment mode 选择 `PortalAbilityConfigProvider` 实现。LOCAL 模式 MUST 在首次读取后缓存 effective config，后续 `get()` 返回同一静态值，MUST NOT 做 fingerprint 检测。REMOTE 模式 MUST 在每次 `get()` 时使用 `statSync` 的 `size + mtimeMs` fingerprint 检测 active Agent package 的 `config/config.json`；fingerprint 未变化时返回缓存值，变化时重新读取并更新缓存。REMOTE 模式文件不存在、JSON 解析失败或配置非法时 MUST 返回安全默认值，MUST NOT 抛出异常或阻断请求。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：`FN-5.2 调用能力`

#### Scenario: LOCAL 模式配置不热更新
- **WHEN** LOCAL 模式 provider 已读取 effective config
- **AND** `config/config.json` 之后被修改
- **THEN** 后续 `get()` MUST 返回已缓存的旧值
- **AND** MUST NOT 执行 fingerprint 检测

#### Scenario: REMOTE 模式配置变化后重新加载
- **WHEN** REMOTE 模式 provider 已缓存 effective config
- **AND** `config/config.json` 的 `size` 或 `mtimeMs` 变化
- **THEN** 下一次 `get()` MUST 重新读取文件并返回新的 effective config
- **AND** MUST NOT 返回修改前的缓存值

#### Scenario: REMOTE 模式配置缺失返回默认值
- **WHEN** REMOTE 模式下 `config/config.json` 不存在
- **THEN** `PortalAbilityConfigProvider.get()` MUST 返回默认值
- **AND** MUST NOT 返回 `undefined`
- **AND** MUST NOT 阻断 bootstrap 或 runtime 消费方

#### Scenario: REMOTE 模式非法配置返回默认值
- **WHEN** REMOTE 模式下 `config/config.json` 存在但 JSON 解析失败或 `portal-ability-config` 非法
- **THEN** provider MUST 返回安全默认值
- **AND** MUST NOT 抛出异常
