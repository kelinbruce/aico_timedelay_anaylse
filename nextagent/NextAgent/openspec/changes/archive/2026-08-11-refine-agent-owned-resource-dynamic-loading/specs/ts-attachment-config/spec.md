## MODIFIED Requirements

### Requirement: 文件上传配置从 agent config 目录加载
系统 MUST 从 `agents/{agentId}/config/config.json` 的 `chat-upload-file-config` 键加载文件上传配置。默认 agent 的 config MUST 被当作全局系统 config。加载器 MUST 使用 `AgentPackageSourceLocator` 定位 agent package 根目录，再读取 `config/config.json`。

Config 加载 MUST 通过一个按部署模式选择的 `ChatUploadConfigProvider` 完成。该 provider MUST 使用 `ChatUploadConfigSourceLocator` 和一个文件加载函数来解析 config。

**LOCAL 模式**：`LocalChatUploadConfigProvider` 在启动时加载一次 config，并在每次 `get()` 调用时返回缓存后的静态值。当 config 文件不存在时，该 provider MUST 返回 `defaultChatUploadFileConfig()`（markdown-only），使文件上传在本地模式保持可用。该 provider MUST NOT 做 fingerprint 检测。

**REMOTE 模式**：`RemoteChatUploadConfigProvider` 使用文件 fingerprint（`statSync` 的 `size + mtimeMs`）检测 config 文件变更，并在 fingerprint 变化时重新加载。当 config 文件不存在时，该 provider MUST 返回 `undefined`，表示文件上传未被配置。该 provider MUST NOT 缓存 `undefined` 结果，使之后创建的 config 文件能在下一次请求中被检测到。

当 config 文件存在但包含无效或缺失的字段时，加载器 MUST 应用 Cap + Warn 策略（封顶到系统限制，对缺失/无效字段使用默认值）并返回有效配置。

#### Scenario: Config 从默认 agent 目录加载
- **WHEN** 系统收到 bootstrap 或上传请求
- **THEN** 加载器 MUST 定位默认 agent package 根目录
- **AND** 加载器 MUST 读取 `config/config.json`
- **AND** 加载器 MUST 解析 `chat-upload-file-config` 部分

#### Scenario: LOCAL 模式 config 文件不存在时返回默认值
- **WHEN** LOCAL 模式且默认 agent 的 `config/config.json` 不存在
- **THEN** provider MUST 返回 `defaultChatUploadFileConfig()`（markdown-only）
- **AND** bootstrap 响应 MUST 包含带默认值的 `chatUploadFileConfig`
- **AND** 文件上传 MUST 保持可用

#### Scenario: REMOTE 模式 config 文件不存在时返回 undefined
- **WHEN** REMOTE 模式且默认 agent 的 `config/config.json` 不存在
- **THEN** provider MUST 返回 `undefined`
- **AND** bootstrap 响应 MUST NOT 包含 `chatUploadFileConfig`
- **AND** provider MUST NOT 缓存 `undefined` 结果

#### Scenario: REMOTE 模式 config 文件在启动后被创建
- **WHEN** REMOTE 模式且应用启动时没有 `config/config.json`
- **AND** 该文件在启动后被创建（pub flow）
- **THEN** 下一次请求 MUST 通过 fingerprint 变化检测到该文件
- **AND** MUST 加载 config 并返回有效值
- **AND** MUST NOT 返回 `undefined`

#### Scenario: REMOTE 模式 config 文件内容在初始加载后被修改
- **WHEN** REMOTE 模式且 config 文件已被加载并缓存
- **AND** 文件内容被修改（size 或 mtimeMs 变化）
- **THEN** 下一次请求 MUST 检测到 fingerprint 变化
- **AND** MUST 重新加载 config 并更新缓存
- **AND** MUST NOT 返回过期的缓存 config

#### Scenario: Config 文件存在但字段无效时使用 Cap and Warn
- **WHEN** config 文件存在但 `chat-upload-max-file-number` 超过系统限制
- **THEN** provider MUST 把该值封顶到系统限制
- **AND** MUST 返回有效 config（而不是 `undefined`）
