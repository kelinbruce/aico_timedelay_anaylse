## 背景与问题（Why）

现有 `TOOL_STRUCTURED_DELTA` 结构化展示只对两类结果生效：

1. CLIP custom capability provider（`providerType === "clip_server"`）：`structuredPayload` 顶层直接是 `{eventType, messageType, content}` 三元组，`isClipStructuredEvent` 校验通过即 emit。
2. Bash tool 调用 `clipc` 命令：stdout 返回信封 `{"status":"ok","data":{"raw":"{eventType,...}"}}`，`extractClipcStructuredEvent` 两层 JSON.parse 提取三元组后 emit。

线上 clipc 已统一走 Bash 调用，CLIP provider 路径不再使用。同时新增了 `ApiCall` 工具（非 agentic Skill 执行路径），通过 HTTP 调用后端 API 返回结果。电信运维场景中，Bash 调 `curl`、ApiCall 调 HTTP API 返回的结构与 clipc 信封或直接三元组形状一致时，同样需要 emit `TOOL_STRUCTURED_DELTA` 驱动前端结构化展示。

本次 change 将结构识别范围从 CLIP + Bash-clipc 扩展为：**Bash（覆盖 clipc、curl 及任何输出结构化 JSON 的命令）+ ApiCall（覆盖非流式 response body 和流式 SSE chunk）**，识别形状统一支持**直接三元组**和**信封包裹**两种，流式场景逐块检测。

## 变更范围（What Changes）

1. **白名单扩展**：`tryEmitToolStructuredDelta` 的识别白名单从 CLIP provider + Bash 扩展为 CLIP provider（legacy, 线上不走但保留代码不动）+ Bash + ApiCall。白名单外工具（Read、Write、Skill、Agent 等）仍不尝试，走默认 `CAPABILITY_RESULT_DELTA`。
2. **共享形状检测**：将现有 `isClipStructuredEvent`（直接三元组）和 `extractClipcStructuredEvent`（信封解包）的检测逻辑统一为两步共享流程：先取候选 JSON，再依次尝试直接形状和信封形状。信封解包抽为共享纯函数 `unwrapStructuredEnvelope`。
3. **Bash 直接形状支持**：现有 Bash 分支只检测信封。新增：stdout 为直接 `{eventType, messageType, content}` 三元组 JSON 时也匹配。覆盖 curl 等命令直接输出结构化事件的场景。
4. **ApiCall 非流式检测**：ApiCall 工具返回终态 `structuredPayload`（HTTP response JSON body）作为候选，走共享形状检测。
5. **ApiCall 流式逐块检测**：ApiCall 流式执行期间，每个 SSE `chunk.data` 经 `JSON.parse` 后作为候选，走共享形状检测。匹配则逐块 emit `TOOL_STRUCTURED_DELTA`；不匹配则走现有 `CAPABILITY_RESULT_DELTA`。流式终态 `structuredPayload` 为空对象，不重复检测。

## 待确认的关键决策点

### D1. 识别范围：白名单而非通用【已确认 2026-07-31，定稿】

采用白名单（Bash + ApiCall），不做通用判断。理由：`TOOL_STRUCTURED_DELTA` 直接驱动前端渲染，误判代价是 UI 乱。白名单边界明确，每新增一个工具需显式加入。CLIP provider 路径保留代码不动（option A），不清理整套 CLIP 代码，但 spec 标注为 legacy。

### D2. 识别形状：直接 + 信封两种都要【已确认 2026-07-31，定稿】

两种形状共享同一套枚举校验（`clipStructuredEventTypes` / `clipStructuredMessageTypes`）和安全检查（`hasSensitiveStructuredContent`）：

- **直接形状**：候选 JSON 顶层就是 `{eventType, messageType, content}` 三元组。已有 `isClipStructuredEvent` 覆盖。
- **信封形状**：候选 JSON 是 `{"status":"ok","data":{"raw":"<json字符串>"}}`，`raw` 字段是内层三元组的 JSON 字符串。新增共享函数 `unwrapStructuredEnvelope` 解包后复用 `isClipStructuredEvent`。

信封形状固定为这一种。如后续后端返回其他信封形状，另开 change 扩展。

### D3. 候选提取按结果形状而非工具身份【已确认 2026-07-31，定稿】

不按工具身份分类，按候选 JSON 在 `structuredPayload` 中的位置分类：

- **Bash**：候选在 `structuredPayload.stdout` 里（string），需 `JSON.parse` 取出。覆盖 clipc、curl 及任何命令。
- **ApiCall 非流式**：候选就是 `structuredPayload` 本身（object）。覆盖 HTTP response body 直接是结构化事件或信封的场景。
- **ApiCall 流式**：候选在 `chunk.data` 里（string），需 `JSON.parse` 取出。覆盖 SSE 每帧返回完整结构化事件的场景。
- **CLIP provider**：候选就是 `structuredPayload` 本身（object）。保留现有行为。

### D4. 流式逐块检测【已确认 2026-07-31，定稿】

ApiCall 流式场景：每个 SSE `chunk.data` 独立尝试形状检测。匹配则 emit `TOOL_STRUCTURED_DELTA`，不匹配或 `JSON.parse` 失败则走现有 `CAPABILITY_RESULT_DELTA`。不做跨帧累积拼接——前提是每个 SSE 帧自包含完整结构化事件（已确认线上 API 流式场景满足此前提）。流式终态 `structuredPayload` 为空对象 `{}`，`tryEmitToolStructuredDelta` 不重复检测。

CLIP provider 流式走 `createClipStreamDeltaEmitter`，现有行为不变。Bash 无流式。

### D5. CLIP provider 处理：保留不动【已确认 2026-07-31，定稿】

CLIP provider 分支代码和 `projectClipCapabilityResultSafeFields` 保留不动，不清理整套 CLIP 代码。spec 中将 CLIP provider 标注为 legacy path（线上不走但保留）。CLIP 代码的清理是独立决策，不在本 change 范围内。

## Capability 影响（Capabilities）

### 修改的 Capability

- `tool-structured-delta`：识别白名单扩展到 Bash + ApiCall；新增直接+信封两种共享形状检测；新增 ApiCall 流式逐块检测；CLIP provider 标注 legacy。

### 新增 Capability

无。

## 影响范围（Impact）

- `packages/agent-core/src/tools/tool-loop.ts`：`tryEmitToolStructuredDelta` 重构为白名单 + 候选提取 + 共享形状检测；新增 `unwrapStructuredEnvelope` 共享函数；`emitResultDelta` 回调中新增 ApiCall 流式逐块检测。
- `packages/agent-core/tests/`：扩展结构化 delta emission 测试，覆盖 Bash 直接形状、ApiCall 非流式直接/信封、ApiCall 流式逐块匹配/不匹配、白名单外工具不触发等场景。
- `openspec/specs/tool-structured-delta/spec.md`：归档前更新 baseline。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/tool-structured-delta/spec.md`：将 "Non-CLIP results never emit" 约束更新为白名单（Bash + ApiCall）；新增信封形状解包、ApiCall 非流式/流式检测 requirement；CLIP provider 标注 legacy。
- 不改 `structured-delta-safety.ts`、持久化策略、前端。

## Non-Goals

- 不清理 CLIP provider 整套代码（sandbox-clip-command-runner、clip-tool-source 等）。
- 不改 `structured-delta-safety.ts`。
- 不改持久化策略（`runTimelineEventPersistencePolicy`）。
- 不改前端。
- 不做历史回放（Bash 的 `CAPABILITY_RESULT` payload 顶层是 `{exitCode, stdout, ...}`，三元组藏在 stdout 字符串里，前端 `tryResolveStructuredEvent` 无法检测；ApiCall 流式终态 payload 为空。历史回放后续单独处理）。
- 不处理跨帧累积拼接的流式场景（前提是每帧自包含）。
