## 背景和现状（Context）

`add-ts-rag-tool` 定义模型可调用的 `rag` Tool 和 public `RagRetrievalGateway` contract。为了让 local deployment 下的 `rag` Tool 具备最小可用性，我们需要一个简化的本地语料准备能力，但这个能力不应扩展成独立的通用 RAG 平台。它只负责在启动阶段准备一份临时、有限、可清理的本地检索语料，供 local fallback provider 读取。

当前 TS 架构中：
- `agent-app` 是唯一 composition root，负责读取配置、编译 Agent assembly、创建 gateway、capability、runtime 和 lifecycle。
- `agent-platform-gateway-local` 拥有本地 SQLite/Kysely/driver 细节和本地 gateway 私有 schema。
- `agent-capability` 拥有 Tool descriptor/schema/executor，不应直接扫描 workspace 或操作 SQLite/FTS5。
- `workspaceFiles` read scope 和 execution workspace policy 已由 Agent assembly / runtime workspace 机制提供可信输入。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 local startup 阶段一次性整理 compiled active Agent `workspaceFiles` read scope 内的安全文本文件。
- 生成运行期临时检索语料，并实现 local `RagRetrievalGateway` fallback provider 查询该语料。
- 关闭时清理本地临时数据；异常残留在下一次启动前清理。
- 保持实现简单、可测、只服务 `rag` Tool 的本地使用场景。

**非目标：**
- 不定义 `rag` Tool descriptor/schema/executor。
- 不定义远端 RAG 服务接口或远端索引协议。
- 不实现 embedding、向量库、rerank、混合检索或复杂排序体系。
- 不实现 watcher、增量更新、snapshot/current pointer、长期索引或独立治理控制面。
- 不新增 Web API、runtime command、用户刷新入口或模型可控治理参数。

## 设计决策（Decisions）

### 决策 1：治理由 `agent-app` 本地 lifecycle 触发

唯一触发点是 local app startup 和 shutdown：

```text
ADNClaw local startup
  -> agent-app trusted composition resolves active Agent assembly
  -> create local RAG knowledge governance
  -> cleanup previous local RAG residual data
  -> scan workspaceFiles read scope once
  -> write temporary local retrieval data
  -> mark ready/degraded/unavailable

ADNClaw shutdown
  -> close local RAG knowledge governance
  -> cleanup temporary local retrieval data
```

治理不在 request 热路径触发，不由模型、Tool input、用户请求、Web API、runtime command 或 watcher 触发。

### 决策 2：治理和 local fallback retrieval provider owner 是 `agent-platform-gateway-local`

`agent-platform-gateway-local` 新增本地 RAG knowledge governance 实现和 local `RagRetrievalGateway` fallback provider，拥有文件枚举、文本解码、chunk 切分、FTS5 临时表、local FTS5 retrieval、private row mapping、ready/degraded/unavailable 状态和 cleanup 细节。`agent-capability` 只通过 `add-ts-rag-tool` 的 retrieval gateway 间接消费治理结果，不 import local governance 或 FTS5 实现。

### 决策 3：治理输入只来自 trusted assembly 和 workspace policy

`agent-app` 将 compiled active Agent 的 workspace root、`workspaceFiles` read scope 和 trusted agent scope 传入治理实现。治理实现必须把所有文件路径规范化为 workspace-relative path，并拒绝 workspace 外路径、绝对路径、符号链接逃逸和明显不安全输入。

### 决策 4：本地临时检索数据使用一张 FTS5 表

治理结果写入一张本地 RAG FTS5 virtual table。`content` 是 searchable column；`chunk_id`、`workspace_relative_path`、`file_type`、`start_line`、`end_line` 作为 provenance columns 保存，以支持 retrieval result provenance。

本 change 不创建 snapshot、manifest、current pointer、document table、chunk metadata table 或 generic JSON records。本地 FTS5 表只是 local `rag` 可用性的临时支撑，不是 durable artifact。

### 决策 5：chunk 切分固定且 bounded

首版使用简单确定性切分：每个 chunk 最多 60 行或 3,000 字符，以先到者为边界。首版不做标题树、语义段落合并、overlap window、代码符号解析或复杂文件分类体系。

文件过滤保持 implementation-owned 常量和简单规则，只处理少量安全文本类型并跳过明显不安全或无意义输入。

### 决策 6：运行中不更新治理数据

启动治理完成后，运行中文件新增、修改或删除不触发 rebuild、不 watch、不增量更新。后续 retrieval 使用启动时构建的临时数据。下一次进程启动重新全量治理。

### 决策 7：local fallback retrieval provider 只消费治理产物

local `RagRetrievalGateway` fallback provider 是 request-time 查询入口，但它不治理文件。它只读取启动阶段治理完成的本地临时 FTS5 数据，并将 private row 映射为 provider-neutral chunk result。

```text
RagRetrievalGateway.retrieve()
  -> check governance status
  -> validate trusted scope against local provider binding
  -> build safe FTS5 MATCH expression from gateway query
  -> query local temporary FTS5 data
  -> map private rows to safe chunk result
```

provider 不返回 SQLite row、FTS5 table name、rowid、host path、workspace root 或 raw FTS5 expression。治理未 ready 或本地语料不可用时，provider 返回 explicit unavailable/degraded，而不是空成功。

### 决策 8：失败保持显式，但只要求最小安全语义

本 change 只要求本地治理在不可用时返回 explicit degraded/unavailable safe reason，并保证 retrieval 不把基础设施失败伪装为空成功。它不追求首版就穷举细粒度 failure taxonomy。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | scope 来自 trusted composition；治理拒绝 workspace escape、绝对路径、符号链接逃逸和不可安全解码文件；实现不得把 host path、workspace root、raw content 或 SQLite/FTS5 细节暴露到公共结果。 | scope escape tests |
| 性能/容量 | 使用简单文件过滤、文件大小上限和 60 行/3,000 字符 chunk 上限控制启动成本。 | startup governance tests |
| 可靠性/恢复 | 启动先清理残留再构建；关闭清理；治理不可用时 retrieval 返回 explicit degraded/unavailable。 | cleanup tests、unavailable tests |
| 可维护性 | 治理实现和 local fallback retrieval provider 停留在 `agent-platform-gateway-local`；Tool executor 不接触文件扫描或 FTS5；无后台增量系统。 | architecture assertions |
| 可测试性 | 文件过滤、chunk 切分、FTS5 写入、local retrieval、ready 状态和 cleanup 可用临时 workspace 独立测试。 | unit + integration tests |
| 可追溯性 | result provenance 使用 workspace-relative source 和 line coordinate。 | retrieval tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 启动一次性治理，不由请求或 Tool 触发 | 2.1, 4.1 | lifecycle tests、source assertions |
| 输入范围 trusted 且 bounded | 1.1, 2.2 | scope and filtering tests |
| chunk 上限 60 行/3,000 字符 | 1.2 | chunking unit tests |
| 只使用本地临时 FTS5 数据 | 2.3 | schema/source assertions |
| local fallback retrieval provider 读取治理产物并映射 safe result | 2.5 | local fallback retrieval provider tests |
| 关闭清理和异常残留清理 | 2.4 | cleanup tests |
| 运行中文件变化不更新 | 3.1 | no-incremental-update test |
| 治理不可用时 retrieval 显式 degraded/unavailable | 3.2 | unavailable tests |
## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/rag-knowledge-governance/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/rag-knowledge-governance.md`
- 模块设计：`openspec/designs/modules/agent-platform-gateway-local.md` 和 `openspec/designs/modules/agent-app.md`
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 启动治理增加本地启动耗时 -> 通过简单文件过滤、文件大小上限和 chunk 上限控制。
- [风险] 本地 FTS5 检索质量有限 -> 本 change 只提供 local `rag` fallback，不定义产品级检索质量上限。
- [风险] workspace 文件运行中变化但检索结果不更新 -> spec 显式规定运行中不更新，避免把首版做成后台索引系统。

## 迁移计划（Migration Plan）

无数据迁移。本 change 新增运行期临时治理数据；现有持久化表不需要迁移。发布回滚时移除治理 lifecycle 和 local FTS5 临时表即可；异常残留由下一次启动 cleanup 处理。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/rag-knowledge-governance/spec.md`：本地启动治理、临时数据生命周期和失败降级契约。
- `openspec/overview.md`：本地简易 RAG 治理的产品边界。
- `openspec/designs/architecture/rag-knowledge-governance.md`：跨模块流程、触发机制、安全边界、数据生命周期和失败语义。
- `openspec/designs/modules/agent-platform-gateway-local.md`：local gateway 对本地 RAG 临时检索数据和 local fallback retrieval provider 的 ownership。
- `openspec/designs/modules/agent-app.md`：trusted composition 和 lifecycle 接入。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

无。
