## Why

AICOConfig icon fields 当前 stable spec 要求 "MUST be base64-encoded strings"。实现 `resolveIconSrc` 已突破该约束,额外支持了 `data:` URI 和 `http(s)://` 绝对 URL,但漏了**相对路径**(以 `/`、`./`、`../` 开头)。

宿主集成时,产品页面有自己托管的静态资源路径(如 `/icnassistantpluginwebsite/images/accuracy.svg`),传相对路径是最自然的方式。当前实现会把相对路径当成裸 base64 拼成 `data:image/png;base64,/path/to/icon.svg`,生成无效 data URI,图标加载必然失败并 fallback 到默认 logo,且无明确错误提示。

本 change 将 icon 字段的合法来源从 "base64 only" 扩展为明确支持四种格式:裸 base64、`data:` URI、绝对 `http(s)://` URL、相对路径。

## What Changes

- `resolveIconSrc`: 在现有 `data:` / `http` 前缀判断之后,新增相对路径判断(以 `/`、`./`、`../` 开头),原样返回由浏览器解析。
- stable spec `aico-config-contract`: 修改 icon 字段定义,从 "MUST be base64-encoded" 扩展为支持多种来源;修改校验规则,明确 icon 只需非空字符串,格式由 `resolveIconSrc` 在渲染时处理。
- `iconUtils.test.ts`: 补充相对路径 test case。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-10.6 前端定制`（canonical spec：`aico-config-contract`）：修改 icon 字段来源类型定义，从 "MUST be base64-encoded strings" 扩展为支持四种格式（裸 base64、`data:` URI、绝对 `http(s)://` URL、相对路径）；修改校验规则，icon 字段只需非空字符串，格式判断在渲染时由 `resolveIconSrc` 处理。涉及的 Requirement：`AICOConfig configuration type and field definitions`、`AICOConfig validation uses hand-written functions`。无系统质量属性变更。

## 影响范围（Impact）

- 代码: `frontend/agent-web/src/aico-config/iconUtils.ts`、`frontend/agent-web/src/aico-config/iconUtils.test.ts`。
- spec: `openspec/specs/aico-config-contract/spec.md`(archive 时合并)。
- 无 API、runtime、gateway、持久化变更;无安全边界影响(相对路径由浏览器在宿主页面 origin 内解析)。
- 向后兼容:原有 base64、data: URI、http URL 传法不受影响。
