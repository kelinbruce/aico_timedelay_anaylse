## ADDED Requirements

### Requirement: 文件上传配置从 agent config 目录加载
系统 MUST 从 `agents/{agentId}/config/config.json` 的 `chat-upload-file-config` key 下加载文件上传配置。默认 agent 的 config MUST 被当作全局系统 config。loader MUST 使用 `AgentPackageSourceLocator` 定位 agent package 根，然后读取 `config/config.json`。

Config 加载 MUST 通过由 deployment mode 选择的 `ChatUploadConfigProvider` 完成。该 provider MUST 使用 `ChatUploadConfigSourceLocator` 和一个文件加载函数来解析 config。

**LOCAL 模式**：`LocalChatUploadConfigProvider` 在启动时加载一次 config，并在每次 `get()` 调用时返回缓存的静态值。当 config 文件不存在时，该 provider MUST 返回 `defaultChatUploadFileConfig()`（仅 markdown），使文件上传在 local 模式下保持可用。该 provider MUST NOT 做 fingerprint 检测。

**REMOTE 模式**：`RemoteChatUploadConfigProvider` 使用文件 fingerprint（`statSync` 的 `size + mtimeMs`）检测 config 文件变化，并在 fingerprint 变化时重新加载。当 config 文件不存在时，该 provider MUST 返回 `undefined`，表明文件上传未配置。该 provider MUST NOT 缓存 `undefined` 结果，使随后创建的 config 文件能在下一次请求中被检测到。

当 config 文件存在但包含非法或缺失字段时，loader MUST 应用 Cap + Warn 策略（封顶到系统限制，为缺失/非法字段使用默认值）并返回生效的 config。

#### Scenario: 配置从默认 agent 目录加载
- **WHEN** 系统收到 bootstrap 或上传请求
- **THEN** loader MUST 定位默认 agent package 根
- **AND** loader MUST 读取 `config/config.json`
- **AND** loader MUST 解析 `chat-upload-file-config` section

#### Scenario: LOCAL 模式下 config 文件不存在时返回默认值
- **WHEN** LOCAL 模式且默认 agent 的 `config/config.json` 不存在
- **THEN** provider MUST 返回 `defaultChatUploadFileConfig()`（仅 markdown）
- **AND** bootstrap response MUST 包含带默认值的 `chatUploadFileConfig`
- **AND** 文件上传 MUST 保持可用

#### Scenario: REMOTE 模式下 config 文件不存在时返回 undefined
- **WHEN** REMOTE 模式且默认 agent 的 `config/config.json` 不存在
- **THEN** provider MUST 返回 `undefined`
- **AND** bootstrap response MUST NOT 包含 `chatUploadFileConfig`
- **AND** provider MUST NOT 缓存 `undefined` 结果

#### Scenario: REMOTE 模式下 config 文件在启动后被创建
- **WHEN** REMOTE 模式且应用在没有 `config/config.json` 的情况下启动
- **AND** 该文件在启动后被创建（pub 流程）
- **THEN** 下一次请求 MUST 通过 fingerprint 变化检测到该文件
- **AND** MUST 加载 config 并返回生效值
- **AND** MUST NOT 返回 `undefined`

#### Scenario: REMOTE 模式下 config 文件内容在初始加载后变化
- **WHEN** REMOTE 模式且 config 文件已被加载并缓存
- **AND** 文件内容被修改（size 或 mtimeMs 变化）
- **THEN** 下一次请求 MUST 检测到 fingerprint 变化
- **AND** MUST 重新加载 config 并更新缓存
- **AND** MUST NOT 返回过期的缓存 config

#### Scenario: config 文件存在但字段非法时使用 Cap and Warn
- **WHEN** config 文件存在但 `chat-upload-max-file-number` 超过系统限制
- **THEN** provider MUST 把该值封顶到系统限制
- **AND** MUST 返回生效的 config（而不是 `undefined`）

### Requirement: Config 校验使用 Cap and Warn 策略
Config 字段校验 MUST 静默地把值封顶到系统限制，为缺失或非法字段使用默认值，且绝不使系统启动失败。系统 MUST NOT 向前端返回 config 校验通知。bootstrap API MUST 只返回生效（校验后）的 config 值。

系统硬限制：
- `chat-upload-max-file-number`：最大 200
- `chat-upload-max-file-size`：最大 500（M）
- 每用户总文件大小（所有 session）：最大 500 MB
- 用户 tmp 配额：1024 MB

#### Scenario: 超过系统限制的配置值被封顶
- **WHEN** `chat-upload-max-file-number` 被配置为 500
- **THEN** 生效值 MUST 是 200
- **AND** 系统 MUST 正常启动

#### Scenario: 缺失的配置字段使用默认值
- **WHEN** `chat-upload-max-file-number` 不存在于 config 中
- **THEN** 生效值 MUST 是 10（默认）

#### Scenario: 类型错误的配置字段使用默认值
- **WHEN** `chat-upload-max-file-size` 被配置为字符串 `"10"`
- **THEN** 生效值 MUST 是 10（默认）

#### Scenario: 空的 hofs-bucket-name 只选择本地存储
- **WHEN** `hofs-bucket-name` 为空或空白
- **THEN** app composition MUST 为暂存的附件字节选择本地存储
- **AND** public upload API MUST 保持统一的 staged upload API
- **AND** 前端 MUST NOT 因 HOFS 缺失而切换到 submit multipart

#### Scenario: 空 file-type 数组默认为 markdown
- **WHEN** `chat-upload-file-type` 是空数组
- **THEN** 生效值 MUST 是 `["*.md"]`

#### Scenario: max-expire-time 小于 idle-expire-time 时被调整
- **WHEN** `upload-file-max-expire-time` 小于 `upload-file-idle-expire-time`
- **THEN** `upload-file-max-expire-time` MUST 被设为等于 `upload-file-idle-expire-time`

### Requirement: Config 通过 bootstrap API 暴露生效值
`/api/v1/runtime/bootstrap` 端点 MUST 在附件上传启用时包含生效的上传限制和接受的文件类型。response MUST 只包含校验后的值。存储后端选择是 app composition 关注点，MUST NOT 要求前端选择不同的上传协议。

#### Scenario: Bootstrap 返回生效配置
- **WHEN** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** response MUST 包含带生效值的 `chatUploadFileConfig`
- **AND** 这些值 MUST 反映任何封顶或默认值替换

#### Scenario: 无 HOFS 配置的 bootstrap 仍使用统一上传
- **WHEN** HOFS 未配置（local 模式）
- **THEN** 本地存储 MUST 支撑同一个 staged upload API
- **AND** 前端 MUST NOT 收到使用 submit multipart 作为 fallback 的指示
