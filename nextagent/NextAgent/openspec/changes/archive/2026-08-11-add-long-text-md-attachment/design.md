## 背景和现状（Context）

后端 staged upload 路径（`packages/agent-attachment-runtime/src/staged-upload-runtime.ts` 的 `uploadToTemp`）的文件类型校验链为：

1. `validateFileName` — 文件名正则校验
2. `matchFileExtension(fileName, config.chatUploadFileType)` — 扩展名匹配配置
3. `attachmentMediaTypeForExtension` — media type 映射存在性校验
4. `validateFileContent` — magic bytes、zip slip、zip bomb 校验
5. 大小、频率、配额校验

第 2 步严格匹配 `chatUploadFileType` 配置。配置来自 agent 包的 `config.json`，默认 `["*.md", "*.markdown"]`。若用户配置 `["*.pcap"]`，`.md` 文件在第 2 步即被拒绝返回 `FILE_TYPE_UNSUPPORTED`。

前端 Composer 输入框（`MessageInput.tsx`）的 textarea 没有 `maxLength` 或字符计数器。用户粘贴超长文本时前端不做任何预检。后端 `WEB_INPUT_TEXT_MAX_LENGTH`（32768）的 AJV 校验和 16 MiB body limit 都发生在请求到达后端之后，用户没有提前反馈。


约束：

- AGENTS.md 规格优先：attachment intake 行为变化和前端新增 web 行为必须先有 OpenSpec change。
- 同形同策：markdown 强制接受是对既有 `matchFileExtension` 校验的受控例外，必须在 spec 中文档化。
- 安全：强制接受仅放宽扩展名校验，不绕过 magic bytes、文件名、大小等其他安全检查。
- 前端边界：输入限制提示是 `frontend/agent-web` 的组件交互和本地 view state，不涉及 request lifecycle 或 persistence。

相关方：`agent-attachment-runtime`（类型校验）、`frontend/agent-web`（输入限制提示）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 后端 staged upload 路径始终接受 `.md` / `.markdown` 文件，不受 `chatUploadFileType` 配置限制。
- 非 markdown 文件仍严格受 `chatUploadFileType` 校验，行为不变。
- 前端 MessageInput 当 textarea 内容超过 2000 字符时显示 inline notice 提示用户输入框仅支持最多 2000 字符并引导使用 .md 文件作为附件上传；超过阈值时自动截断至 2000 字符并显示提示引导使用 .md 附件上传，不禁用发送按钮。
- 字符数接近阈值（90%）时显示字符计数器。

**非目标：**

- 不修改 `chatUploadFileType` 配置加载逻辑或默认值。
- 不修改 media type 映射、magic bytes 校验、文件名、大小校验。
- 不自动将长文本转为 .md 附件文件（仅提示引导，用户自行操作）。
- 不修改 `WEB_INPUT_TEXT_MAX_LENGTH`（32768）或 Fastify body limit（16 MiB）。

## 设计决策（Decisions）

### D1：Markdown 强制接受策略

在 `staged-upload-runtime.ts` 的 `uploadToTemp` 校验链中，在 `matchFileExtension` 校验前新增判断：若文件扩展名为 `.md` 或 `.markdown`，跳过 `matchFileExtension` 校验，直接进入后续 media type 映射和 magic bytes 校验。

```typescript
const ext = extractExtension(fileName).toLowerCase();
const isMarkdown = ext === ".md" || ext === ".markdown";
if (!isMarkdown && !matchFileExtension(fileName, config.chatUploadFileType)) {
  throw this.toUploadError("FILE_TYPE_UNSUPPORTED", "File type is not in the allowed list.");
}
```

media type 映射（`attachmentMediaTypeForExtension`）已覆盖 `.md` / `.markdown` -> `MARKDOWN`，无需修改。magic bytes 校验已覆盖 `.md` -> text 可读性检查，无需修改。

- 放弃「在 `chatUploadFileType` 配置加载时强制注入 markdown」：配置加载在 agent package 层面，注入逻辑分散且难以验证；在 staged upload 校验链集中处理更清晰。
- 放弃「新增配置项控制是否强制接受 markdown」：markdown 是系统内置解析能力，不需要配置开关。

### D2：前端长文本截断与提示策略

阈值 `LONG_TEXT_THRESHOLD = 2000` 字符。中英文都算 1 个字符（JavaScript `string.length` 以 UTF-16 code unit 计数，中文和英文各算 1）。不区分粘贴和手动输入：在 `handleTextChange` 中检测 `text.length`。

当 `text.length > LONG_TEXT_THRESHOLD` 时，自动截断至 2000 字符（`text.slice(0, LONG_TEXT_THRESHOLD)`），并显示 inline notice（warning 类型），提示用户内容已截断并引导使用 .md 文件作为附件上传大文本。截断后 textarea 内容为 2000 字符，发送按钮保持可用，用户可以正常发送。

截断提示通过既有 `localNotice` 机制展示：截断时设置 `localNotice`，用户继续编辑时 `handleTextChange` 开头既有逻辑清除 `localNotice`；若编辑后内容仍超阈值则再次截断并重新设置提示。

当 `text.length > LONG_TEXT_THRESHOLD * 0.9`（即 1800 字符）且未超限时，显示字符计数器 `{count} / {threshold}`，使用 warning 色样式。

选择 2000 字符的依据：
- 电信运维场景中，日志片段、告警信息、配置文本通常在数百到数千字符；2000 字符覆盖大多数正常输入，同时给超长内容提供提前引导。
- 远低于后端 `WEB_INPUT_TEXT_MAX_LENGTH`（32768），留出充足缓冲。

- 放弃「自动转换为 .md 附件」：自动转换涉及文件命名、textarea 清空、上传失败回滚等复杂状态管理，问题较多；半自动提示让用户自行决定更稳妥。
- 放弃「禁用发送按钮」：截断后内容合法（2000 字符），用户可以直接发送截断后的文本；禁用发送会阻碍用户在截断后立即提交的合理操作。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 强制接受不绕过 magic bytes、文件名、大小校验；仅放宽 `matchFileExtension` 一项 | `agent-attachment-runtime` 强制接受测试含 magic bytes 负例 |
| 性能/容量 | 判定为 O(1) 扩展名比较和字符长度比较，无新增查询 | 既有上传测试不退化 |
| 可靠性/恢复 | 无状态变更，无恢复需求 | 既有测试 |
| 可维护性 | 阈值常量集中定义；复用既有 inline notice 和 sessionStore 路径 | code review |
| 可测试性 | 可用确定的输入文本和非 markdown 配置构造场景 | agent-web 组件测试 + agent-attachment-runtime 测试 |
| 审计/可追溯性 | 无新增信号需求 | 既有 observability 路径 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `.md` / `.markdown` 在非默认 `chatUploadFileType` 配置下被接受 | T1 | `npm test -- ...agent-attachment-runtime` markdown 强制接受测试 |
| 非 markdown 文件仍受 `chatUploadFileType` 校验 | T1 | `agent-attachment-runtime` 非 markdown 文件拒绝测试 |
| markdown 文件仍受 magic bytes 校验 | T1 | `agent-attachment-runtime` 伪造 .md magic bytes 负例测试 |
| 文本超过 2000 字符时显示提示引导使用 .md 附件 | T2 | `frontend/agent-web` MessageInput 长文本测试 |
| 字符数接近阈值时显示计数器 | T2 | agent-web 组件测试 |
| 文本未超阈值时不显示提示 | T2 | agent-web 负例测试 |

## 风险与取舍（Risks / Trade-offs）

- [markdown 强制接受可能被用户视为安全风险] -> markdown 文件仍受 magic bytes、文件名、大小校验；强制接受仅针对扩展名校验一项，不绕过其他安全检查。


## 迁移计划（Migration）

无数据迁移。markdown 强制接受为运行时判定，对存量配置自然生效。前端长文本检测为纯客户端行为，无持久化变化。发布无需特殊步骤；回滚即还原代码。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-attachment-intake/spec.md`：合并 markdown 强制接受语义到「Attachment intake enforces deterministic limits and type checks」requirement。
- `openspec/specs/agent-web-composer-input-limit/spec.md`：新增 capability spec。
- `openspec/overview.md`：稳定基线描述补充 markdown 强制接受和前端输入限制引导一句。

## 待确认问题

无。
