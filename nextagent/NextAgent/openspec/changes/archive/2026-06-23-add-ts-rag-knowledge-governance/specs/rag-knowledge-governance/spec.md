## ADDED Requirements

### Requirement: Local startup builds RAG knowledge once

本地部署启动时，系统 SHALL 在 trusted app composition / startup lifecycle 中触发一次 RAG 知识治理。治理 SHALL 使用 compiled active Agent 的 trusted workspace scope 和 `workspaceFiles` read scope，扫描安全文本文件，切分 bounded chunk，并写入本地临时检索数据。治理 MUST NOT 由用户动作、模型输出、Tool input、Web API、runtime command、定时 job、watcher 或请求热路径触发。local `RagRetrievalGateway` fallback provider SHALL only retrieve from this startup-built temporary data.

#### Scenario: Startup governance succeeds
- **GIVEN** ADNClaw 以 local deployment 启动
- **AND** compiled active Agent 存在可信 workspace scope 和 `workspaceFiles` read scope
- **WHEN** app startup lifecycle 创建本地 RAG knowledge governance
- **THEN** 系统 SHALL 清理上次残留的本地 RAG 临时数据
- **AND** 扫描 read scope 内的受支持安全文本文件
- **AND** 将切分后的 chunk 写入本地临时检索数据
- **AND** 标记治理状态为 ready。

#### Scenario: Runtime file changes are not governed
- **GIVEN** 本地启动治理已经完成
- **AND** workspace 文件在同一 ADNClaw 进程运行期间新增、修改或删除
- **WHEN** 后续 RAG retrieval 执行
- **THEN** retrieval SHALL 使用启动时构建的本地临时检索数据
- **AND** 系统 MUST NOT watch、rebuild、incrementally update 或等待新的治理结果。

### Requirement: Local retrieval provider consumes governed data

本地部署中，`agent-platform-gateway-local` SHALL provide the local `RagRetrievalGateway` fallback provider. 该 provider SHALL read only the temporary retrieval data produced by local RAG knowledge governance, map private FTS5 rows to provider-neutral chunk results, and consume governance ready/degraded/unavailable status before querying. It MUST NOT expose FTS5 table names, SQLite rows, host paths, workspace roots or raw FTS5 expressions through the public gateway result.

#### Scenario: Local provider returns governed chunks
- **GIVEN** 本地启动治理已经完成并标记 ready
- **AND** 本地临时检索数据中存在匹配 query 的 chunk
- **WHEN** `RagRetrievalGateway.retrieve()` 在 local provider 上执行
- **THEN** provider SHALL query only the governed temporary data
- **AND** return provider-neutral chunks with safe source refs, bounded content and optional score
- **AND** MUST NOT return private FTS5 row fields or host paths。

#### Scenario: Governance unavailable blocks local retrieval
- **GIVEN** 本地启动治理状态为 unavailable 或 degraded 且无可安全查询的数据
- **WHEN** `RagRetrievalGateway.retrieve()` 在 local provider 上执行
- **THEN** provider SHALL return explicit unavailable or degraded status with a low-cardinality reason
- **AND** MUST NOT query missing or invalid FTS5 data
- **AND** MUST NOT report an empty successful retrieval。

### Requirement: Governance input scope is trusted and bounded

RAG 知识治理 SHALL 只处理可信 workspace scope 内、compiled active Agent `workspaceFiles` read scope 允许读取的安全文本文件。文件过滤规则、文件大小上限和 chunk 上限 SHALL 是 implementation-owned 常量，不得来自 Tool input、用户请求体、模型输出或客户端 metadata。首版 chunk MUST bounded to at most 60 source lines or 3,000 characters, whichever boundary is reached first.

#### Scenario: Supported text files are chunked with provenance
- **GIVEN** read scope 内存在 `.md`、`.mdx`、`.json`、`.txt` 或安全文本代码文件
- **WHEN** 本地启动治理扫描这些文件
- **THEN** 系统 SHALL 只处理 allowlist 文件类型
- **AND** 每个 chunk MUST 包含 workspace-relative source、file type、startLine、endLine 和 content
- **AND** 每个 chunk MUST NOT 超过 60 source lines 或 3,000 characters。

#### Scenario: Scope escape is rejected
- **GIVEN** workspace 外路径、绝对路径、符号链接逃逸路径、依赖目录、生成产物目录、二进制文件、图片、PDF、Office 文件、压缩包或 lock 文件存在
- **WHEN** 本地启动治理扫描 workspace
- **THEN** 系统 SHALL 跳过这些输入
- **AND** MUST NOT 将 host path、workspace root、raw content 或 raw decode error 暴露到公共结果。

### Requirement: Local governance data is temporary

本地 RAG 知识治理产物 SHALL 是运行期临时检索数据，不是 durable knowledge base、artifact、checkpoint、memory record 或长期索引。ADNClaw 正常关闭时 SHALL 清理该本地临时数据并释放资源；如果上次进程异常退出留下残留，下一次 local startup MUST 在重新治理前清理残留。

#### Scenario: Shutdown cleanup removes governed data
- **GIVEN** 本地 RAG 临时检索数据已经构建
- **WHEN** ADNClaw shutdown lifecycle 执行
- **THEN** 系统 SHALL 删除或 drop 本地 RAG 临时检索数据
- **AND** 释放相关 SQLite/FTS5 resources。

#### Scenario: Previous residual data is cleaned before rebuild
- **GIVEN** 上一次进程异常退出留下本地 RAG 临时数据
- **WHEN** 下一次 local startup 触发治理
- **THEN** 系统 MUST 在扫描 workspace 文档前清理残留
- **AND** 新的本地临时检索数据 SHALL 只来自本次启动扫描。

### Requirement: Governance failures are explicit and safe

RAG 知识治理在本地语料不可用、构建失败、cleanup 失败或取消时，系统 SHALL 产生明确 degraded/unavailable governance status 和低基数 safe reason code。系统 MUST NOT 把基础设施失败伪装成空成功。

#### Scenario: Build failure reports unavailable
- **GIVEN** FTS5 不可用或本地临时检索数据构建失败
- **WHEN** 本地启动治理执行
- **THEN** 系统 SHALL 标记治理状态为 unavailable 或 degraded
- **AND** 后续 local RAG retrieval provider MUST receive an explicit safe reason
- **AND** MUST NOT return empty success for infrastructure failure。

#### Scenario: Unsupported or skipped content does not widen scope
- **GIVEN** read scope 内存在不受支持、不可安全解码或按实现策略应跳过的内容
- **WHEN** 本地启动治理处理这些输入
- **THEN** 系统 MAY 跳过这些内容
- **AND** MUST NOT 因跳过内容而放宽 trusted scope
- **AND** MUST NOT 将 raw content、host path 或 raw decode error 暴露到公共结果。
