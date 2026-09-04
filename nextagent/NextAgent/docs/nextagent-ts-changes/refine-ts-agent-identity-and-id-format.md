# refine-ts-agent-identity-and-id-format

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Core Contract Refinement

状态：ready
类型：contract refinement
主要 owner：`agent-contracts`
协作 owner：`agent-common`、`agent-runtime`、`agent-platform-gateway-local`、`agent-app`
依赖：`establish-ts-core-contracts`、`ship-ts-minimal-agent-kernel`、`add-ts-agent-package-assembly`、`add-ts-local-run-timeline-store`

目标：
- 删除重复 `agentAssemblyRef`，明确 AgentAssembly identity 为 `agentId + agentVersion`。
- 将系统生成 durable identity 收敛为 TypeID。
- 将 sequence、ordinal、version 明确为 scoped coordinate，而不是全局 identity。
- 保留 human-authored safe id 与 deterministic idempotency key 的独立语义。

规格输入：
- Public contracts MUST use `agentId + agentVersion` as AgentAssembly identity; `agentAssemblyRef` must not remain as a parallel identity field.
- System-generated durable ids MUST use TypeID-style durable identity vocabulary owned by the correct contract or common vocabulary boundary.
- Sequence、ordinal 和 version MUST only be meaningful inside their parent scope and must not be exposed or persisted as global ids.
- Deterministic idempotency keys MUST remain command metadata or scoped uniqueness anchors; they are not random durable ids.
- Human-authored safe ids MUST remain validated display/config identifiers and must not be reused as persistence identity.
- Existing RequestRun、RequestContext、gateway records and SQLite row mappings must have a single explicit mapping from domain identity to persistence identity.

契约输入：
- `agent-contracts` owns public RequestRun/RequestContext/gateway-facing identity fields.
- `agent-common` may own durable scalar vocabulary only when shared across multiple contract subpaths.
- Gateway records own persistence DTO shape; DB rows remain gateway-local private implementation.

实现约束：
- Contract refinement must update runtime schema validation, TypeScript public exports, gateway record mapping and architecture/contract tests together.
- No parallel alias may create two authoritative identity fields in public or persisted facts.
- No client request body, capability input or model output may override trusted Agent identity.
- SQLite row changes must keep owner scope and agent scope explicit on main-path facts.

非目标：
- 不重命名所有 human-readable config ids。
- 不改变 Agent Scope / Owner Scope source of truth。
- 不引入 generic identity registry 或 catch-all id wrapper。
- 不修改 unrelated capability, model or memory semantics。

验收要点：
- Contract tests prove `agentAssemblyRef` is absent where `agentId + agentVersion` is authoritative.
- Gateway mapping tests cover RequestRun/RequestContext identity persistence and scoped sequence/ordinal/version behavior.
- Architecture tests prevent cross-contract subpath dependency introduced only for shared id vocabulary.
- Negative tests cover client/capability/model attempts to override trusted Agent identity.
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict` pass.

并行边界：
- Must be reviewed as contract refinement before implementation changes under `agent-contracts`.
- Can run after core contract and minimal kernel baseline; implementation changes that need this identity model must depend on its frozen contract.
