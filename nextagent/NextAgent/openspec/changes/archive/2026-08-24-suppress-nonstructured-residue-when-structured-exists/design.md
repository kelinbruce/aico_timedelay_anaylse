## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.16 识别和投射结构化工具增量` | 修改流式终态 `LLM_CONTENT_DELTA` 抑制条件：从"全部结构化才跳过"改为"存在任意结构化即跳过" | `tool-structured-delta` | `Streaming Terminal LLM_CONTENT_DELTA Suppression 条件变更` |

## Streaming Terminal LLM_CONTENT_DELTA Suppression 条件变更

### 当前实现

`default-agent.ts` 两条 non-agentic ApiCall 路径（pre-round 和 post-tool-call）在 `emitResultDelta` 回调中维护：

- `streamDeltaTotal`：流式 chunk 总数
- `streamDeltaStructured`：被 `tryEmitStructuredDelta` 成功识别的结构化 chunk 数
- `nonStructuredParts: string[]`：非结构化 chunk 的 data

流式结束后的终端抑制条件（两处）：

```js
// 主路径 (L877)
const allStructuredStream = streamDeltaTotal > 0 && streamDeltaTotal === streamDeltaStructured;
if (!allStructuredStream) {
  const terminalLLMContent = streamDeltaTotal > 0 ? nonStructuredParts.join('') : nonAgenticFinalContent;
  await emitEvent({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: terminalLLMContent } });
}

// Pre-round 路径 (L475)
const _allStructuredPre = _streamDeltaTotalPre > 0 && _streamDeltaTotalPre === _streamDeltaStructuredPre;
if (!_allStructuredPre) {
  const _terminalLLMContentPre = _streamDeltaTotalPre > 0 ? _nonStructuredPartsPre.join('') : _finalTerminalContentPre;
  await emitEvent({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: _terminalLLMContentPre } });
}
```

当前条件 `streamDeltaTotal > 0 && streamDeltaTotal === streamDeltaStructured` 的含义是：只有全部 chunk 都是结构化时才跳过终端 `LLM_CONTENT_DELTA`。混合场景下非结构化残留仍会聚合展示。

### 修改方案

将两处条件从"全部结构化才跳过"改为"存在任意结构化即跳过"：

```js
// 主路径
const hasStructuredStream = streamDeltaStructured > 0;
if (!hasStructuredStream) {
  const terminalLLMContent = streamDeltaTotal > 0 ? nonStructuredParts.join('') : nonAgenticFinalContent;
  await emitEvent({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: terminalLLMContent } });
}

// Pre-round 路径
const _hasStructuredPre = _streamDeltaStructuredPre > 0;
if (!_hasStructuredPre) {
  const _terminalLLMContentPre = _streamDeltaTotalPre > 0 ? _nonStructuredPartsPre.join('') : _finalTerminalContentPre;
  await emitEvent({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: _terminalLLMContentPre } });
}
```

行为变化矩阵：

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 全部结构化 | 跳过 `LLM_CONTENT_DELTA` | 跳过 `LLM_CONTENT_DELTA`（不变） |
| 混合（部分结构化 + 部分非结构化） | 发 `LLM_CONTENT_DELTA`，内容为非结构化残留 `.join('')` | **跳过** `LLM_CONTENT_DELTA` |
| 全部非结构化 | 发 `LLM_CONTENT_DELTA`，内容为 `nonStructuredParts.join('')` | 发 `LLM_CONTENT_DELTA`（不变） |
| 无流式 chunk | 发 `LLM_CONTENT_DELTA`，内容为 `nonAgenticFinalContent` | 发 `LLM_CONTENT_DELTA`（不变） |

### 不变的部分

- `nonStructuredParts` / `_nonStructuredPartsPre` 的收集逻辑不变（仍 push 到数组，只是终端不再用它发射）。
- `terminalContent` 保留原值给 `assertTerminalContentReady` 和 terminal commit，不受影响。
- 终端 `CAPABILITY_RESULT_DELTA` 的跳过逻辑不变（`streamDeltaTotal === 0` 时才发）。
- Per-chunk 发射行为不变（每个 chunk 照常发 `TOOL_STRUCTURED_DELTA` 或 `CAPABILITY_RESULT_DELTA`）。
- `flushStructuredDeltaPersistence` 调用不变。
- Model-driven tool-loop 路径不受影响（不从 ApiCall 结果发 `LLM_CONTENT_DELTA`）。

### 影响的代码

| 文件 | 变更 |
|---|---|
| `packages/agent-core/src/agent/default-agent.ts` L475-476 | `_allStructuredPre` → `_hasStructuredPre`，条件改为 `_streamDeltaStructuredPre > 0` |
| `packages/agent-core/src/agent/default-agent.ts` L877-878 | `allStructuredStream` → `hasStructuredStream`，条件改为 `streamDeltaStructured > 0` |
| `packages/agent-core/tests/default-agent-streaming-terminal-suppression.test.ts` | "Mixed chunks" 测试用例更新：期望从 1 条 `LLM_CONTENT_DELTA` 改为 0 条 |

## 验证策略

1. **更新已有测试**：原 "emits terminal LLM_CONTENT_DELTA with only non-structured residue for mixed chunks" 测试用例更新为期望 0 条 `LLM_CONTENT_DELTA`，断言混合场景下有结构化数据时终端被抑制。
2. **全量回归**：`packages/agent-core/tests/` 全部通过，确认全结构化、无流式 chunk 场景不受影响。

## 长期基线刷新计划

- 归档时将 `openspec/specs/tool-structured-delta/spec.md` 中 "Streaming Terminal LLM_CONTENT_DELTA Suppression" Requirement 替换为本 change 的 MODIFIED 版本。
- 更新 "Mixed chunks" Scenario 的 WHEN/THEN/AND 以反映新行为。
- 新增 "All non-structured chunks emits terminal LLM_CONTENT_DELTA" Scenario。
