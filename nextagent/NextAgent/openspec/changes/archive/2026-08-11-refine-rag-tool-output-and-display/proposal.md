## Why

RAG Tool 的输出 schema 当前对结果项和诊断字段施加封闭约束，而聊天过程面板不能把已返回的 RAG 结果解释为可展示摘要，用户只能看到通用成功提示，无法确认召回数量和知识来源。

需要放宽 RAG Tool 的输出 schema，并让用户在工具执行过程内看到实际召回数量及每条结果的来源名称。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- RAG Tool 输出 schema 接受状态、结果数组和可选诊断对象；结果项和诊断对象不再由 schema 施加字段集合或单个字段长度限制，Tool 仍保留既有提供方结果校验与字段投影。
- RAG Tool 仍按请求的 `topK` 返回至多该数量的结果。
- 聊天过程面板在 RAG 成功时显示召回结果数量、每条结果的 `source` 名称和最多 50 个字符的内容预览。
- 实时结果与会话历史重建使用同一类安全展示摘要，并在三种 Web 宿主中保持一致。

**非目标：**

- 不修改 RAG 输入参数、可信 scope、gateway 选择、失败状态或低基数观测字段。
- 不新增 Web route、stream event、持久化事实或前端请求生命周期。
- 不在过程面板展示完整检索正文、`provenance`、`score`、`rankHint` 或诊断对象。

## What Changes

- **BREAKING** 修改 RAG Tool 的输出 schema：顶层允许额外字段，`results` 元素和 `diagnostics` 作为不限制字段集合的对象；调用方不得依赖 `content`、`source`、`provenance`、`score`、`rankHint` 的 schema 长度、格式或封闭字段集校验。
- 修改 RAG Tool 的输出 schema，并保持既有的提供方结果接收、状态映射和字段投影规则。
- 新增 RAG 检索结果的过程面板安全展示摘要：成功结果展示总数量及按结果顺序出现的 `displaySource`、前 50 个字符内容预览和截断状态；缺少字符串 `source` 的结果生成可本地化的来源缺失条目，保持展示明细与总数量一致。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.7 知识检索`：使用者除获得模型消费的检索结果外，还能在聊天过程面板确认召回数量与来源名称。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- 无。

### 修改的 Function

- `FN-5.13 检索知识库` → `specs/rag-tool/spec.md`
  - 功能边界：RAG Tool 输出结果项与诊断对象的 schema 约束放宽，并保持结果数量受 `topK` 限制。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：canonical spec `rag-tool`。
- `FN-1.1 查看会话消息流` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：RAG Tool 成功结果在过程面板显示召回数量和来源名称，实时和历史展示一致。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：本次触及的 legacy spec `ts-run-status-visibility`。

## 影响范围（Impact）

- RAG Tool 调用方需要接受开放的结果字典和诊断对象。
- Web channel 的安全结果投影、前端历史重建和过程面板文案将消费新增的 RAG 展示摘要。
- 受影响测试包括 RAG Tool contract、stream projection、前端安全结果解析和过程面板投影测试。
