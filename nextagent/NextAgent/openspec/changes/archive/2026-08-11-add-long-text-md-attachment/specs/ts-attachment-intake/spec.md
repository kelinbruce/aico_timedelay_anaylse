## MODIFIED Requirements

### Requirement: Attachment intake 强制确定性限制和类型检查
Attachment intake MUST 以确定性规则校验附件数量、大小、类型和可读性。每个 request MUST 最多携带 3 个附件。每个文件 MUST 具有 server 读取的 `sizeBytes`，大于 0 且小于等于 5 MiB。Markdown 文件（`.md` 和 `.markdown` 扩展名）MUST 始终通过类型校验，不受 `chatUploadFileType` 配置影响；这是受控例外，因为平台具备内置 markdown 解析能力。所有其他文件类型 MUST 按已配置的 `chatUploadFileType` 模式校验。Markdown 检测 MUST 使用受信文件名、声明的 MIME 和 server 读取的字节；不在已配置 `chatUploadFileType` 内的 PDF、Excel、Word 及其他非 Markdown 输入 MUST 以安全错误被拒绝。

#### Scenario: Markdown 附件无视配置始终被接受
- **WHEN** 某个 request 在数量和大小限制内携带一个 `.md` 或 `.markdown` 附件
- **AND** 该 agent 的 `chatUploadFileType` 配置不包含 markdown 模式（例如 `["*.pcap"]`）
- **THEN** 系统 MUST 让 markdown 附件通过类型校验
- **AND** 系统 MUST 继续校验文件名、magic bytes、可读性和大小
- **AND** 系统 MUST NOT 以 `FILE_TYPE_UNSUPPORTED` 拒绝该附件

#### Scenario: 非 markdown 附件仍遵守配置
+- **WHEN** 某个 request 携带一个 `.pcap` 附件
+- **AND** 该 agent 的 `chatUploadFileType` 配置为 `["*.md", "*.markdown"]`（不包含 pcap）
+- **THEN** 系统 MUST 以 `FILE_TYPE_UNSUPPORTED` 拒绝该附件
+- **AND** 系统 MUST NOT 不论 media type 映射如何都接受该非 markdown 附件

#### Scenario: 限制内的 Markdown 附件被接受
- **WHEN** 某个 request 携带 1 到 3 个 Markdown 附件
- **AND** 每个附件大于 0 字节且不超过 5 MiB
- **THEN** 系统 MUST 校验类型和可读性
- **AND** 被接受的附件 MUST 产生 `AttachmentId`

#### Scenario: 过多附件被拒绝
- **WHEN** 某个 request 携带超过 3 个附件
- **THEN** 系统 MUST 拒绝该 request intake
- **AND** 系统 MUST 返回 `ATTACHMENT_COUNT_EXCEEDED`

#### Scenario: 不支持的类型被拒绝
- **WHEN** 某个 request 携带不在已配置 `chatUploadFileType` 内的 PDF、Excel、Word 或其他非 Markdown 附件
- **THEN** 系统 MUST 返回 `ATTACHMENT_TYPE_UNSUPPORTED`
- **AND** 系统 MUST NOT 尝试 parser、OCR 或内容提取

#### Scenario: magic bytes 不匹配的 Markdown 附件被拒绝
- **WHEN** 某个 request 携带名为 `report.md` 的文件，但 server 读取的 magic bytes 表明是 PDF 或二进制内容
- **THEN** 系统 MUST 以 `MAGIC_BYTES_MISMATCH` 拒绝该附件
- **AND** 系统 MUST NOT 尽管 markdown 被强制类型接受仍接受该附件
