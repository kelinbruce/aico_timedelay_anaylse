## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.4 查看请求状态` | 在默认 RAG `SUMMARY` 结果中展示有界安全来源和预览 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-2.4 查看请求状态`

### 目标与规范依据

用户在不提升 RAG 全局呈现级别的前提下，应能核验默认检索结果的来源和片段预览。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`RAG SUMMARY 结果展示保持安全且可核验`

### 当前实现

`agent-channel-common` 已将成功 RAG 结果转换为带来源显示名、内容预览和截断标记的 `ragRetrieval` 安全投影。通用呈现策略仅在 `DETAIL` 时将 `safeResult` 写入 Web payload；默认 `Rag=SUMMARY` 因而只保留计数摘要。Agent Web 已能读取并渲染 `ragRetrieval` items。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| RAG `SUMMARY` 显示来源和预览 | 安全投影已生成，但仅 `DETAIL` 发送 `safeResult` | 需要为可信 RAG 投影在 `SUMMARY` 增加唯一透出规则 |
| 其他 `SUMMARY` 不变 | 通用规则不发送 `safeResult` | 特例必须按 `capabilityId` 严格限定 |

### 修改方案

RAG projector 在生成既有字段白名单、路径处理和容量裁剪后的安全对象时，显式声明该对象也可用于 `SUMMARY`。共享 `projectCapabilityResultPayload(...)` 只按投影声明和有效级别选择结果：`DETAIL` 使用全部安全投影允许的 `safeResult`，`SUMMARY` 只使用 projector 显式声明的摘要安全结果。其他 projector 未声明该结果，因此继续仅在 `DETAIL` 写入 `safeResult`。

该判断位于可信后端共享 projector，因此 live、SSE、WebSocket 和 history 均复用同一行为。前端不新增解析逻辑；现有 `ragRetrieval` 渲染分支直接消费该对象。工具原始结果、timeline 和模型可见结果不修改。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `RAG SUMMARY 结果展示保持安全且可核验` | 只复用既有 RAG 安全投影，不读取原始字段 | 路径、diagnostics 和 provider 字段不进入 payload |
| 性能/容量 | `RAG SUMMARY 结果展示保持安全且可核验` | 保持既有 50 条和预览截断上限 | 超量结果仍受既有上限约束 |
| 可靠性/恢复 | `RAG SUMMARY 结果展示保持安全且可核验` | 共享 live/history projector | 两条路径的 payload 相同 |

## 验证策略（Verification Strategy）

- channel-common contract test 覆盖成功 RAG `SUMMARY`、非 RAG `SUMMARY` 和敏感字段裁剪。
- Agent Web process test 覆盖收到安全 RAG items 后展示来源和单行预览。
- OpenSpec strict validation 覆盖 delta 与基线的合并关系。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：新增 RAG `SUMMARY` 受控例外。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：更新输出和规格。
- `openspec/designs/features/`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/stream-projection.md`：记录 RAG `SUMMARY` 受控投影。
- `openspec/designs/modules/`：无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无。

## 风险与取舍（Risks / Trade-offs）

RAG `SUMMARY` 会比其他摘要携带更多字段，但字段已在共享 projector 中经过白名单和容量裁剪。将逻辑放在共享 projector 而非前端，可避免浏览器解析原始工具结果或 live/history 不一致。

## 待确认问题（Open Questions）

无。
