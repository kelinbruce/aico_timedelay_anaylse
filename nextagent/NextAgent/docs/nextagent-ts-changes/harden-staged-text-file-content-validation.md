# harden-staged-text-file-content-validation

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：Security follow-up（非 UCD A7）

状态：clarify
类型：security refinement candidate
主要 owner：`agent-attachment-runtime`
协作 owner：若保留声明 MIME 校验，则为 `agent-channel-web`
认领人：不可认领
依赖：已完成的 `add-ts-remote-file-upload`

当前状态：
- 配置启用的 CSV/TSV/TXT/JSON/XML/LOG 已由统一 staged upload 支持；A7 不再是产品实现缺口。
- context 只获得安全 metadata；runtime materialize run-scoped path，既有 Read/workspace 工具读取正文。正文不得重新直接注入 context。
- `validateFileContent` 当前只读取文件头 8 字节执行文本 UTF-8/NUL 判断，无法发现更后位置的非法字节或二进制内容。
- staged upload request 当前未保留 multipart 声明 MIME，因此不能兑现 MIME/扩展名一致性检查。

目标：
- 对配置允许的文本文件执行覆盖完整内容、容量有界的 UTF-8/NUL/binary validation，并保持现有 staged lifecycle、scope 和 materialized-path 语义。

进入 `ready` 前必须确认：
- 全文件检查采用 bounded streaming decoder 还是其他唯一实现，chunk boundary 上的 UTF-8 如何校验。
- multipart 声明 MIME 是否作为 untrusted evidence 进入 `Phase1UploadRequest`；若不进入，规格必须删除无法兑现的 MIME mismatch 要求。
- 最大扫描 bytes、timeout/cancellation 和超限 safe error。

实现约束：
- 不新增 media enum、data-file store、context content block 或 frontend 白名单。
- 继续使用配置驱动的 extension allowlist 和既有 `AttachmentMediaType` 映射。
- 文件内容、非法片段和物理路径不得进入日志、trace、audit、SafeError 或 stream diagnostic。

非目标：
- 不解析表格、PDF、Word、压缩包或厂商二进制格式。
- 不执行 CSV 公式，不做编码猜测，不扩大附件数量/大小限制。

转为 `ready` 后的验收出口：
- negative tests 覆盖第 8 字节之后的 NUL、非法 UTF-8、binary magic、chunk boundary 非法序列、空文件和超限。
- 若保留 MIME evidence，contract/integration tests 覆盖可信传递和 mismatch；否则验证公开规格不再声称 MIME 校验。
- regression tests 证明既有配置类型、retry/edit/cleanup、materialization 和 Read path 不变，正文不进入 context。

并行边界：
- clarify 状态不可实施。
- 不修改 artifact download、PIU、session list、Process Panel 或 health UI。
