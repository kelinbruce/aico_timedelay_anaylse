## Why

流式 ApiCall 执行时，编排层（`default-agent.ts`）在 `emitResultDelta` 回调中逐 chunk 判断是否为结构化数据。当前行为：只有当**全部** chunk 都是结构化数据时才跳过终端 `LLM_CONTENT_DELTA`；如果存在混合（部分结构化 + 部分非结构化），则将非结构化 chunk 的数据聚合后通过 `LLM_CONTENT_DELTA { final: true }` 发给前端展示。

前端用户反馈：当流式结果中已包含结构化数据（如 PIU 面板、STREAM_DSL 展开面板）时，剩余非结构化碎片数据拼成的字符串对用户没有信息价值，反而造成视觉干扰和重复展示感。因此需要调整行为：只要流式中有任意一条结构化数据被识别并展示，就不再将非结构化残留聚合展示在前端。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 流式 ApiCall 执行期间，只要至少有一条 chunk 被识别为结构化数据（emit 了 `TOOL_STRUCTURED_DELTA`），编排层 MUST NOT 发射终端 `LLM_CONTENT_DELTA { final: true }`。
- 当没有任何结构化数据被识别时，行为不变：继续按现有逻辑发射 `LLM_CONTENT_DELTA { final: true }`（内容为 `nonStructuredParts.join('')` 或 `nonAgenticFinalContent`）。
- `terminalContent` 用于 `assertTerminalContentReady` 和 terminal commit 的原值不受影响。
- 终端 `CAPABILITY_RESULT_DELTA` 的跳过逻辑不变。
- 两条 non-agentic ApiCall 路径（pre-round 和 post-tool-call）均适用。

**非目标：**

- 不修改 per-chunk 发射行为：流式期间每个 chunk 的 `TOOL_STRUCTURED_DELTA` 或 `CAPABILITY_RESULT_DELTA` 照常发射。
- 不修改 `nonStructuredParts` 的收集逻辑（仍收集，只是终端不再用它发射 `LLM_CONTENT_DELTA`）。
- 不修改 model-driven tool-loop 路径（该路径不从 ApiCall 结果发 `LLM_CONTENT_DELTA`）。
- 不修改持久化聚合层的行为。
- 不修改前端渲染逻辑。

## What Changes

- 修改 `default-agent.ts` 中两条 non-agentic ApiCall 路径的终端抑制条件：从"全部 chunk 都是结构化才跳过"改为"至少有一条结构化数据就跳过终端 `LLM_CONTENT_DELTA`"。
- 不涉及公共契约变更。`AgentRunStatePort` 不变。Gateway 接口不变。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-5.16 识别和投射结构化工具增量` → canonical spec `tool-structured-delta`
  - 变化边界：修改 "Streaming Terminal LLM_CONTENT_DELTA Suppression" Requirement 的抑制条件——从"全部结构化才跳过"改为"存在任意结构化数据即跳过"。
  - 系统质量属性：可维护性。

### 新增 Function

无。

## 影响范围（Impact）

- **前端**：当流式结果中存在结构化数据时，不再收到终端 `LLM_CONTENT_DELTA`，前端不会展示非结构化残留字符串。纯非结构化流式结果不受影响。
- **Agent 开发者**：无感知。
- **公共契约**：无变更。
- **代码**：`packages/agent-core/src/agent/default-agent.ts` 两处条件判断修改；相关测试更新。
