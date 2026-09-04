# FN-5.13 检索知识库

> 能力域 D5 Capability 能力体系 · 子域 [D5.3 Skill 与检索](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-5.7](../../../features/D5-Capability能力体系/D5.3-Skill与检索/F-5.7-知识检索.md) |
| 当前状态 | 稳定 |
| 主规格 | `rag-tool` |
| 关联规格 | `rag-knowledge-governance` |
| 接口 | 能力调用端口（检索工具）+ 检索网关 |

## 描述

模型通过统一 RAG Capability 检索可信 Agent 范围内的逻辑知识索引。系统区分零命中、完整或有界结果、具有可独立使用片段的部分完成，以及完全没有可用片段的失败，避免把空结果、超时或依赖故障混成同一种状态。

## 前置条件

- RAG Tool 已在当前 Agent assembly 中启用且可见。
- 目标逻辑索引已在当前可信范围内配置并授权；调用参数不能指定 owner scope 或底层 provider authority。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 查询 | 是 | 非空检索问题，不得携带 scope 或 provider authority |
| 索引 | 否 | 受治理的逻辑索引；显式索引优先于 app-composed default |
| 返回数量 | 否 | 由 Tool schema 约束的 `topK` |

## 输出

通过 RAG output schema 的知识片段、命中元数据和明确的完成状态；失败只通过公共 `safeError` 表达。输出 schema 允许顶层额外字段和任意字段的 `diagnostics` 对象，不对结果项或诊断对象施加封闭字段集、长度、格式、数值范围或必填字段约束；Tool 保留既有提供方结果校验、状态映射、字段投影和按 `topK` 截取的结果数量边界。

## 处理过程

1. 系统确认 RAG Capability 对当前请求可见且可用，并完成公共 schema 校验；校验失败时不发起检索。
2. 系统完成 query/index/topK 语义校验，一次返回当前阶段全部可独立判断的安全 violations。
3. 显式逻辑索引优先于配置的默认索引；索引和检索服务选择都不能扩大当前可信 scope。
4. 系统执行检索，并对返回结构、内容边界和安全结果进行校验。
5. 零命中、声明 `topK` 内的完整结果和声明上限内有界结果保持 `SUCCEEDED`。
6. 只有已返回安全 chunks 且 provider 明确确认其余已声明检索范围未完成时，才返回 `DEGRADED + safeError`，并说明可用片段和缺失范围。
7. 无 chunks 的 index missing/not-ready、unavailable、timeout、authorization、cancel、invalid provider result 或 internal failure 按真实 category 返回空业务 payload 的安全失败。
8. RAG Tool 的调用被声明为 `IDEMPOTENT`；只有瞬态、`retryable=true`、未取消、无可见 delta 且未超过调用上限时，系统才可同参 retry。

## 结果

- 正常：返回通过 schema 的匹配片段；声明范围内的安全截断不改变成功状态。
- 无匹配：合法成功并返回空列表，不生成 not-found 错误。
- 部分完成：返回可独立使用 chunks、明确缺失范围和安全错误。
- 索引缺失或未就绪：分别给出选择可用索引或稍后查询状态的恢复动作。
- 无可用结果：返回唯一安全错误，不携带 provider diagnostics，不伪装降级。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 统一检索入口 | RAG 作为受治理 Capability 使用系统配置的公共检索服务；底层 provider 和 scope 不由调用输入选择 | `rag-tool`：`RAG Tool is a capability retrieval entrypoint`、`RAG Tool calls the composed retrieval gateway` |
| 输入与权限 | Tool input 有界且不得选择 owner/agent scope、credential 或 provider authority | `rag-tool`：`Tool input is bounded and cannot select authority` |
| 成功与降级 | 零命中和声明范围内完整/有界结果成功；仅在存在可独立使用 chunks 且声明范围部分失败时降级 | `rag-tool`：`Result shape is safe and bounded`、`Failures and degradation are explicit` |
| 安全可观测 | 错误和观测不泄漏 query、provider response、credential、路径或高基数字段 | `rag-tool`：`Observability is safe and low-cardinality` |
| 输出 schema 开放性 | 输出 schema 允许顶层额外字段和任意字段的 `diagnostics` 对象，不对结果项或诊断对象施加封闭字段集或单字段约束；结果数量仍受 `topK` 限制 | `rag-tool`：`Result shape is safe and bounded` |
| 执行诊断投影 | Tool 完成时把结果状态、结果数量桶和原因码投影到 capability completed 结构化可观测事件；local RAG governance 为索引构建和检索写入结构化 runtime diagnostic，不含 query、正文、来源或路径 | `rag-tool`：`RAG 检索具有低基数执行诊断` |
