## MODIFIED Requirements

### Requirement: Attachment mediaType 使用共享 vocabulary
`RequestAttachmentRecord.mediaType`、`RequestAttachment.mediaType` 和 gateway 持久化 DTO MUST 使用共享的 `AttachmentMediaType` union（`"WORD" | "EXCEL" | "PDF" | "MARKDOWN" | "PCAP" | "PCAPNG" | "CAP" | "TMF" | "PTMF" | "ZIP" | "TAR" | "RAR" | "GZ"`）。统一 staged upload MUST 在持久化之前把每个受支持的扩展名映射到该 vocabulary；对于没有映射的已配置扩展名，它 MUST 拒绝。

#### Scenario: Staged upload 在持久化前映射 mediaType
- **WHEN** 附件上传接受一个名为 `report.xlsx` 的文件
- **THEN** `RequestAttachmentRecord.mediaType` MUST 是 `"EXCEL"`
- **AND** 该文件 MUST 通过 `BlobStoreGateway` 持久化
- **AND** `mediaType` 字段 MUST 使用 `AttachmentMediaType`

#### Scenario: 电信抓包扩展名映射到各自的 vocabulary 值
- **WHEN** 附件上传接受一个名为 `capture.pcap` 的文件（或 `.pcapng`、`.cap`、`.tmf`、`.ptmf`、`.zip`、`.tar`、`.rar`、`.gz`）
- **THEN** `RequestAttachmentRecord.mediaType` MUST 是匹配的 vocabulary 值（`"PCAP"`、`"PCAPNG"`、`"CAP"`、`"TMF"`、`"PTMF"`、`"ZIP"`、`"TAR"`、`"RAR"`、`"GZ"`）
- **AND** 扩展名匹配 MUST 不区分大小写（`.PCAP` 映射到 `"PCAP"`）
- **AND** 扩展名提取 MUST 只保留最后一段（`bundle.tar.gz` 映射到 `"GZ"`）
- **AND** intake 路径和 staged-upload 路径对同一文件名 MUST 持久化相同的 `mediaType`

#### Scenario: 已映射的 mediaType 不破坏 context engine
- **WHEN** 某个 `RequestAttachmentRecord` 具有已映射的 `mediaType`
- **THEN** context engine MUST NOT 为内容注入检查 `mediaType`
- **AND** 所有受支持的已映射文件类型 MUST 被接受
- **AND** tool 执行 MUST 接收由系统解析的 attachment ref，且不在模型可见 prompt 文本中暴露存储坐标

### Requirement: 前端 AttachmentRef mediaType 使用共享 vocabulary
前端 `AttachmentRef.mediaType` MUST 使用 `AttachmentMediaType` enum。

#### Scenario: 前端显示已映射的文件类型
- **WHEN** 某个 remote 模式附件具有 `mediaType: "EXCEL"`
- **THEN** 前端 MUST 能不带类型错误地显示它
- **AND** 前端 MUST 渲染共享 vocabulary 值
