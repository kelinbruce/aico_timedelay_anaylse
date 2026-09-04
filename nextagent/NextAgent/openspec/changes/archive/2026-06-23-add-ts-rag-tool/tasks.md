## 1. Gateway contract

- [x] 1.1 在 `agent-contracts/gateway` 新增最小 `RagRetrievalGateway` public port、request/result/chunk DTO、status vocabulary、diagnostics DTO 和 package export。request 只表达 trusted owner scope、trusted agent scope、trusted knowledge-source/workspace scope、`query`、provider-neutral logical `indexes` 和 bounded result options；`query` 最大 256 字符；`indexes` 是 `list<string>` 且最多 5 个，表示当前 Agent 可用知识源中的逻辑索引选择，省略默认 `["local"]`；`topK` 省略默认 5，允许范围 1-10。result 只表达 safe status、bounded `results` 和安全低基数 diagnostics；不得暴露 host path、workspace root、SQLite row、FTS5 expression、provider-private connection/config、provider-private credential、provider-private index binding、raw request/response 或 provider-private error。
  验证：contract type/schema tests 和 source assertion 覆盖 public DTO 字段白名单。
  来源：Requirement "RAG Tool calls the composed retrieval gateway"；design 决策 2。
- [x] 1.2 定义 RAG safe status/reason vocabulary，覆盖 invalid input、provider unavailable、index not ready/no index、scope mismatch、timeout、cancelled、invalid provider result 和 execution failed。diagnostics reason 必须是低基数字符串枚举，不承载 query、path、content、provider-private connection/config 或 raw error。
  验证：contract tests 覆盖每个 status/reason 的 safe shape。
  来源：Requirement "Result shape is safe and bounded"；failure/degradation requirements。

## 2. Builtin RAG Tool

- [x] 2.1 在 `agent-capability` 新增 builtin `rag` Tool descriptor、safe description、input schema 和 output schema。input schema 限定 `query`、`indexes`、`topK`：`query` 必填且非空，最大 256 字符；`indexes` 为 `list<string>`，可省略且默认 `["local"]`，最多 5 个；`topK` 可省略且默认 5，允许范围 1-10。output schema 使用 `status`、`results` 和可选安全 `diagnostics`；每个 result 字典字段为 `content`、`source`、`provenance?`、`score?`、`rankHint?`。禁止 Tool input 携带 owner/agent/workspace/provider/deployment/provider-private connection/config/provider-private credential/host path/SQLite/FTS5/provider-private index authority。
  验证：schema tests 覆盖默认 indexes/topK、空 indexes、非 string index、空白 index、topK out-of-range、provider override、deployment override、provider-private connection/config injection、provider-private credential injection、absolute path、raw FTS5 expression、provider-private index parameter、safe diagnostics 和 unsafe diagnostics negative cases。
  来源：Requirement "Tool input is bounded and cannot select authority"。
- [x] 2.2 实现 `rag` Tool executor：从 accepted request / capability invocation context 派生 trusted owner scope、agent scope、workspace/knowledge-source scope，应用 `indexes=["local"]` 和 `topK=5` 默认值，调用 `RagRetrievalGateway.retrieve()`，并把 gateway result 映射为 bounded safe Tool result。
  验证：executor tests 覆盖默认值应用、正常结果、degraded/unavailable 结果、timeout、cancelled、invalid provider result、safe diagnostics mapping 和 result bound。
  来源：Requirement "RAG Tool is a capability retrieval entrypoint"；design 决策 4。
- [x] 2.3 扩展 builtin Tool dependencies，使 `rag` executor 只接收 `RagRetrievalGateway` contract dependency 和 invocation context，不直接 import local governance、SQLite/FTS5 implementation、provider-private client 或 workspace host path。
  验证：executor tests 和 architecture/source assertion。
  来源：Requirement "RAG Tool calls the composed retrieval gateway"；design 决策 2、3。

## 3. Product composition

- [x] 3.1 在 `agent-app` trusted composition 中把当前 package/composition shape 提供的 `RagRetrievalGateway` 注入 builtin Tool dependency；Tool input、用户请求体和模型输出不得覆盖 provider 选择。local mode 与 remote mode 必须使用同一个 Tool input/output contract，差异只停留在 composed provider 内部。
  验证：composition tests 覆盖 gateway injected、missing gateway unavailable/degraded、provider override negative cases，以及 local/remote provider fake 使用同一 Tool contract。
  来源：Requirement "RAG Tool calls the composed retrieval gateway"；design 决策 3。
- [x] 3.2 增加 architecture assertions，确认 `agent-capability` 只依赖 gateway contract；`agent-runtime`、`agent-core`、`agent-context-engine`、`agent-channel-web` 不直接 import RAG provider implementation。
  验证：`npm run lint:architecture` 和专项 source assertion。
  来源：design 决策 2、3。

## 4. Behavior and observability tests

- [x] 4.1 覆盖安全输入路径：authority override、workspace root、host path、provider-private connection/config、provider-private credential、raw FTS5 expression、provider-private index parameter 均被拒绝或忽略；result/diagnostics 不泄漏 provider-private fields。
  验证：security negative tests。
  来源：Requirement "Tool input is bounded and cannot select authority"；Requirement "Result shape is safe and bounded"。
- [x] 4.2 覆盖失败/降级路径：provider unavailable、index not ready/no index、scope mismatch、timeout、cancelled、invalid provider result 和 execution failed 都返回 explicit safe status/diagnostics；不得返回空成功。
  验证：gateway fake failure/degradation tests。
  来源：Requirement "RAG Tool calls the composed retrieval gateway"；Requirement "Result shape is safe and bounded"。
- [x] 4.3 为 RAG invocation 增加 safe observability mapping，只记录 capability id、invocation id、status、duration bucket、result count 和低基数 reason code，不记录 raw query、content、host path、workspace root、provider-private connection/config、provider-private credential、FTS5 expression 或 provider raw error。
  验证：observability redaction tests。
  来源：Requirement "Observability is safe and low-cardinality"。

## 5. Validation

- [x] 5.1 运行并记录常规验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：命令输出。
  来源：AGENTS 验证门禁。
- [x] 5.2 运行并记录 OpenSpec 验证：`openspec validate add-ts-rag-tool --strict` 和 `openspec validate --all --strict`。
  验证：命令输出。
  来源：OpenSpec 验证门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/rag-tool/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需新增或更新 `openspec/designs/architecture/rag-tool.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
