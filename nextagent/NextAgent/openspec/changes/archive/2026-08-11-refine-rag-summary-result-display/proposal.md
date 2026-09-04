## Why

网络运维人员在对话中使用 RAG 检索知识库后，目前只能看到“已成功召回 N 条内容”。他们无法确认召回来自哪些知识文档，也无法快速判断片段是否与故障定位问题相关，只能依赖后续模型回答。

RAG 原本已经具备安全来源和内容预览的投影，但统一 Capability 结果呈现策略把 `Rag` 的默认级别设为 `SUMMARY`，而现有 `SUMMARY` 不返回该投影，导致上述信息不再显示。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 用户在默认 `SUMMARY` 呈现策略下查看成功的 RAG 步骤时，可看到召回总数、每条安全来源名称和有界内容预览。
- live、刷新后的 run-event history、SSE、WebSocket 以及三种浏览器宿主对同一 RAG 结果呈现相同内容。
- 展示继续只使用可信后端生成且已受限的 RAG 安全投影。

**非目标：**

- 不改变 RAG Tool 的输入、输出、检索、索引选择或模型上下文行为。
- 不将其他 `SUMMARY` Capability 提升为详情展示，不改变 `DETAIL`、失败或 `STATUS_ONLY` 的既有语义。
- 不向浏览器暴露原始结果、绝对路径、工作区根目录、provider 诊断、分数、provenance 或其他未白名单字段。

## What Changes

- 修改 `Rag` 成功结果的 `SUMMARY` 呈现：除现有计数摘要外，可信后端还将返回既有 RAG 安全投影中的有界来源列表和内容预览，浏览器据此展示每条召回来源与预览。
- 保持 RAG 的有效呈现级别为 `SUMMARY`；该有界 RAG 投影是 `SUMMARY` 的受控特例，不构成通用 `safeResult` 透传。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- 无。

### 修改的 Function

- `FN-2.4 查看请求状态` -> `specs/ts-run-status-visibility/spec.md`
  - 功能边界：用户查看 RAG Capability 成功结果时，默认摘要增加安全来源和内容预览。
  - 系统质量属性：安全、可靠性/恢复、性能/容量。
  - 映射说明：canonical spec；本次新增 RAG `SUMMARY` 安全结果展示 Requirement，作为通用 `SUMMARY` 规则的受控特例。

## 影响范围（Impact）

- Agent Web 的 RAG 过程卡片会在默认配置下显示已有的安全来源和预览，而不再只显示召回计数。
- Web stream 的安全投影和其 contract / frontend 回归测试需要覆盖该 RAG `SUMMARY` 特例。
- 不新增配置项、Web API、Tool contract 或运维开关。
