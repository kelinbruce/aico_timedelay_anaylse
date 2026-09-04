## 1. Governance primitives

- [x] 1.1 在 `agent-platform-gateway-local` 实现最小本地语料过滤规则：workspace-relative path 校验、安全文本筛选、基础容量限制和实现内 owned 常量；不得从 Tool input、用户请求体或模型输出接收治理参数。
  验证：tests 覆盖 workspace escape、绝对路径、符号链接逃逸、二进制输入和受支持文本输入。
  来源：Requirement "Governance input scope is trusted and bounded"；design 决策 3、5。
- [x] 1.2 新增 chunk 切分函数，按最多 60 行或 3,000 字符切分，并保留 `chunk_id`、workspace-relative source、file type、startLine、endLine 和 content。
  验证：unit tests 覆盖 60 行边界、3,000 字符边界、超长单行、空白 chunk、line coordinate 和 chunk id 稳定性。
  来源：Requirement "Governance input scope is trusted and bounded"；design 决策 5。

## 2. Local temporary store and lifecycle

- [x] 2.1 在 `agent-platform-gateway-local` 新增 RAG knowledge governance service，支持 startup `build()`：先 cleanup 残留，再扫描 compiled active Agent `workspaceFiles` read scope，一次性写入本地临时 FTS5 数据并产生 ready/degraded/unavailable 状态。
  验证：integration test 使用临时 workspace 断言 startup build、read scope 边界、ready 状态和 chunk 数。
  来源：Requirement "Local startup builds RAG knowledge once"；design 决策 1、2。
- [x] 2.2 在治理扫描中只接受 trusted composition 传入的 workspace scope、read scope 和 agent scope；用户请求体、模型输出、Tool input 不得影响治理范围。
  验证：negative tests 覆盖 Tool input/provider override/path override 无法改变治理范围；architecture/source assertion 确认 governance 不从 capability arguments 读取 scope。
  来源：Requirement "Governance input scope is trusted and bounded"；design 决策 3。
- [x] 2.3 新增一张本地临时 RAG FTS5 virtual table，只保存 searchable `content` 和 provenance columns；不得新增 snapshot、manifest、current pointer、document/chunk metadata table 或 generic JSON records。
  验证：schema/source assertions 覆盖只创建/reset 一张 FTS5 表，并断言禁止额外 durable 表。
  来源：Requirement "Local governance data is temporary"；design 决策 4。
- [x] 2.4 实现 shutdown cleanup 和下次启动前残留 cleanup，删除或 drop 本地 RAG 临时数据并释放 SQLite/FTS5 resources。
  验证：cleanup tests 覆盖正常关闭、异常残留和 cleanup 后重新构建。
  来源：Requirement "Local governance data is temporary"；design 决策 1、4。
- [x] 2.5 在 `agent-platform-gateway-local` 实现 local `RagRetrievalGateway` fallback provider，读取本地治理生成的临时 FTS5 数据，检查治理 ready/degraded/unavailable 状态，并将 private FTS5 rows 映射为 provider-neutral chunk result。
  验证：local fallback retrieval provider tests 覆盖 ready 查询、no match、topK bound、governance unavailable、private row/host path redaction 和 raw FTS5 expression 不外泄。
  来源：Requirement "Local retrieval provider consumes governed data"；design 决策 2、7。

## 3. Minimal runtime behavior

- [x] 3.1 覆盖运行中文件变化不触发更新：启动治理完成后新增、修改或删除文件，retrieval 继续使用启动时构建的数据。
  验证：no-incremental-update integration test 断言无 watcher、无 rebuild、无 request-time governance。
  来源：Requirement "Local startup builds RAG knowledge once"；design 决策 6。
- [x] 3.2 当本地治理未 ready、不可用或被取消时，local fallback retrieval provider 返回 explicit degraded/unavailable/failed safe result；不得返回空成功。
  验证：tests 覆盖 startup 前 `NO_INDEX`、scope mismatch、invalid input、cancelled 或 unavailable 情况。
  来源：Requirement "Governance failures are explicit and safe"；design 决策 8。

## 4. App composition

- [x] 4.1 在 `agent-app` 本地 trusted composition / lifecycle 中装配 RAG knowledge governance，并传入 compiled active Agent workspace root、workspaceFiles read scope、trusted agent scope 和 SQLite dependency。
  验证：composition tests 覆盖 startup build 被调用、shutdown cleanup 被调用、缺少 workspace/read scope 时显式 degraded/unavailable。
  来源：Requirement "Local startup builds RAG knowledge once"；design 决策 1、3。
- [x] 4.2 增加 architecture assertions，确认 `agent-capability`、`agent-runtime`、`agent-core`、`agent-context-engine` 和 `agent-channel-web` 不直接 import RAG governance、FTS5 store 或 local schema 实现。
  验证：`npm run lint:architecture` 和专项 source assertion。
  来源：design 决策 2、4。

## 5. Validation

- [x] 5.1 运行并记录常规验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：命令输出。
  来源：AGENTS 验证门禁。
- [x] 5.2 运行并记录 OpenSpec 验证：`openspec validate add-ts-rag-knowledge-governance --strict` 和 `openspec validate --all --strict`。
  验证：命令输出。
  来源：OpenSpec 验证门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/rag-knowledge-governance/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需新增或更新 `openspec/designs/architecture/rag-knowledge-governance.md`。
- 按需更新 `openspec/designs/modules/agent-platform-gateway-local.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、数据 owner 或接口语义。
