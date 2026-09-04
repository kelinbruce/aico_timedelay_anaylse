## 背景与问题（Why）

stable spec `agent-web-structured-message-rendering` 的 “PIU Message Rendering” 和 “MessageType Renderer Components” 都规定 `PiuMessage` 调用 `piu.emit(method, { ...content, wrapperId, containerId })`——展开整个 content（含 `piuName`/`piuVersion`/`method`/`data`）。当前实现是 `piu.emit(method, { ...content.data, ...hostFields })`——只展开 `content.data`。这是 implementation-vs-spec gap：路由元信息（`piuName`/`piuVersion`/`method`）被丢弃，PIU handler 无法从 payload 获取 method 等上下文。

但存在一个既有 PIU `dte-bi-agent`，其 handler 契约要求只接收扁平化的业务字段（`content.data` 展开），不接受路由元信息。直接回归 spec 的 `...content` 会破坏该 PIU。

## 变更范围（What Changes）

- 修正 `PiuMessage` 默认 payload 形状回归 spec：`{ ...content, ...hostFields }`（whole）。
- 新增受控例外：对 `piuName` 在前端 view 层受控白名单 `SPREAD_DATA_PIU_NAMES` 中的 PIU（当前仅 `dte-bi-agent`），payload 改为 `{ ...content.data, ...hostFields }`（spread-data）。
- 受控白名单是编译期常量，不按 `method` 分支，不接受运行时输入。
- 后端 structuredPayload 不改动。

## Capability 影响（Capabilities）

### 修改的 Capability

- `agent-web-structured-message-rendering`：MODIFIED “PIU Message Rendering” requirement，钉死默认 whole payload 形状，新增 spread-data 受控例外规则与场景。

### 新增 Capability

（none）

## 影响范围（Impact）

- `frontend/agent-web/src/features/chat/components/structured/PiuMessage.tsx`：revert emit 默认为 `...content`；新增 `SPREAD_DATA_PIU_NAMES` 白名单和 `buildPiuEmitPayload` 纯函数。
- `frontend/agent-web/src/features/chat/components/structured/AnswerSegments.test.tsx`：新增 whole payload 默认、spread-data 白名单、hostFields 覆盖优先的契约断言。
- 不改 `PiuRenderer.tsx`（AICOConfig 注入路径，spec 独立，payload 形状 `{ ...data, theme, containerId }` 不受影响）。
- 不改后端 structuredPayload 契约。
- 不改 `prel.ts` 的 `PIU.emit` 签名。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-structured-message-rendering/spec.md`：归档时同步 MODIFIED “PIU Message Rendering” requirement（含受控例外规则与场景）。
- 其余长期文档：无（纯前端 view 层 payload 构造，无跨模块或架构影响）。
