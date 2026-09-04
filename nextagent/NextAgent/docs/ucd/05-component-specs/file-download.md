# 组件规范：文件下载（File Download）

> ⚠️ **实现状态标注**：本组件为 UCD 设计建议。当前 `FileCard.tsx` 是纯展示组件（仅接收 `fileName` 字符串，无下载能力），FILE ToolMessageType 的 `content` 定义为纯文件名字符串（`add-ts-tool-structured-delta/design.md` L46-48）。前端无下载基础设施（零 `blob`/`createObjectURL`/`saveAs` 匹配）。本规范定义期望行为，待落地实现。

## 职责

Agent 在对话气泡内输出**可下载文件**（模板、报告、导出数据等），用户点击下载按钮触发浏览器原生下载。文件由 Agent 生成，后端提供下载 URL。

典型场景：用户问"开启节能自治"，Agent 响应"你希望在哪些区域开启节能自治?"（pending question）同时输出文件下载卡片"区域列表模板.csv"，用户下载模板、填写后上传。

## 与 FILE ToolMessageType 的关系

来源：`FileCard.tsx`、`AnswerSegments.tsx` L21-36、`add-ts-tool-structured-delta/design.md` L46-48。

### 当前状态（纯展示）

FILE ToolMessageType 的 `content` 是**纯文件名字符串**：

```json
{
  "toolEventType": "ANSWER",
  "toolMessageType": "FILE",
  "content": "区域列表模板.csv"
}
```

`FileCard` 仅渲染文件图标 + 文件名，无下载入口、无 URL、无交互。

### UCD 建议扩展（content 为 object）

将 `content` 从 string 扩展为 object，携带下载信息：

```json
{
  "toolEventType": "ANSWER",
  "toolMessageType": "FILE",
  "content": {
    "fileName": "区域列表模板.csv",
    "downloadUrl": "/api/v1/files/templates/region-list-template.csv",
    "mimeType": "text/csv",
    "fileSize": 1024
  }
}
```

**向后兼容**：`content` 为 string 时保持当前纯展示行为；`content` 为 object 时渲染下载卡片。`AnswerSegments.tsx` 的 FILE 分支需检测 content 类型分派渲染。

### content 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileName` | string | ✅ | 文件名（显示 + 下载默认名） |
| `downloadUrl` | string | ✅ | 下载 URL（后端提供的可访问地址） |
| `mimeType` | string | ❌ | MIME 类型（如 `text/csv`、`application/pdf`），用于图标映射 |
| `fileSize` | number | ❌ | 文件大小（字节），用于显示 |

## 文件下载卡片视觉

```
┌─ 文件下载卡片 ────────────────────────────────────┐
│  📄 区域列表模板.csv                    1.0 KB    │
│  CSV 模板文件，包含区域名称、区域编码列              │
│                                        [⬇ 下载]   │
└────────────────────────────────────────────────────┘
```

- **文件图标**：根据 `mimeType` 映射（CSV→📊、PDF→📄、Excel→📗，UCD 设计人员决定映射规则）
- **文件名**：`fileName`，点击也可下载
- **文件大小**：`fileSize` 格式化显示（≥1MB → `X.X MB`，≥1KB → `X KB`，否则 `X B`）
- **描述**（可选）：卡片可包含一行描述文本（由 content 额外字段或上下文提供）
- **下载按钮**：[⬇ 下载] 按钮，点击触发下载
- **整体可点击**：卡片任意区域点击均触发下载（非仅按钮）

### 5 种 mimeType 图标映射样例

**CSV（📊）**——模板/数据导出：
```
┌─ 文件下载卡片 ────────────────────────────────────┐
│  📊 区域列表模板.csv                    1.0 KB    │
│                                        [⬇ 下载]   │
└────────────────────────────────────────────────────┘
```

**PDF（📄）**——诊断报告：
```
┌─ 文件下载卡片 ────────────────────────────────────┐
│  📄 网络诊断报告.pdf                    2.3 MB    │
│                                        [⬇ 下载]   │
└────────────────────────────────────────────────────┘
```

**Excel（📗）**——批量数据导出：
```
┌─ 文件下载卡片 ────────────────────────────────────┐
│  📗 告警汇总.xlsx                       512 KB    │
│                                        [⬇ 下载]   │
└────────────────────────────────────────────────────┘
```

**Word（📘）**——文档模板：
```
┌─ 文件下载卡片 ────────────────────────────────────┐
│  📘 变更审批模板.docx                  88 KB     │
│                                        [⬇ 下载]   │
└────────────────────────────────────────────────────┘
```

**JSON（📋）**——配置导出：
```
┌─ 文件下载卡片 ────────────────────────────────────┐
│  📋 网络拓扑导出.json                  4.2 KB     │
│                                        [⬇ 下载]   │
└────────────────────────────────────────────────────┘
```

## 下载机制

UCD 建议（待落地）：

| 方式 | 说明 | 适用场景 |
|---|---|---|
| **`<a>` 标签** | `<a href={downloadUrl} download={fileName}>`，浏览器原生下载 | downloadUrl 是可直接访问的 URL（同域或带签名的 CDN URL） |
| **Blob + createObjectURL** | `fetch(downloadUrl)` → `Blob` → `URL.createObjectURL` → `<a download>` | 需要鉴权 header 或内容转换的场景 |

默认使用 `<a>` 标签方式（最简单）。若 downloadUrl 需要鉴权，使用 Blob 方式。

## 文件来源

文件由 **Agent 生成**，后端提供 downloadUrl：

| 场景 | 文件类型 | 生成方式 |
|---|---|---|
| 模板下载 | CSV/Excel 模板 | Agent 预置模板，后端提供静态 URL |
| 诊断报告 | PDF/Markdown 报告 | Agent 执行能力后生成，后端临时存储 |
| 数据导出 | CSV/JSON 数据 | Agent 查询数据后导出，后端临时存储 |

### 文件来源场景样例

**模板下载场景**（Agent 输出预置模板供用户填写）：
```
┌─ 对话气泡 ──────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                           │
│  > 你希望在哪些区域开启节能自治？                 │
│  > 请下载区域列表模板，填写后上传。               │
│  >                                               │
│  > ┌─ 文件下载卡片 ──────────────────────────┐  │
│  > │ 📊 区域列表模板.csv              1.0 KB  │  │
│  > │                         [⬇ 下载]       │  │
│  > └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**诊断报告场景**（Agent 执行能力后生成报告）：
```
┌─ 对话气泡 ──────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                           │
│  > ## 网络诊断完成                               │
│  > 诊断结论：Edge-RTR-02 CPU 持续过高，建议…    │
│  > 完整诊断报告已生成，可下载查看。               │
│  >                                               │
│  > ┌─ 文件下载卡片 ──────────────────────────┐  │
│  > │ 📄 网络诊断报告.pdf             2.3 MB  │  │
│  > │                         [⬇ 下载]       │  │
│  > └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**数据导出场景**（Agent 查询数据后导出）：
```
┌─ 对话气泡 ──────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                           │
│  > 查询到过去 7 天共 42 条告警。                  │
│  > 告警数据已导出，可下载分析。                   │
│  >                                               │
│  > ┌─ 文件下载卡片 ──────────────────────────┐  │
│  > │ 📋 告警数据.json                4.2 KB  │  │
│  > │                         [⬇ 下载]       │  │
│  > └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## 触发方式

与现有 FILE ToolMessageType 一致：

1. Agent 执行能力，推送 `TOOL_STRUCTURED_DELTA`（`toolEventType: "ANSWER"`，`toolMessageType: "FILE"`，content 为 object）
2. `AnswerSegments` 检测 content 为 object → 渲染文件下载卡片（而非纯展示 FileCard）
3. 用户点击卡片或 [⬇ 下载] → 浏览器原生下载

> ℹ️ 文件下载卡片**内联在对话气泡中**，不在 Expand Panel 中呈现。与 Expand Panel 的 PIU 富内容不同——文件下载是浏览器原生行为，不涉及 LUI 内画布渲染。

## 与导航卡片（sub-window.md）的区别

| 维度 | 文件下载卡片（本规范） | 导航卡片（`sub-window.md`） |
|---|---|---|
| ToolMessageType | **FILE**（content 为 object） | **OPERATOR**（`type: "LINK"`） |
| 交互行为 | 浏览器原生下载文件 | dispatch CustomEvent 通知集成方打开外部页签 |
| 目标 | 本地文件 | 系统页面 |
| 依赖 | downloadUrl（后端提供） | CustomEvent + 集成方监听器 |
| 实现状态 | ❌ UCD 设计建议 | ❌ UCD 设计建议 |

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 下载卡片渲染 | ✅ FILE content 实时渲染 | ✅ content 由持久化消息重建，卡片可见 |
| 下载行为 | ✅ downloadUrl 可用 | ⚠️ downloadUrl 依赖后端文件是否仍存在（临时文件可能过期） |
| 文件可用性 | ✅ 刚生成，可下载 | ⚠️ 历史对话中的临时文件可能已清理（`openspec/designs/architecture/attachment-lifecycle.md` cleanup 机制） |

来源：FILE content 是 `TOOL_STRUCTURED_DELTA` 事件，在 history 模式下由持久化消息重建（`conversationAdapter.ts` L83-99 `tryResolveStructuredEvent`）。卡片本身可见，但 downloadUrl 指向的临时文件可能已过期。

## 约束

- **FILE content 扩展**：当前 content 为 string（文件名），UCD 建议扩展为 object `{ fileName, downloadUrl, mimeType?, fileSize? }`。向后兼容——string 时纯展示，object 时下载卡片。
- **无下载基础设施**：前端零 `blob`/`createObjectURL`/`saveAs` 实现。落地需新建下载逻辑。
- **downloadUrl 安全**：MUST NOT 在 URL 中嵌入 credential/token。需要鉴权的下载使用短期签名 URL 或鉴权 header（Blob 方式）。
- **可信域名校验**：downloadUrl MUST 指向可信域名，防止开放重定向。UCD 建议宿主应用维护可信域名白名单。
- **文件大小限制**：UCD 建议限制下载文件大小（如 50MB），超大文件提示用户通过其他方式获取。
- **临时文件过期**：Agent 生成的临时文件（报告/导出）有生命周期，history 模式下 downloadUrl 可能失效。UCD 建议 history 中下载失效时显示"文件已过期"提示。
- **内联在气泡**：文件下载卡片在对话气泡内联呈现，不在 Expand Panel 中。
- **与 sub-window 导航卡片不同**：文件下载是浏览器原生下载，导航卡片是通知集成方打开外部页签。

## UCD 设计建议

- **文件类型图标**：根据 `mimeType` 映射图标（CSV📊/PDF📄/Excel📗/Word📘/JSON📋），UCD 设计人员可设计图标集。
- **下载状态反馈**：点击下载后显示短暂"下载中"指示，下载完成恢复。浏览器原生下载进度条不在 LUI 内控制。
- **已下载标记**：已下载的文件卡片可显示"已下载"标记（session 内状态，不持久化）。
- **文件预览**：对于文本类文件（CSV/Markdown/JSON），可考虑在下载卡片旁加"预览"入口（在 Expand Panel 中展示内容）——但当前未设计，UCD 设计人员可扩展。
- **多文件场景**：一个 turn 中可输出多个 FILE 事件（多个下载卡片），UCD 设计人员可设计纵向列表的视觉层次。
- **文件描述**：卡片可包含一行描述（如"CSV 模板文件，包含区域名称、区域编码列"），帮助用户理解文件用途。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充文件下载卡片特有行为。

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 下载按钮 hover | hover 时边框/阴影变化，120ms transition |
| 下载 loading | 点击下载后显示 spinner，直到浏览器开始下载 |
| 下载成功反馈 | 下载开始后短暂显示"下载已开始"提示 1.5s |
| 下载失败反馈 | downloadUrl 过期或请求失败时显示"文件已过期"错误提示 |
| 卡片 appear | `TOOL_STRUCTURED_DELTA`（FILE）到达时 fade-in 200ms |
| focus | `focus-visible` outline 2px primary + offset 2px，支持键盘下载 |

> ⚠️ 以上均为 UCD 设计建议，当前文件下载卡片为静态渲染，无 hover 动画、无下载 loading、无成功/失败反馈。
