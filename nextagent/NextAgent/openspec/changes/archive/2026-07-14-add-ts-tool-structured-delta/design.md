# Design: Tool Structured Delta

## 1. 问题概述

CLIP API 返回的结构化工具数据无法在现有 timeline event 通道中干净传递。`CAPABILITY_RESULT_DELTA` 的 `safeResult` 只识别 5 种 builtin shape，CLIP 结果全部 miss；`LLM_CONTENT_DELTA` 只认文本，无法承载 PIU/OPERATOR 等结构化内容。需要一个原生的 `TOOL_STRUCTURED_DELTA` timeline event 类型，从后端投影层贯穿到前端渲染组件。

## 2. 数据模型

### 2.1 CLIP API 三种结构化场景

本变更只对 CLIP 来源（`providerKind=CUSTOM, providerType=clip_server`）的工具结果做结构化识别。非 CLIP 工具的结果完全不走 `TOOL_STRUCTURED_DELTA` 通道。

| 场景 | 数据格式 | 流式/非流式 | 投影处理 |
|------|---------|------------|---------|
| 1 | 纯字符串 `"用户余额为128元"` | 均可 | 发 `TOOL_STRUCTURED_DELTA { toolEventType: "ANSWER", toolMessageType: "TEXT", content: "..." }` |
| 3 | 结构化事件 `{eventType, content, messageType}` | 非流式 | 原样发 `TOOL_STRUCTURED_DELTA` |
| 4 | 结构化事件逐条 | 流式（未来） | 逐条发 `TOOL_STRUCTURED_DELTA`，与场景 3 统一 |

场景 2（普通 JSON）**不走** `TOOL_STRUCTURED_DELTA`，走原有 `CAPABILITY_RESULT_DELTA` 通道。

场景 3 和 4 的数据格式完全一致，区别只是到达时机。投影层和前端不需要区分。

### 2.2 TOOL_STRUCTURED_DELTA Payload 结构

```
RunTimelineEvent {
  type: "TOOL_STRUCTURED_DELTA",
  inlinePayload: {
    capabilityId: string,           // CLIP API capability id
    toolCallId: string,             // 关联 CAPABILITY_STARTED
    toolEventType: "TITLE" | "DETAIL" | "ANSWER" | "SUB_TITLE" | "SUB_DETAIL" | "SUB_CONCLUSION",
    toolMessageType: "PIU" | "DSL" | "ACTION" | "OPERATOR" | "FILE" | "TEXT",
    content: string | JsonObject    // 按 messageType 不同
  }
}
```

### 2.3 六种 messageType 的 content 结构

#### TEXT
```
content: string  // 纯文本或 Markdown
```

#### FILE
```
content: string  // 文件名，如 "report-2026-07.pdf"
```

#### ACTION
```
content: string (JSON)  // 反序列化后:
{
  "<eventKey1>": { "text"?: string, "data"?: string },
  "<eventKey2>": { "text"?: string, "data"?: string },
  ...
}
// eventKey = CustomEvent 事件名
// text = 展示给用户的说明（可选）
// data = 对象字符串，前端 JSON.parse 后作为 CustomEvent detail（可选）
// 收到即自动 dispatchEvent，不需用户交互
```

#### OPERATOR
```
content: string (JSON)  // 反序列化后:
{
  "text": string,                    // 提示文本
  "type": "BUTTON" | "LINK",         // 操作符类型
  "align": "left" | "center" | "right",  // 排列方向
  "operators": {
    "<eventKey1>": {
      "text": string,                // 按钮文字（必填）
      "title"?: string,              // tooltip（可选）
      "type": "primary" | "default" | "risk",  // 按钮样式
      "data": string                 // 对象字符串，JSON.parse 后作为 CustomEvent detail
    },
    "<eventKey2>": { ... }
  }
}
// 用户点击按钮时 dispatchEvent
```

#### DSL
```
content: object  // 直接传给 <DSLEngine data={[content]} />，不做任何处理
```

#### PIU
```
content: {
  piuName: string,       // 远端 PIU 组件名，如 "thoughtChain"
  piuVersion: string,    // 版本号，如 "1.0.0"
  data: string,          // PIU 数据内容
  method: string         // piu.emit 的事件名
}
```

## 3. 后端数据流

### 3.1 投影层识别逻辑（tool-loop.ts）

识别逻辑**只对 CLIP 来源的工具触发**。在 tool-loop 拿到 `result.structuredPayload` 后，检查 descriptor 是否为 CLIP provider（`providerKind === "CUSTOM"` 且 `providerType === "clip_server"`）。非 CLIP 工具完全跳过结构化识别。

```
function tryEmitStructuredDelta(result, descriptor, toolCall, runState, run, context) {
  // 只对 CLIP 来源识别
  if (!isClipProvider(descriptor)) return false;

  const payload = result.structuredPayload;

  // 场景 1: 纯字符串（future capability）
  // 注意：当前 assertCapabilityResultSafe 要求 structuredPayload 为 JsonObject，
  // 纯字符串 payload 会在到达此逻辑前被拒绝。CLIP runner 的 normalizeRunnerResult
  // 始终返回 JsonObject。要完全启用场景 1，需要放宽 assertCapabilityResultSafe
  // 对 CLIP 来源的约束，或在 CLIP runner 层将字符串包装为 JsonObject。
  if (typeof payload === "string") {
    emit TOOL_STRUCTURED_DELTA { toolEventType: "ANSWER", toolMessageType: "TEXT", content: payload };
    return true;
  }

  // 场景 3/4: 结构化事件 {eventType, content, messageType}
  if (isClipStructuredEvent(payload)) {
    emit TOOL_STRUCTURED_DELTA { ...payload };
    return true;
  }

  // 场景 2: 普通 JSON → 不发 TOOL_STRUCTURED_DELTA，走原有通道
  return false;
}
```

校验逻辑：

```
isClipStructuredEvent(payload):
  - payload 是 object
  - payload.eventType ∈ {TITLE, DETAIL, ANSWER, SUB_TITLE, SUB_DETAIL, SUB_CONCLUSION}
  - payload.messageType ∈ {PIU, DSL, ACTION, OPERATOR, FILE, TEXT}
  - payload.content 存在
  - content 不含敏感模式（credential、token 等）
```

### 3.2 与现有 CAPABILITY 生命周期的关系

```
CAPABILITY_STARTED
  │
  ├─ TOOL_STRUCTURED_DELTA (TITLE)      ← 新增（仅 CLIP 结构化事件）
  ├─ TOOL_STRUCTURED_DELTA (DETAIL)     ← 新增
  ├─ TOOL_STRUCTURED_DELTA (ANSWER)     ← 新增
  ├─ TOOL_STRUCTURED_DELTA (SUB_*)      ← 新增
  │
CAPABILITY_RESULT_DELTA                  ← 保留，不变（全量 structuredPayload）
CAPABILITY_COMPLETED                     ← 保留，不变
```

`TOOL_STRUCTURED_DELTA` 插在 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` 之间。`CAPABILITY_RESULT_DELTA` 和 `appendCapabilityResultMessage` 保持不变——模型仍然能看到完整结果。前端用 `toolCallId` 做 correlation。

### 3.3 存储

只存一份。`appendCapabilityResultMessage` 已把完整 `structuredPayload` 存为 `CAPABILITY_RESULT` message，不额外存储 `TOOL_STRUCTURED_DELTA`。

历史重建路径：conversation adapter 读取 `CAPABILITY_RESULT` message 时检查 content 是否匹配 `{eventType, content, messageType}` shape——匹配则重建为 `TOOL_STRUCTURED_DELTA` envelope，不匹配则走原有 `CAPABILITY_RESULT_DELTA` envelope。

### 3.4 stream-envelope 投影

```
if (event.type === "TOOL_STRUCTURED_DELTA") {
  payload.toolEventType = inlinePayload.toolEventType;
  payload.toolMessageType = inlinePayload.toolMessageType;
  payload.content = inlinePayload.content;
  payload.capabilityId = inlinePayload.capabilityId;
  payload.toolCallId = inlinePayload.toolCallId;
  payload.contentType = "PLAIN_TEXT";
  payload.metadata = { accumulated: false };
  return payload;
}
```

`TOOL_STRUCTURED_DELTA` 加入 `streamVisibleTimelineEvents` 列表。

## 4. 前端数据流

### 4.1 事件接收

```
useStreamConnection.ts:
  FRAME_BATCHABLE_EVENT_TYPES 新增 "TOOL_STRUCTURED_DELTA"
```

### 4.2 过程面板处理（processDetails.ts）

`buildProcessTimelineEntries` 新增 `TOOL_STRUCTURED_DELTA` 分支：

```
toolEventType    处理方式
──────────────────────────────────────
TITLE            新建 ProcessTimelineEntry { kind: "tool", icon: 主图标, title: content }
DETAIL           累积到最近一个 TITLE 条目的 detail
SUB_TITLE        新建 ProcessTimelineEntry { kind: "tool", icon: 小圆圈, title: content }
SUB_DETAIL       累积到最近一个 SUB_TITLE 条目的 detail
SUB_CONCLUSION   追加到最近一个 SUB_TITLE 条目的 detail
ANSWER           不创建过程面板条目
```

平铺不缩进，靠顺序就近归属。不需要 parentKey。多条 `TOOL_STRUCTURED_DELTA` 全部追加。

过程面板 detail 当前只支持文本。如果 DETAIL/SUB_DETAIL 的 `toolMessageType` 非 TEXT，content 做 `JSON.stringify` 后存为文本。未来可扩展为结构化 detail。

新增小圆圈图标 `circle-dark.svg` / `circle-light.svg`，放在 `assets/process-icons/`。

`ProcessIconType` 新增 `"circle"`，`resolveProcessIconType` 增加 `toolEventType === "SUB_TITLE"` 判定。

### 4.3 CAPABILITY_STARTED/COMPLETED 与 TOOL_STRUCTURED_DELTA 的关系

当同一 `toolCallId` 有 `TOOL_STRUCTURED_DELTA` 事件时，`CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` **不在过程面板生成条目**。

实现方式：`buildProcessTimelineEntries` 预扫描所有 `TOOL_STRUCTURED_DELTA` 事件的 `toolCallId` 集合，处理 `CAPABILITY_STARTED`/`CAPABILITY_COMPLETED` 时检查 `toolCallId` 是否在该集合中——是则跳过。

```
预扫描:
  structuredToolCallIds = new Set(TOOL_STRUCTURED_DELTA events.map(e => e.toolCallId))

处理 CAPABILITY_STARTED / CAPABILITY_COMPLETED:
  if (structuredToolCallIds.has(correlationId)) continue;
  // 否则走原有逻辑
```

两种情况互斥：有结构化事件就走结构化渲染，没有就走原有 CAPABILITY 渲染。

### 4.4 回答正文处理

回答正文区域按 **sequence 混排** `LLM_CONTENT_DELTA` 和 `TOOL_STRUCTURED_DELTA`（`toolEventType === "ANSWER"`）。

`buildAnswerContent` 改为同时处理两者：按 sequence 排序后逐条渲染，`LLM_CONTENT_DELTA` 合并为文本，`TOOL_STRUCTURED_DELTA` ANSWER 按 `toolMessageType` 分发到渲染组件。

### 4.5 六种 messageType 渲染组件

```
messageType    组件              触发方式     依赖
──────────────────────────────────────────────────────────────
TEXT           MarkdownContent   无          无
FILE           FileCard          无          无
ACTION         ActionCard        自动触发    document.dispatchEvent
OPERATOR       OperatorButtons   用户点击    document.dispatchEvent
DSL            DslRenderer       无          @cloudsop/dsl-engine-web (vite alias stub)
PIU            PiuMessage        宿主触发    window.Prel + PiuContext
```

#### FileCard
```
渲染: 带圆角矩形的小文件卡片
┌──────────────────────────┐
│  📄 {fileName}           │
└──────────────────────────┘
```

#### ActionCard
```
解析 content JSON → 遍历所有 key
每个 key:
  - 如有 text → 展示文本
  - JSON.parse(data) 后 document.dispatchEvent(new CustomEvent(key, { detail: parsedData }))
渲染:
┌────────────────────────────────────┐
│  {text1}                           │
│  {text2}                           │
└────────────────────────────────────┘
```

#### OperatorButtons
```
解析 content JSON → 取 text/type/align/operators
渲染提示文本 + 按钮组（按 align 排列）
按钮 type → primary/default/risk 样式
用户点击 → JSON.parse(data) 后 document.dispatchEvent(new CustomEvent(key, { detail: parsedData }))
渲染:
┌─────────────────────────────────────────┐
│  是否为你打开能耗数据列表页面，请点击确认   │
│  [确认]  [取消]                          │
└─────────────────────────────────────────┘
```

#### DslRenderer
```
import { DSLEngine } from '@cloudsop/dsl-engine-web';
return <DSLEngine data={[content]} />
```

content 原样传入，不做任何处理。

vite alias 配置：
```
resolve: {
  alias: {
    '@cloudsop/dsl-engine-web': isLocalMode
      ? path.resolve(__dirname, 'src/vendor/dsl-engine-stub.ts')
      : '@cloudsop/dsl-engine-web'
  }
}
```

stub 组件：
```
export function DSLEngine() {
  return <div style={{ padding: 12, color: '#999' }}>DSL 内容（本地不可预览）</div>;
}
```

#### PiuMessage
```
const { piu } = useContext(PiuContext);
if (!content.piuName || !piu || !window.Prel) {
  return <div className="piu-message-wrapper">PIU 内容（本地不可预览）</div>;
}
useEffect(() => {
  window.Prel.autoLoad(piuName, piuVersion).then(() => {
    piu.emit(method, { ...content, wrapperId, containerId: wrapperId });
  });
}, [content]);
return <div className="piu-message-wrapper" id={wrapperId} />;
```

### 4.6 PiuContext

```tsx
interface PiuContextValue {
  readonly piu: PIU | null;
  readonly site: HostSiteContext;
}
const PiuContext = createContext<PiuContextValue>({ piu: null, site: mockSite });
```

三个入口各自在 `prel.start` 回调里拿到 `piu + site` 后设置到 PiuContext：

- **local.tsx**: `installMockPrel()` → `window.Prel.start()` → callback(mockPiu, mockSite) → setPiuContext
- **immersive.tsx**: `window.Prel.start()` → callback(piu, site) → setPiuContext
- **registerAIAgentPIU.tsx**: `window.Prel.start()` → callback(piu, site) → store + setPiuContext

### 4.7 Mock Prel（prel-mock.ts）

```typescript
export const mockSite: HostSiteContext = {
  session: { csrfToken: undefined },
  user: { id: "local-user", name: "Local User", ops: null, roles: [] },
  locale: "zh-cn",
  theme: "lightday",
};

export const mockPiu: PIU = {
  id: "mock-piu",
  name: "AIAgentPIU",
  version: "0.0.0-mock",
  config: {},
  deps: [],
  isBrowser: true,
  revs: { "febs.regs": "mock", "febs.server": "mock" },
  attach: () => {},
  emit: (key, _state) => { console.debug(`[PiuMock] emit("${key}") no-op`); },
};

export const mockPrel: Prel = {
  ready: (cb) => cb(),
  autoLoad: () => Promise.resolve(),
  start: (_name, _version, _deps, cb) => { cb(mockPiu, mockSite); },
};

export function installMockPrel(): void {
  if (!window.Prel) { window.Prel = mockPrel; }
}
```

### 4.8 PIU 类型定义更新（prel.ts）

> 注意：`attach` handlers 类型除了规格定义的 `$stateChange` 和 `userAction` 外，
> 还保留了现有宿主框架已使用的 `switchLocale`、`switchTheme`、`loadAIAgent`、
> `displayAIAgent`、`sendQuestionToLui` 等 handler。这些 handler 在 `immersive.tsx`
> 和 `registerAIAgentPIU.tsx` 中已有调用，不属于本次变更范围，不修改其行为。

```typescript
export interface PIU {
  config: any;
  deps: any;
  id: string;
  isBrowser: boolean;
  name: string;
  version: string;
  attach: (
    piu: PIU,
    object: {
      $stateChange?: Dictionary<(newValue: any, oldValue: any) => void>;
      userAction?: {
        febsMemuEvent?: (params: { event: string; type: string }) => void;
        logout?: () => void;
      };
    }
  ) => void;
  emit: (key: string, state: any) => void;
  revs: {
    'febs.regs': string;
    'febs.server': string;
  };
}
```

## 5. 模型可读性

`appendCapabilityResultMessage` 把完整 `structuredPayload` 存为 `CAPABILITY_RESULT` message，模型在下一轮完整可见。本变更不改变这一行为——无论是否发出 `TOOL_STRUCTURED_DELTA`，`appendCapabilityResultMessage` 仍全量存。模型不需要感知 `TOOL_STRUCTURED_DELTA` 的存在。

## 6. 安全约束

- `TOOL_STRUCTURED_DELTA` 的 `content` 按 `messageType` 做安全校验：
  - ACTION/OPERATOR 的 `data` 字段是对象字符串，前端 `JSON.parse` 后作为 `CustomEvent.detail`，不得包含 credential、token 等敏感信息。
  - PIU 的 `piuName`/`piuVersion` 经格式校验（`/^[A-Za-z0-9._-]+$/`）。
  - DSL 的 content 不得包含 `<script>` 或内联事件处理器。
- `TOOL_STRUCTURED_DELTA` 不得泄露 prompt、raw model output、raw provider error、path、credential。
- ACTION 的 `document.dispatchEvent` 在浏览器端执行，不影响后端安全边界。
- PIU 的 `window.Prel.autoLoad` 只在浏览器端执行，本地 mock 模式下 no-op。
- 结构化识别只对 CLIP 来源触发，非 CLIP 工具不受影响。

## 7. 不在本次范围

- CLIP CLI 的流式 stdout 支持（场景 4 的传输层）。
- Sandbox gateway 的流式 stdout 支持。
- Workflow RESTFUL 节点的 `TOOL_STRUCTURED_DELTA` 投影（`WorkflowRuntimeEventProjector` 改动）。
- `@cloudsop/dsl-engine-web` 包的实际引入和远端构建验证。
- PIU 的 `attach` handlers 中 `$stateChange` 和 `userAction` 的实际接线。
- 过程面板 detail 的结构化渲染（当前只支持文本，非 TEXT 类型 JSON.stringify）。
﻿
## 8. Workflow 流式 Level 投影

### 8.1 问题

Workflow 在 remote 模式执行时，需要根据数据 `level` 控制前端渲染效果。主 workflow 使用 `TITLE`/`ANSWER`/`DETAIL`；workflow 作为 tool 被调用时使用 `SUB_TITLE`/`SUB_DETAIL`/`SUB_CONCLUSION`。当前 `WorkflowVisibleDelta` 只携带 `channel` 和 `content`，没有 `level` 字段。projector 只能在 `NODE_COMPLETED` 时统一生成 `TOOL_STRUCTURED_DELTA`，无法在流式输出中按 delta 携带 level。

### 8.2 WorkflowVisibleDelta 增加 level

在 `WorkflowVisibleDelta` 接口和 `WorkflowVisibleDeltaSchema` 中新增可选字段 `level?: ToolEventType`。这是必须的 contract 变更，因为 remote bridge 对每个 SSE 事件执行 `Value.Check(WorkflowVisibleDeltaSchema)` 校验（`additionalProperties: false`）。如果 schema 中没有 level 字段，remote 模式会拒绝携带 `level` 的 delta。

### 8.3 Projector 行为

当 `NODE_OUTPUT_DELTA` 事件携带 `visibleDelta.level` 时：
1. 发送 `TOOL_STRUCTURED_DELTA`，内容为 **fragment**（非累积）
2. 将该 step 标记到 `structuredStreamedSteps`
3. 不发送 `LLM_CONTENT_DELTA`

当 `visibleDelta.level` 缺失时，行为不变：发送 `LLM_CONTENT_DELTA`，内容为累积值。

`NODE_COMPLETED` 时：如果该 step 已在 `structuredStreamedSteps` 中，则抑制 structured delta（去重）。否则照常发送。

### 8.4 Fragment 与累积

`LLM_CONTENT_DELTA` 发送累积内容，因为前端使用 **replace** 语义。 `TOOL_STRUCTURED_DELTA` 在 workflow 流式中发送 **fragment**，因为前端 `buildProcessTimelineEntries` 对 DETAIL/SUB_DETAIL 使用 **append** 语义。如果 projector 发送累积内容，前端会二次累积导致重复。

CLIP 的 `TOOL_STRUCTURED_DELTA` 每次发送完整内容（非 fragment），也能与 append 语义配合，因为每个事件是独立的。

### 8.5 Level Scope

projector 接受 `levelScope: "MAIN" | "SUB"` 参数（默认 `"MAIN"`）。当 delta 或 output 上没有显式 `level` 时，按 scope 自动分配：

| 事件 | MAIN | SUB |
|------|------|-----|
| NODE_STARTED | TITLE | SUB_TITLE |
| NODE_COMPLETED (answer) | ANSWER | SUB_CONCLUSION |
| NODE_COMPLETED (other) | DETAIL | SUB_DETAIL |

显式 `level`（来自 `visibleDelta.level` 或 `output.level`）始终优先于 scope 自动分配。

`default-agent.ts` 以默认 `MAIN` scope 创建 projector。 `tryEmitWorkflowToolDelta` 以 `SUB` scope 创建。

### 8.6 DISPLAY 节点 Level 来源

`executeDisplayContentNode` 从 `outputParser.level` 或 `presentation.outputParser.level` 读取 level，校验是否在 `TOOL_EVENT_TYPES` 中，归一化为大写，并传递到每次 `emitOutputDelta` 调用。

### 8.7 Level 优先级

```
1. visibleDelta.level（流式，per-delta）         <- 最高
2. output.level（NODE_COMPLETED，per-node）
3. outputParser.level（recipe 配置，per-node）
4. levelScope 自动分配（MAIN/SUB）                <- 兜底
```

### 8.8 Answer Level 大小写修复

`workflow-tool-port.ts` 中的 `extractAnswerPreviews` 和 `extractAnswerGeneratedMessages` 之前检查 `level !== "answer"`（仅小写）。修复为 `typeof level !== "string" || level.toUpperCase() !== "ANSWER"`，实现大小写不敏感匹配，与 projector 中 `mapToolEventType` 的 `toUpperCase()` 行为一致。