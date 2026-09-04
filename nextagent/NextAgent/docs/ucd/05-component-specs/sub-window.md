# 组件规范：导航卡片与集成方页面跳转（Navigation Card & Integrator Page Navigation）

> ⚠️ **实现状态标注**：`[已实现-主干]` NextAgent 当前只渲染普通 OPERATOR 按钮，并在用户点击时 `document.dispatchEvent`（`OperatorButtons.tsx` L64）。`[UCD目标]` `OperatorContent.type === "LINK"` 的导航卡片渲染区分尚未实现。**页签管理是集成方职责，不在 NextAgent 范围内**——NextAgent 前端无 CustomEvent 监听器、无页签容器。

## 职责

本规范的 `[UCD目标]` 是在对话气泡内联渲染**导航卡片**，用户点击后 NextAgent 通过 `document.dispatchEvent(new CustomEvent(...))` 通知**集成方**打开目标页面。当前代码只提供普通 OPERATOR 按钮 + 点击 dispatch。页签管理（打开/切换/关闭）、页面嵌入（iframe/component）均由集成方在 NextAgent 页面**外部**实现。

NextAgent 作为整个页面被集成，页签栏在 NextAgent 页面外部。对话始终保留在 NextAgent 嵌入区域内——用户通过集成方页签在对话与目标页面间来回切换，此行为由集成方管理。

典型场景：用户问"打开 OSS 配置"，Agent 执行后对话气泡内显示导航卡片（标题 + 描述 + "打开"入口），用户点击 → NextAgent dispatch CustomEvent → 集成方监听事件 → 在自身页面打开新 tab（NextAgent 嵌入区 + OSS 配置 tab）→ 切换到 OSS 配置 tab 操作 → 切回 NextAgent tab 继续对话。

## 与 Expand Panel 的区别

| 维度 | Expand Panel（`expand-panel.md`） | 导航卡片（本规范） |
|---|---|---|
| 呈现位置 | 右侧展开面板（对话区并排，**NextAgent 内**） | **集成方页面外部页签**（整页切换） |
| 触发方式 | `EXPAND_PANEL` 流式事件**自动打开** | 用户**点击导航卡片**主动打开 |
| 内容来源 | PIU/TEXT/FILE 等富内容画布 | **外部系统页面**（iframe 或组件嵌入） |
| ToolMessageType | 6 种均可 | **OPERATOR**（`type: "LINK"`） |
| 与对话关系 | 对话区与面板**并排共存**（同时可见） | 对话与目标页面**全屏整页切换**（互斥可见，通过 tab 切换） |
| 关闭后 | 回到对话全宽 | 回到 NextAgent tab（对话） |
| 实现状态 | ✅ 已完整实现 | ❌ UCD 设计建议（LINK 渲染未实现） |
| 管理方 | NextAgent | **集成方** |

## 组成

### 导航卡片在内联气泡中

```
┌─ 对话区（NextAgent 嵌入区域）──────────────────────────┐
│                                                        │
│  > 🧑 用户                                            │
│  > 打开 OSS 配置                                       │
│                                                        │
│  > 🤖 助手 · ✅ 已完成                                  │
│  > ## OSS 配置                                         │
│  > 已为你找到 OSS 配置入口。                            │
│                                                        │
│  ┌─ 导航卡片（OPERATOR LINK）──────────────────────┐  │
│  │  📦 OSS 配置                                     │  │
│  │  对象存储服务配置页，可管理 Bucket、权限、生命周期 │  │
│  │                                      [打开 →]    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─ Composer ──────────────────────────────────────┐  │
│  │ [📎] 输入消息…                          [发送]   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 用户点击后——集成方在外部打开 tab（全屏切换）

用户点击导航卡片后，NextAgent dispatch CustomEvent，集成方监听事件并在自身页面打开新 tab。**切到导航 tab 时全屏显示外部页面，NextAgent 对话不可见**——需点击 NextAgent tab 切回才能看到对话。这是整页切换，非并排共存。

```
集成方页面——OSS 配置 tab 激活（全屏）：
┌─ [NextAgent] ─┬─ [OSS 配置 ×] ↑激活 ────────────────────────┐
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  OSS 配置页（iframe 嵌入，全屏）                    │  │
│  │                                                    │  │
│  │  Bucket 列表                                       │  │
│  │  • prod-assets                                     │  │
│  │  • staging-log                                     │  │
│  │  • backup-cold                                     │  │
│  │                                                    │  │
│  │  [新建 Bucket]                                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
  ↑ 切到 OSS 配置 tab 时全屏显示外部页面，NextAgent 对话不可见。
    NextAgent 嵌入区域在背后保留——对话状态不丢失（流式连接保持、草稿、过程面板）。
    点击 [NextAgent] tab 切回即可恢复对话。

集成方页面——切回 NextAgent tab：
┌─ [NextAgent] ↑激活 ─┬─ [OSS 配置 ×] ──────────────────────┐
│                                                          │
│  ┌─ NextAgent 嵌入区域 ──────────────────────────────┐  │
│  │  对话区                                            │  │
│  │  > 🧑 用户                                        │  │
│  │  > 打开 OSS 配置                                   │  │
│  │  > 🤖 助手 · ✅ 已完成                              │  │
│  │  > ┌─ 导航卡片 ──────────────┐                    │  │
│  │  > │ 📦 OSS 配置  [打开 →]    │                    │  │
│  │  > └──────────────────────────┘                    │  │
│  │  ┌─ Composer ──────────────────┐                  │  │
│  │  │ [📎] 输入消息…      [发送]   │                  │  │
│  │  └──────────────────────────────┘                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
  ↑ 切回 NextAgent tab 时对话完整恢复——流式连接、草稿、过程面板状态均保留。
    OSS 配置 tab 在背后保留，可随时切回。
```

> ℹ️ **整页切换 vs 并排共存**：导航 tab 是**全屏整页切换**——切到导航 tab 时看不到 NextAgent 对话，切回 NextAgent tab 时看不到外部页面。这与 Expand Panel 的并排共存（对话区 + 面板同时可见）是关键区别。NextAgent 嵌入区域在背后保留——对话状态不丢失（流式连接保持、草稿保留、过程面板状态保留）。切回 NextAgent tab 即可继续对话。OSS 配置 tab 的 [×] 由集成方提供，关闭后自动激活 NextAgent tab。

## 导航卡片（OPERATOR LINK 渲染）

来源：`OperatorButtons.tsx` 的 `OperatorContent` 接口 + `add-ts-tool-structured-delta/design.md` L64-82。

### 内容结构

OPERATOR ToolMessageType 的 `content` 是 JSON 字符串，反序列化后：

```json
{
  "text": "已为你找到 OSS 配置入口",
  "type": "LINK",
  "align": "left",
  "operators": {
    "openOssConfig": {
      "text": "OSS 配置",
      "title": "对象存储服务配置页",
      "type": "primary",
      "data": "{\"url\":\"/oss/config\",\"title\":\"OSS 配置\",\"embed\":\"iframe\"}"
    }
  }
}
```

- `operators` 的 JSON key（如 `"openOssConfig"`）是 CustomEvent 事件名——集成方通过此 key 监听。
- `data` 是 JSON 字符串，`JSON.parse` 后作为 `CustomEvent.detail` 传递给集成方。

### LINK vs BUTTON 渲染差异

| 维度 | `type: "BUTTON"`（已实现） | `type: "LINK"`（UCD 设计建议） |
|---|---|---|
| 视觉 | 按钮组（横向排列，flex wrap） | **卡片列表**（纵向，每个 operator 一张卡片） |
| 信息密度 | 仅按钮文字 | 标题 + 描述 + "打开"入口 |
| 交互 | 点击 → `CustomEvent` | 点击卡片任意区域 → `CustomEvent` |
| 用途 | 操作按钮（如"确认"/"取消"） | 页面导航入口（如"打开 OSS 配置"） |
| `data` 语义 | 操作参数 | **导航目标**（url/title/embed） |

**BUTTON 渲染样例**（按钮组，横向排列）：

```
┌─ 对话气泡内联 ─────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                               │
│  > 诊断已完成，请选择操作：                          │
│  >                                                   │
│  > ┌─ OPERATOR（BUTTON）─────────────────────────┐  │
│  > │ [导出报告]  [创建工单]  [重新诊断]          │  │
│  > └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**LINK 渲染样例**（导航卡片，纵向排列）：

```
┌─ 对话气泡内联 ─────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                               │
│  > 已为你找到以下配置入口：                          │
│  >                                                   │
│  > ┌─ 导航卡片 ──────────────────────────────────┐  │
│  > │  📦 OSS 配置                                 │  │
│  > │  对象存储服务配置页，可管理 Bucket、权限…    │  │
│  > │                                    [打开 →]  │  │
│  > ├──────────────────────────────────────────────┤  │
│  > │  📦 VPC 配置                                  │  │
│  > │  虚拟私有网络配置页，管理子网、路由表…       │  │
│  > │                                    [打开 →]  │  │
│  > └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 导航卡片视觉 — 3 种样式

导航卡片按 `type` 字段呈现 3 种视觉样式：

**primary（主要操作）**——强调边框/背景，用于推荐入口：
```
┌─ 导航卡片（primary）──────────────────────────────┐
│  ██████████████████████████████████████████████  │  ← primary 背景/边框
│  ██ 📦 OSS 配置                                 ██  │
│ ██  对象存储服务配置页，可管理 Bucket、权限…     ██  │
│  ██                                    [打开 →] ██  │
│  ██████████████████████████████████████████████  │
└──────────────────────────────────────────────────┘
```

**default（默认）**——标准边框，用于普通入口：
```
┌─ 导航卡片（default）──────────────────────────────┐
│  📦 VPC 配置                                       │  ← 默认边框
│  虚拟私有网络配置页，管理子网、路由表…             │
│                                        [打开 →]    │
└──────────────────────────────────────────────────┘
```

**risk（风险操作）**——danger 边框，用于高危入口：
```
┌─ 导航卡片（risk）─────────────────────────────────┐
│  ⚠️ 安全组配置                                     │  ← danger 边框
│  修改安全组规则可能影响网络连通性，请谨慎操作       │
│                                        [打开 →]    │
└──────────────────────────────────────────────────┘
```

- 卡片整体可点击（非仅"打开"按钮区域）。
- 多个 operator 条目 → 多张卡片纵向排列（点击各自通知集成方打开独立 tab）。

### `data` 字段的导航目标

`data` 是 JSON 字符串，`JSON.parse` 后作为 `CustomEvent.detail` 传递给集成方。UCD 建议的导航目标结构：

```json
{
  "url": "/oss/config",
  "title": "OSS 配置",
  "embed": "iframe"
}
```

| 字段 | 说明 |
|---|---|
| `url` | 目标页面 URL（SPA 路由或外部 URL） |
| `title` | 页签标题（集成方用于 tab 标签） |
| `embed` | 嵌入方式建议：`"iframe"`（外部页面）或 `"component"`（SPA 组件） |

> ℹ️ `data` 字段的具体结构由集成方与后端约定。UCD 定义期望结构，实际字段名可调整。安全约束：`data` MUST NOT 包含 credential、token 等敏感信息（来源：`add-ts-tool-structured-delta/design.md` L414）。

## 集成方集成契约

NextAgent 通过 `document.dispatchEvent(new CustomEvent(key, { detail }))` 通知集成方。集成方在自身页面中监听此事件，负责打开/切换/关闭页签、嵌入目标页面。

### 事件协议

| 项目 | 说明 |
|---|---|
| 事件名 | operator 的 JSON key（如 `"openOssConfig"`） |
| 事件载体 | `CustomEvent` on `document` |
| `detail` | `JSON.parse(data)` 的结果，包含导航目标 `{ url, title, embed, ... }` |
| 触发时机 | 用户点击导航卡片（或 ACTION 卡片自动触发——见 `ActionCard.tsx` L27-39） |

### 集成方职责

| 职责 | 说明 |
|---|---|
| 事件监听 | `document.addEventListener(key, handler)`——监听 NextAgent dispatch 的 CustomEvent |
| 页签管理 | 打开/切换/关闭页签，同 URL 去重（不重复开 tab，直接激活已有） |
| 页面嵌入 | iframe（外部页面）或 component（SPA 路由），由 `data.embed` 指定 |
| 对话保持 | 页签切换不影响 NextAgent 对话状态（流式连接、草稿、过程面板均保留） |
| HOME tab | NextAgent 嵌入区域始终保留，不可关闭——是用户的对话主界面 |

> ℹ️ NextAgent **不消费**自身 dispatch 的 CustomEvent——前端无 `addEventListener`，不管理页签。页签是集成方的 UI 状态，不持久化在 conversation 中。

### ActionCard 自动 dispatch

除用户点击 OPERATOR 按钮外，`ActionCard.tsx` L27-39 当前会自动 dispatch CustomEvent（使用 entries 的 JSON key 作为事件名）。组件每次 render 都重新解析出新的 `entries` 对象，effect 又依赖该对象，因此普通 live re-render/remount 也可能重复 dispatch；历史 `CAPABILITY_RESULT` 还可重建为 `TOOL_STRUCTURED_DELTA`，重新打开或重放历史内容同样可能再次触发。该 live/history replay、at-most-once/idempotency 与副作用确认边界尚未冻结，属于 `harden-action-operator-event-dispatch` 的安全 Clarify；不能把当前自动派发直接当成可安全复用的集成承诺。

## 触发流程

1. 用户输入"打开 OSS 配置"。
2. Agent 执行，推送 `TOOL_STRUCTURED_DELTA`（`toolMessageType: "OPERATOR"`，content 中 `type: "LINK"`）。
3. `OperatorButtons` 渲染导航卡片（UCD 建议：`type === "LINK"` 时渲染卡片，非按钮）。
4. 用户点击卡片 → `document.dispatchEvent(new CustomEvent("openOssConfig", { detail: { url, title, embed, ... } }))`。
5. **集成方应用**监听 `openOssConfig` 事件 → 在自身页面打开新 tab（标题 = `data.title`）→ 激活该 tab → 嵌入目标页面（iframe/component）。

> ⚠️ **NextAgent 职责边界**：步骤 1-4 由 NextAgent 实现（步骤 3 的 LINK 卡片渲染为 UCD 设计建议，当前未实现——所有 OPERATOR 条目均渲染为按钮）。步骤 5 由集成方实现，不在 NextAgent 范围内。`document.dispatchEvent` 已在 `OperatorButtons.tsx` L64 实现。

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| OPERATOR 当前渲染 | ✅ OPERATOR 内容实时渲染为按钮组 | ✅ OPERATOR 内容由持久化消息重建，仍渲染为按钮组 |
| `type: "LINK"` 导航卡片 | `[UCD目标]` 当前没有 LINK 专门卡片 | `[UCD目标]` history 也没有 LINK 专门卡片；只能看到既有按钮内容 |
| 点击现有 OPERATOR 按钮 | ✅ dispatch CustomEvent；集成方行为依赖已注册监听器 | ✅ 用户主动点击重建后的按钮仍可 dispatch；集成方行为依赖监听器 |
| 页签状态 | ✅ 集成方管理页签打开/切换/关闭 | ❌ 页签是集成方临时 UI 状态，不持久化——history 不重建页签 |
| NextAgent 对话状态 | ✅ 切到导航 tab 时对话流式连接保持 | ✅ history 重建对话内容 |

来源：OPERATOR 内容是 `TOOL_STRUCTURED_DELTA` 事件，在 history 模式下由持久化消息重建（`transportHints: ["history-load"]`）。当前可重建的是按钮内容，不是尚未实现的 LINK 专门卡片；页签仍是集成方管理的临时状态，不属于 conversation 持久化范围。

## 约束

- **OPERATOR LINK 渲染未实现**：`OperatorContent.type === "LINK"` 字段已声明（`OperatorButtons.tsx` L14、`design.md` L69），但渲染未区分——当前所有 OPERATOR 条目均渲染为按钮。UCD 建议落地时区分 LINK 卡片渲染。
- **NextAgent 职责边界**：当前 NextAgent 负责渲染 OPERATOR 按钮并在用户点击后 `document.dispatchEvent`；`[UCD目标]` LINK 专门卡片如获准，也只能复用这一受控边界。页签管理（打开/切换/关闭/去重）、页面嵌入（iframe/component）、页签栏 UI 均由集成方实现，不在 NextAgent 范围内。
- **ACTION history replay 风险**：ACTION 当前在 mount 时自动 dispatch，history reload/replay 可能导致重复触发；在 catalog/allowlist、history 禁派发或幂等语义、at-most-once identity 与副作用确认完成 contract refinement 前，不得扩大 ACTION 发送面。
- **NextAgent 不消费 CustomEvent**：NextAgent 前端无 `addEventListener` 监听 OPERATOR/ACTION 的 CustomEvent。事件专为集成方设计。
- **页签是集成方临时状态**：页签的打开/切换/关闭不持久化，不属于 conversation。history 模式不重建页签。
- **data 安全**：`data` 字段 MUST NOT 包含 credential、token 等敏感信息（来源：`design.md` L414）。
- **嵌入外部页面的安全**：iframe 嵌入外部页面时，集成方需确保目标页面可信，考虑 `sandbox` 属性限制权限。
- **页签切换不中断对话**：集成方切到导航 tab 时，NextAgent 嵌入区域的对话流式连接保持、草稿保留、过程面板状态保留。切回 NextAgent tab 即恢复对话。此行为由集成方保证。

## UCD 设计建议

- **导航卡片图标**：每个卡片可携带图标（如 📦/🔧/📊），由 `operators[key].type` 或额外字段映射。UCD 设计人员可设计图标映射规则。
- **卡片悬停反馈**：hover 时边框/阴影变化，提示可点击。
- **多卡片场景**：一个 OPERATOR LINK 可含多个 operator 条目（多张导航卡片），UCD 设计人员可设计纵向列表的视觉层次。
- **与 Expand Panel 共存**：Expand Panel 是 NextAgent 内对话区并排面板，导航卡片通知集成方打开外部页签——二者维度不同，可共存（在 NextAgent 嵌入区域中打开 Expand Panel，同时集成方页签栏有外部页面 tab）。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充导航卡片特有行为。

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 导航卡片 hover | hover 时边框/阴影变化，提示可点击，120ms transition |
| 导航卡片 appear | `TOOL_STRUCTURED_DELTA`（OPERATOR LINK）到达时 fade-in 200ms |
| 点击反馈 | 点击时 scale(0.98) + dispatchEvent，100ms transition |
| focus | `focus-visible` outline 2px primary + offset 2px，支持键盘导航 |
| LINK 渲染区分 | inline 链接与卡片式链接的 hover 效果区分（卡片更强调） |

> ⚠️ 以上均为 UCD 设计建议。当前只有普通 OPERATOR 按钮与点击 dispatch；LINK 导航卡片及其 hover/appear/点击反馈尚未实现。
