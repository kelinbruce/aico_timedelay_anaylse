# agent-owned-resource-dynamic-loading Specification

## Purpose
定义 agent-owned 本地资源（配置文件、静态资源目录）在运行时动态加载的行为契约。按部署模式分离 provider 实现：LOCAL 模式启动时加载一次静态返回，REMOTE 模式通过文件 fingerprint 动态检测变更并重载。

## ADDED Requirements

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
