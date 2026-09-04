# agent-attachment-runtime

## 职责

- 拥有 HOFS 文件下载执行边界：`FileDownloadPort` 复用 `BlobStoreGateway.materializeBlob` 物化对象到临时文件，管理下载临时文件生命周期，推导下载文件名与 Content-Type；全局下载并发上限 4（跨所有用户共享），超限等待 30 秒后返回 503。下载成功与失败均产生审计事件（含 `userId`、`tenantId`、`agentId`、`sessionId`、`objectName`、`sizeBytes`、`result`、`reasonCode`、`downloadId`，不含文件内容、路径或凭据）。契约见 `ts-hofs-file-download`。

承载 request attachment validation、staging、metadata extraction boundary、attachment refs、availability check、retry source attachment revalidation 和 cleanup policy skeleton。

## 非职责

不定义具体 upload route、文件解析实现、存储 schema、Web transport、retry ownership 或 app composition。

## 依赖

允许依赖 `@nextagent/agent-common` 和 `@nextagent/agent-contracts/attachment`、`agent-contracts/gateway` public subpaths。不导入 Web channel、runtime implementation、file upload framework 或其它 implementation package。

## 核心设计落点

- 落实 `architecture/owner-scope-security.md` 的 attachment trust boundary：附件进入请求前必须经过 owner、availability 和 safe descriptor 校验。
- attachment intake 由本模块产生 `AttachmentId`、opaque `BlobRef` 和 authoritative `RequestAttachment` facts。
- 当前最小内核不启用附件产品能力；本模块保留可信处理 owner skeleton，具体 upload/parser/cleanup 行为由后续 change 定义。
- 附件 metadata 和 blob content 通过 gateway boundary 隔离，不让 Web transport 或 context engine 各自实现校验逻辑。
- retry source request 若携带 attachment refs，runtime acceptance 前必须重新调用本模块做 owner、agent、availability 和 safe descriptor 校验；校验结果是 scoped availability outcome，不把 retry policy 下推给附件模块。
- cleanup 是本模块显式 capability；它只能消费权威 `RequestAttachment`、trusted owner scope 和 `BlobRef`，不能自己枚举 orphan，不能替代 request terminal lifecycle。
- attachment execution runtime 把会话内全部 `ACCEPTED`+`AVAILABLE` 附件（当前请求 + 历史轮次）物化到本次 run 的受控 `temp/attachments/{attachmentId}/{fileName}`，供 tool loop / sandbox 按需读取；runtime 通过 `AttachmentStoreGateway.listAttachmentsBySession`（owner + agent + session 作用域）解析会话附件集合，物化目标路径与上下文引擎暴露的 `modelPath` 一致。run terminal 清理整目录，覆盖历史物化文件。不可用附件不物化、不暴露路径。
- `ChatUploadConfigProvider` 是 agent-owned 上传配置的运行时加载 owner。按 `systemConfig.gateway.deploymentMode` 分离实现：`LocalChatUploadConfigProvider` 启动时加载一次 `config/config.json` 并缓存静态值，配置文件不存在时返回 `defaultChatUploadFileConfig()`（markdown-only），不做 fingerprint 检测；`RemoteChatUploadConfigProvider` 每次 `get()` 通过 `statSync` 的 `size + mtimeMs` fingerprint 检测文件变更，文件不存在时返回 `undefined` 且不缓存该结果，文件变更时重新加载并更新缓存。bootstrap 端点和上传路由通过 `provider.get()` 获取当前生效配置，不使用启动时冻结快照。fingerprint 检测复用 `createHotReloadingActiveAssemblyRegistry` 的 `statSync` 模式，不读取文件内容做 hash。
- 统一暂存上传（staged upload）是所有部署模式的唯一上传流程。阶段 1 通过 `POST /api/v1/sessions/:sessionId/files/upload` 以 multipart 流式上传单个完整文件到临时存储，返回 `{ tempRunId, fileName, sizeBytes }`（不含存储坐标）；阶段 2 提交问题时 JSON body 携带 `attachments: [{ tempRunId, fileName }]`，后端最终化每个临时文件为 formal `RequestAttachmentRecord`（含 formal `storageRef`）。`tempRunId` 由前端生成，一个输入会话内多个文件共用同一 `tempRunId`。最终化失败则整个请求失败，不创建部分 attachment record。上传校验管道从便宜到昂贵依次：全局并发上限（4）、文件名正则、扩展名匹配、单文件大小、上传频率限制、per-session 累计配额、per-user 累计配额（200 文件/500MB）、用户 tmp 配额（1024MB）+ 全局 upload-tmp 上限（2048MB）、流式写入本地 temp、文件内容安全校验、`BlobStoreGateway` 存储；首个失败即短路。用户级上传频率限制为 1 小时内 500 次未发送问题的上传，内存 Map + LRU（上限 10000 用户）。临时文件删除通过 `DELETE` endpoint 调 `BlobStoreGateway.deleteBlob`，幂等，同时扣减 tmp 配额和频率计数。
- 文件内容安全校验是独立模块，同时服务 local 和 remote intake，不依赖部署模式。校验项：文件名正则（`^(?=.{1,512}$)[a-zA-Z0-9&\u3010\u3011\uff08\uff09()\s_\-\.\u4e00-\u9fa5+\[\]]+\.\w+$`，前后端双校验）、magic bytes 与扩展名交叉验证（ZIP-based 验 `PK\x03\x04`、PDF 验 `%PDF`、text-based 验 UTF-8 可读）、zip 炸弹防护（ZIP Central Directory 总解压大小 ≤ 512MB，只读 header 不解压，不查压缩比/条目数/嵌套）、zip slip 防护（entry 文件名 path traversal 检测，在 zip 炸弹检查前执行）。上传审计日志记录 userId/sessionId/operation/result/fileName/sizeBytes/reasonCode/timestamp/tempRunId，不含 HOFS 路径或存储引用。流式上传通过 multipart streaming 写入本地 temp（`{systemDataDir}/upload-tmp/{userId}/{tempRunId}/{fileName}`），不加载整个文件到内存，实时 `dataLength` 跟踪大小。本地 temp 文件三层清理：HOFS 上传完成后立即删除（try-catch-finally）、启动扫描清理残留、定期清理 1 小时以上文件。全局上传并发上限 4，超限等待 30 秒后返回 503。不支持 chunked upload。

## 替换边界

否。Attachment runtime 是可信附件处理 owner skeleton。

## 验证关注点

- request acceptance 前必须保留 attachment refs、owner、availability 和 safe descriptor 校验边界。
- upload transport 不得拥有附件可信校验职责。
- context 只能消费安全 refs、descriptor 或 summary。
- retry source attachment revalidation 必须由 runtime/attachment contract 测试覆盖；不可用附件导致 retry acceptance safe rejected。

## Public Exports

`@nextagent/agent-attachment-runtime`
