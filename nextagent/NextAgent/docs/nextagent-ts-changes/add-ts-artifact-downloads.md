# add-ts-artifact-downloads

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3 / Artifact downloads

状态：clarify
类型：candidate contract + implementation change
主要 owner：`agent-session`
协作 owner：`agent-channel-web`、`agent-platform-gateway-local`、`agent-web`
认领人：不可认领
依赖：artifact durable content locator 与 Agent/session 可见性 contract refinement

当前状态：
- 最新主干已有附件/文件展示组件，但展示 metadata 不等于 artifact bytes 下载能力。
- `ArtifactMetadataRecord` 仍没有 durable `BlobRef`、`agentId`、`sessionId` 或等价关系，不能从公开 `artifactId` 安全定位内容。

目标：
- 让用户从会话中的文件卡片安全下载 Agent 产生的 artifact，并保持 owner scope、Agent Scope、可用性和内容存储边界。

规格输入：
- 下载入口只能接受公开 `artifactId`，服务端必须从可信 identity 和 session-bound Agent Scope 查询 artifact metadata；客户端不得提交或解析 `BlobRef`、本地路径或 storage key。
- 只有状态为可用且属于当前 owner/agent/session 可见范围的 artifact 才能下载；不存在、越权、已清理和过期必须使用不可区分的 safe failure，避免枚举。
- HTTP response 必须设置安全文件名、受控 content type、长度和下载 disposition；禁止 active HTML/script inline execution。
- 大文件必须流式读取并遵循 backpressure/cancellation；下载不得把完整 bytes 读入日志、trace、audit 或模型上下文。
- FileCard 至少显示安全文件名、类型/大小（可用时）和明确下载状态；失败可重试但不得暴露内部路径。

契约输入：
- 复用 `ArtifactMetadata`、`ArtifactId`、session-visible content reference 和 `BlobStoreGateway`。
- 当前 `ArtifactMetadataRecord` 只有 owner scope 和显示 metadata，没有 `BlobRef`、`agentId`、`sessionId` 或等价 durable relation；进入 `ready` 前必须确定 artifact 如何定位内容并证明 Agent/session 可见性。
- 目标 Web download DTO/route 由 `agent-channel-web` 拥有；领域可见性判断由 `agent-session` 服务拥有；gateway 只按 opaque `BlobRef` 读取 bytes。

实现约束：
- 候选唯一路径为 `agent-channel-web route -> agent-session artifact access service -> ArtifactMetadataStoreGateway/BlobStoreGateway`；contract refinement 必须先补足 durable locator 和 scope relation，不能用命名约定把 `artifactId` 强转为 `BlobRef`。
- channel 不直接查 gateway record，frontend 不接收 `BlobRef`，gateway 不判断用户权限。
- content disposition 文件名必须清理 CR/LF、路径分隔符和控制字符。

非目标：
- 不实现 artifact 编辑、在线预览、版本管理、分享链接或跨 owner 共享。
- 不复用附件上传 URL，不把 artifact 与 attachment 合并为同一业务对象。
- 不提供任意 workspace 文件下载。

验收要点：
- 转为 `ready` 前必须通过 contract review，明确 artifact metadata、blob lifecycle、Agent/session visibility、cleanup/expiry 和既有数据兼容策略。
- integration tests 覆盖成功流式下载、owner/agent/session 越权、缺失、已过期/清理、客户端断开和 gateway read failure。
- security tests 覆盖路径穿越、响应头注入、active content type 和 BlobRef/内部路径泄露。
- frontend tests 覆盖可下载/下载中/失败/不可用状态。
- 后端 build、相关 tests、contract/architecture gates 和 frontend build/tests 通过。

并行边界：
- 不修改附件 intake/context、runtime lifecycle、terminal commit 或 capability execution。
- clarify 状态不可实施；contract refinement 完成后再重新核对与其他 artifact/gateway change 的冲突面。

需群内确认：
- 必须确认 `ArtifactMetadata`/`ArtifactMetadataRecord` 的 durable content locator 与 Agent/session scope 关系，以及是否新增或扩展 public gateway contract。
