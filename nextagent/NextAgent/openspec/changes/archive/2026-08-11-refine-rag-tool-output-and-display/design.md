## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.13 检索知识库` | 接受开放的 RAG 结果字典，同时保留 `topK` 结果数量限制 | `rag-tool` | `FN-5.13 检索知识库` |
| `FN-1.1 查看会话消息流` | 为成功 RAG 结果提供数量与来源名称的实时/历史一致展示 | `ts-run-status-visibility` | `FN-1.1 查看会话消息流` |

## `FN-5.13 检索知识库`

### 目标与规范依据

RAG Tool 应在不改变输入、可信 scope、状态与结果数量语义的前提下，放宽输出 schema 的结果对象和诊断对象约束。

#### 本 Function 的目标 Requirements

canonical spec：`rag-tool`

- `MODIFIED`：`Result shape is safe and bounded`

### 当前实现

`rag-schemas.ts` 为结果数组、结果字段和诊断对象定义了封闭 schema 与单字段限制。`rag-tool.ts` 已在 gateway 调用后按 `topK` 截取结果；其 `isSafeChunk` 当前不执行字段检查。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 开放结果对象与诊断对象 | 输出 schema 拒绝额外字段和超出固定长度的字段 | 需要移除输出 schema 的封闭对象和字段限制 |
| 保留 `topK` 数量边界 | Tool 已按 `topK` 截取 | 迁移时必须保留该路径 |

### 修改方案

RAG 过程详情将每个来源显示为独立的紧凑标签。内容预览仅在显示时把连续空白（包括换行和空行）归一化为单个空格，安全摘要本身保留按 Unicode code point 截断的语义。

安全摘要改为按原始内容的文字占比确定上限：汉字数量大于拉丁字母数量时截断为 40 个 Unicode code point，其他内容截断为 100 个 Unicode code point。stream projection 与历史重建分别使用同形判断，前端安全摘要读取器以同一上限拒绝越界数据。

RAG Tool 的完成诊断使用既有 `toolDiagnostics` 低基数通道，向 canonical capability observation 投影 `toolResultStatus`、`toolResultCountBucket` 和 `reasonCode`。local RAG governance 额外记录索引构建和检索的 runtime diagnostic；日志只含状态、原因码、数量桶、`topK` 和耗时，不复制 query、语料或路径。

`agent-capability` 保持现有 gateway 调用、提供方结果校验、状态映射、低基数完成诊断和 `topK` 截取。仅将 `ragOutputSchema` 改为允许顶层额外字段、无字段限制的结果项及诊断对象；`rag-tool.ts` 保留附件定义的字段投影、执行与异常路径。

不修改 RAG 输入 schema、gateway contract、状态值、可信 scope 或观测字段。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性、可测试性 | 无新增黑盒质量目标 | 输出 schema 与 Tool 映射保持单一契约入口 | schema 与 Tool 行为测试覆盖扩展字段、数量截断和非对象结果接受 |

## `FN-1.1 查看会话消息流`

### 目标与规范依据

成功 RAG 结果必须拥有前端可识别的展示摘要，使实时与历史过程面板都能显示召回数量、来源名称和最多 50 个字符的内容预览。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`RAG 检索结果具有可展示的安全摘要`

### 当前实现

Web channel 的 stream projection 只识别既有 Tool 的安全结果形状，前端 `safeCapabilityResult.ts` 也未解析 RAG 专用结果。过程面板因缺少可展示摘要而使用通用成功兜底文案。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 统一的 RAG 展示摘要 | live projection 与历史重建均无 RAG 分支 | 需要在两条路径产生相同 `ragRetrieval` 形状 |
| 显示数量与来源而非正文 | 通用兜底不读取 RAG 结果 | 需要过程详情识别该形状并渲染来源列表 |

### 修改方案

在 `agent-channel-common` 的既有安全结果投影中增加唯一 RAG 分支：从成功结果数组读取长度、字符串 `source` 和字符串 `content`，生成 `kind="ragRetrieval"`、`totalCount` 与有序 `items`。每个条目包含 `displaySource`、`sourceMissing`、前 50 个 Unicode code point 的 `contentPreview` 及 `contentTruncated`。缺少可显示来源时保留该条目并标记 `sourceMissing=true`，由过程面板通过本地化资源显示来源缺失标签。相同形状由 frontend 的安全结果构建器用于历史重建。`processDetails.ts` 只消费该形状并显示数量、来源行和预览，不读取原始结果正文或其他字段。

不新增 event、route、持久化字段或前端请求状态。非成功 RAG 结果保留既有失败/降级展示；成功结果缺少来源时仍显示数量及来源缺失标签。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性、可测试性 | 无新增黑盒质量目标 | live 与 history 复用同一安全结果形状 | projection 与 process-details 测试断言同形摘要、顺序和正文不泄漏 |

## 跨 Function 协作与端到端流程

`FN-5.13` 产出开放的 RAG 结果数组；`FN-1.1` 将其中可展示的数量和来源投影为前端摘要。前端只消费摘要，不改变 Tool 输出，也不反向参与检索执行。

## 验证策略（Verification Strategy）

RAG Tool 单元测试覆盖扩展字段、`topK` 截断和非对象结果接受。channel 与前端单元测试分别覆盖实时投影、历史重建、来源顺序、50 个 Unicode code point 预览、截断标记、缺失来源标签及完整正文不进入展示摘要。前端 build 验证三宿主共享的 TypeScript 产物可构建；OpenSpec strict validation 验证 change 文档。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/rag-tool/spec.md`：修改输出契约。
- `openspec/specs/ts-run-status-visibility/spec.md`：增加 RAG 安全展示摘要契约。
- `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.13-检索知识库.md`：修改输出说明。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.1-查看会话消息流.md`：修改展示结果说明。
- `openspec/designs/features/D5-Capability能力体系/D5.3-Skill与检索/F-5.7-知识检索.md`：修改用户可见检索结果说明。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/rag-tool.md`：修改输出投影边界。
- `openspec/designs/architecture/conversation-ui-state.md`：修改 RAG 安全结果投影说明。
- `openspec/designs/modules/agent-capability.md`、`openspec/designs/modules/agent-channel-common.md`、`openspec/designs/modules/agent-web.md`：修改相关模块职责与验证入口。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：更新验证入口导航。

## 风险与取舍（Risks / Trade-offs）

开放输出 schema 不改变 Tool 的提供方结果校验、状态校验、结果数组校验或 `topK` 截断。前端摘要只读取 `source` 和有限内容预览，以避免在过程面板复制检索正文。

## 待确认问题（Open Questions）

无。
