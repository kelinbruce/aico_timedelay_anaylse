## ADDED Requirements

### Requirement: Bootstrap API 暴露文件上传配置
`/api/v1/runtime/bootstrap` 端点 MUST 在请求时通过 `ChatUploadConfigProvider.get()` 暴露生效的上传能力和限制，而不是来自启动时冻结的快照。

**LOCAL 模式**：response MUST 始终包含带生效值的 `chatUploadFileConfig`。当 config 文件不存在时，response MUST 包含默认的仅 markdown 限制，使文件上传保持可用。

**REMOTE 模式**：当 config 文件存在时，response MUST 包含 `chatUploadFileConfig`。当 config 文件不存在时，response MUST NOT 包含 `chatUploadFileConfig`，向前端表明文件上传被禁用。

该 config MUST 为所有客户端相关字段包含生效（校验后）值：`chatUploadFileType`、`chatUploadMaxFileNumber`、`chatUploadMaxFileSize`、`uploadFileIdleExpireTime`、`uploadFileMaxExpireTime`。前端 MUST NOT 需要诸如 HOFS bucket 名之类的存储 backend 标识来选择上传工作流。

#### Scenario: LOCAL 模式 bootstrap 始终包含文件上传配置
- **WHEN** LOCAL 模式且前端调用 `/api/v1/runtime/bootstrap`
- **THEN** response MUST 包含 `chatUploadFileConfig`
- **AND** 所有字段 MUST 反映生效值（config 或默认值）

#### Scenario: REMOTE 模式 bootstrap 在已配置时包含 config
- **WHEN** REMOTE 模式且 config 文件存在
- **AND** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** response MUST 包含带生效值的 `chatUploadFileConfig`

#### Scenario: REMOTE 模式 bootstrap 在未配置时省略 chatUploadFileConfig
- **WHEN** REMOTE 模式且 config 文件不存在
- **AND** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** response MUST NOT 包含 `chatUploadFileConfig`
- **AND** 前端 MUST 禁用附件按钮并显示 tooltip

#### Scenario: Bootstrap response 不暴露存储路由细节
- **WHEN** 因 HOFS 缺失而使用本地存储，但 config 文件存在
- **THEN** bootstrap response MUST 包含带生效默认限制的 `chatUploadFileConfig`
- **AND** 前端 MUST NOT 从 HOFS bucket 的缺失推断出不同的上传协议

#### Scenario: Bootstrap 返回当前 config 而不是启动快照
- **WHEN** REMOTE 模式且 config 文件在应用启动后被创建或修改
- **AND** 前端调用 `/api/v1/runtime/bootstrap`
- **THEN** 该端点 MUST 调用 `ChatUploadConfigProvider.get()` 获取当前 config
- **AND** response MUST 反映当前 `config/config.json` 内容
- **AND** MUST NOT 返回启动时冻结的快照

### Requirement: Bootstrap config 驱动前端上传行为
前端 MUST 使用 bootstrap config 配置上传限制、接受的文件类型和计时器显示。当 `chatUploadFileConfig` 存在时，前端 MUST 启用附件按钮；不存在时 MUST 禁用它并显示 tooltip。启用时，前端 MUST 始终为附件使用统一的 staged upload 流程。

#### Scenario: 前端以已配置的限制使用 staged upload
- **WHEN** bootstrap response 包含 `chatUploadFileConfig`
- **THEN** 前端 MUST 启用附件按钮
- **AND** 前端 MUST 在选择后立即通过 staged upload 端点上传文件
- **AND** 前端 MUST 在提交问题时发送 staged 附件引用
- **AND** 前端 MUST 应用来自 config 的接受文件类型和大小/数量限制

#### Scenario: 前端在 config 缺失时禁用附件按钮
- **WHEN** bootstrap response 不包含 `chatUploadFileConfig`
- **THEN** 前端 MUST 禁用附件按钮
- **AND** MUST 显示 tooltip 说明文件上传未配置
- **AND** MUST NOT 回退到默认上传限制
