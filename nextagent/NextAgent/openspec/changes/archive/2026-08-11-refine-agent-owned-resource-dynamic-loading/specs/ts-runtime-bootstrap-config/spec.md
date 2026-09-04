## MODIFIED Requirements

### Requirement: Bootstrap API 暴露文件上传配置
`/api/v1/runtime/bootstrap` 端点 MUST 在请求时通过 `ChatUploadConfigProvider.get()` 暴露生效的上传能力和限额，而不是来自启动时冻结的快照。

**LOCAL mode**：响应 MUST 始终包含带生效值的 `chatUploadFileConfig`。当配置文件不存在时，响应 MUST 包含默认的 markdown-only 限额，使文件上传保持可用。

**REMOTE mode**：当配置文件存在时，响应 MUST 包含 `chatUploadFileConfig`。当配置文件不存在时，响应 MUST NOT 包含 `chatUploadFileConfig`，以此向 frontend 表明文件上传已禁用。

该配置 MUST 为所有与 client 相关的字段提供生效（校验后）值：`chatUploadFileType`、`chatUploadMaxFileNumber`、`chatUploadMaxFileSize`、`uploadFileIdleExpireTime`、`uploadFileMaxExpireTime`。frontend 选择上传 workflow 时 MUST NOT 依赖诸如 HOFS bucket 名之类的存储后端标识。

#### Scenario: LOCAL mode bootstrap 始终包含文件上传配置
- **WHEN** LOCAL mode 且 frontend 调用 `/api/v1/runtime/bootstrap`
- **THEN** 响应 MUST 包含 `chatUploadFileConfig`
- **AND** 所有字段 MUST 反映生效值（配置值或默认值）

#### Scenario: REMOTE mode bootstrap 在已配置时包含配置
- **WHEN** REMOTE mode 且配置文件存在
- **AND** frontend 调用 `/api/v1/runtime/bootstrap`
- **THEN** 响应 MUST 包含带生效值的 `chatUploadFileConfig`

#### Scenario: REMOTE mode bootstrap 在未配置时省略 chatUploadFileConfig
- **WHEN** REMOTE mode 且配置文件不存在
- **AND** frontend 调用 `/api/v1/runtime/bootstrap`
- **THEN** 响应 MUST NOT 包含 `chatUploadFileConfig`
- **AND** frontend MUST 禁用附件按钮并以 tooltip 说明

#### Scenario: Bootstrap 响应不暴露存储路由细节
- **WHEN** 因 HOFS 缺失而使用本地存储但配置文件存在
- **THEN** bootstrap 响应 MUST 包含带生效默认限额的 `chatUploadFileConfig`
- **AND** frontend MUST NOT 因 HOFS bucket 缺失而推断出不同的上传协议

#### Scenario: Bootstrap 返回当前配置而非启动时快照
- **WHEN** REMOTE mode 且配置文件在应用启动后被创建或修改
- **AND** frontend 调用 `/api/v1/runtime/bootstrap`
- **THEN** 该端点 MUST 调用 `ChatUploadConfigProvider.get()` 获取当前配置
- **AND** 响应 MUST 反映当前 `config/config.json` 内容
- **AND** MUST NOT 返回启动时冻结的快照

### Requirement: Bootstrap 配置驱动 frontend 上传行为
frontend MUST 使用 bootstrap 配置来配置上传限额、可接受的文件类型和计时器显示。当 `chatUploadFileConfig` 存在时，frontend MUST 启用附件按钮；当其缺失时，MUST 以 tooltip 说明并禁用该按钮。启用时，frontend 对附件 MUST 始终使用统一的 staged upload 流程。

#### Scenario: Frontend 使用带配置限额的 staged upload
- **WHEN** bootstrap 响应包含 `chatUploadFileConfig`
- **THEN** frontend MUST 启用附件按钮
- **AND** frontend MUST 在选中文件后立即通过 staged upload 端点上传文件
- **AND** frontend MUST 在提交问题时发送 staged attachment 引用
- **AND** frontend MUST 应用配置中的可接受文件类型以及大小/数量限额

#### Scenario: Frontend 在配置缺失时禁用附件按钮
- **WHEN** bootstrap 响应不包含 `chatUploadFileConfig`
- **THEN** frontend MUST 禁用附件按钮
- **AND** MUST 显示一个说明文件上传未配置的 tooltip
- **AND** MUST NOT 回退到默认上传限额
