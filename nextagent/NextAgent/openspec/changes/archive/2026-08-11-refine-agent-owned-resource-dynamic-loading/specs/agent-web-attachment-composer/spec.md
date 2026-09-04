## MODIFIED Requirements

### Requirement: Attachment picker 与文件拖放 SHALL 共享同一条权限控制的接入路径

Agent Web SHALL 通过文件选择器和文件拖放以同一客户端接入行为接受附件。非文件的拖放数据 SHALL 被忽略。没有 `AICOService.Write` 时，附件按钮 SHALL 被禁用，隐藏的文件输入 SHALL 不被渲染，文件拖放 SHALL 不添加附件。

当 bootstrap 响应不包含 `chatUploadFileConfig`（REMOTE 模式且配置文件不可用）时，附件按钮 SHALL 被禁用并带一个说明文件上传未配置的 tooltip。隐藏的文件输入 SHALL 不被渲染。文件拖放 SHALL 不添加附件。Agent Web SHALL NOT 在 `chatUploadFileConfig` 缺失时静默回退到默认上传限制。

当 bootstrap 响应包含 `chatUploadFileConfig`（LOCAL 模式始终包含，REMOTE 模式在配置文件存在时包含）时，附件按钮 SHALL 被启用，并 SHALL 使用这些配置值驱动可接受的文件类型、大小限制和数量限制。

#### Scenario: Picker 与文件拖放通过同一队列添加
- **WHEN** 用户从 picker 选择受支持的文件，或把受支持的文件拖放到 Composer 上
- **THEN** Agent Web SHALL 应用相同的批次校验和队列行为

#### Scenario: 非文件拖放被忽略
- **WHEN** 用户把不包含文件的数据拖过 Composer
- **THEN** Agent Web SHALL NOT 显示文件拖放接收或添加附件

#### Scenario: 缺失 Write 权限阻止附件接入
- **GIVEN** 某个远程用户缺少 `AICOService.Write`
- **WHEN** Composer 被渲染或有文件被拖放
- **THEN** 附件按钮 SHALL 可见但被禁用
- **AND** 文件输入 SHALL 不被渲染
- **AND** 被拖放的文件 SHALL 不入队

#### Scenario: REMOTE 模式缺失上传配置时禁用附件按钮
- **GIVEN** REMOTE 模式且 bootstrap 响应不包含 `chatUploadFileConfig`
- **WHEN** Composer 被渲染
- **THEN** 附件按钮 SHALL 被禁用
- **AND** 一个 tooltip SHALL 说明文件上传未配置
- **AND** 文件输入 SHALL 不被渲染
- **AND** 文件拖放 SHALL 不添加附件

#### Scenario: LOCAL 模式附件按钮始终启用
- **GIVEN** LOCAL 模式且 bootstrap 响应包含带默认 markdown-only 限制的 `chatUploadFileConfig`
- **WHEN** Composer 被渲染
- **THEN** 附件按钮 SHALL 被启用
- **AND** 可接受的文件类型 SHALL 仅为 markdown（`.md`、`.markdown`）

#### Scenario: 存在上传配置时启用附件按钮
- **GIVEN** bootstrap 响应包含带有效值的 `chatUploadFileConfig`
- **WHEN** Composer 被渲染
- **THEN** 附件按钮 SHALL 被启用
- **AND** 可接受的文件类型、大小限制和数量限制 SHALL 由该配置驱动
