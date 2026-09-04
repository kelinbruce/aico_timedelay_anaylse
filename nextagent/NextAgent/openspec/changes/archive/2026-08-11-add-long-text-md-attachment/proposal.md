## 背景与问题（Why）

用户在 Composer 输入框粘贴长文本时，前端没有任何提前反馈，请求直接发到后端才被 400 或 413 拒绝。产品决定在前端做半自动引导：输入超过 2000 字符时提示用户"输入框仅支持最多 2000 字符，请使用 .md 文件作为附件上传大文本"。这要求无论 local 还是远端、无论用户如何配置 `chatUploadFileType`，后端都必须默认支持 `*.md` 和 `*.markdown`。

当前后端 staged upload 路径的 `matchFileExtension` 严格匹配 `chatUploadFileType` 配置。默认是 `["*.md", "*.markdown"]`，但如果用户配置了 `["*.pcap"]`，`.md` 文件会被拒绝返回 `FILE_TYPE_UNSUPPORTED`。这导致"引导用户上传 .md 附件"在非默认配置下不可用。

此外，删除不存在的 session 时后端返回 404 `SESSION_NOT_FOUND`，前端当前将该错误展示给用户，但 session 不存在意味着已被删除，应视为成功静默处理。

## 变更范围（What Changes）

- `agent-attachment-runtime` staged upload 路径新增 markdown 强制接受逻辑：在 `matchFileExtension` 校验前，若文件扩展名为 `.md` 或 `.markdown`，始终通过类型校验，不受 `chatUploadFileType` 配置限制。media type 映射、magic bytes 校验、文件名校验、大小校验保持不变。
- 非 markdown 文件仍严格受 `chatUploadFileType` 配置校验，行为不变。
- `frontend/agent-web` MessageInput 新增长文本检测：当 textarea 内容超过 `LONG_TEXT_THRESHOLD`（2000 字符）时，显示 inline notice 提示用户输入框仅支持最多 2000 字符并引导使用 .md 文件作为附件上传，并自动截断至 2000 字符；字符数接近阈值（90%）时显示字符计数器。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-web-composer-input-limit`：定义前端 Composer 输入框字符限制与长文本引导行为。

### 修改的 Capability

- `ts-attachment-intake`：修改「Attachment intake enforces deterministic limits and type checks」requirement，补充 markdown 强制接受语义。

## 影响范围（Impact）

- 代码：`packages/agent-attachment-runtime`（staged upload 类型校验新增 markdown 强制接受）、`frontend/agent-web`（MessageInput 长文本检测与引导提示）。
- API：无 schema 变更；`POST /api/v1/sessions/:sessionId/files/upload` 行为变更——`.md` / `.markdown` 文件不再被 `chatUploadFileType` 拒绝。
- 测试：`agent-attachment-runtime` markdown 强制接受测试（含用户配置不含 markdown 的负例、magic bytes 仍生效的负例）、agent-web 长文本检测与引导提示测试。
- 配置/运维：无新增配置；`chatUploadFileType` 配置语义变更——markdown 成为系统强制接受类型。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-attachment-intake/spec.md`：修改「Attachment intake enforces deterministic limits and type checks」requirement，补充 markdown 强制接受语义。
- `openspec/specs/agent-web-composer-input-limit/spec.md`：新增 capability spec。

长期背景：
- `openspec/overview.md`：补充 markdown 强制接受和前端输入限制引导一句。

设计视图：
- 无（attachment intake 架构和模块职责不变）。

验证入口：
- `npm test -- ...agent-attachment-runtime` markdown 强制接受测试、`npm run test:contract`、`frontend/agent-web` 相关 `npm test` 与 `npm run build`。
