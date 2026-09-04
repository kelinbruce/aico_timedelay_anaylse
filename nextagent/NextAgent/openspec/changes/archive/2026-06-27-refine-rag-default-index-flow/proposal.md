## 背景与问题（Why）

`rag` Tool 已支持 provider-neutral logical `indexes`，并且 app composition 已能向 Tool 注入默认 logical indexes。当前需要把“用户显式指定索引”和“用户未指定索引时使用默认索引”的行为边界写清楚，避免 remote RAG 后续接入时把默认索引误解为 provider 选择、provider-private index binding 或无条件固定 `local`。

本变更的真实问题是：问答中用户可能指定一个或多个业务索引；如果用户没有指定，系统应先用可信配置中的默认 logical indexes 检索；如果默认索引不存在、未 ready 或查询不可用，Tool 应返回安全 reason，让模型反问用户指定可用索引名，而不是返回空成功或私自切换 provider。

## 变更范围（What Changes）

- 明确 `rag` Tool input 中显式 `indexes` 优先于配置默认索引。
- 明确当 Tool input 省略 `indexes` 时，executor 使用 trusted app composition 注入的默认 logical indexes；没有配置时才 fallback `["local"]`。
- 明确默认索引不可用、未 ready、不存在或查询超时时，Tool 返回显式 degraded/unavailable/failed/timeout/canceled 安全结果和低基数 reason。
- 明确 `rag.indexes` 是 app composition 的默认 logical index 配置，只能在 Tool input 省略 `indexes` 时使用，不承载 endpoint、credential、workspace path、SQLite path、raw FTS expression 或 provider-private index binding。
- 不改变 public gateway request/result shape，不新增 Web API、runtime command 或 provider-private remote contract。

## Capability 影响（Capabilities）

### 新增 Capability

- 无。

### 修改的 Capability

- `rag-tool`: 修改 `Tool input is bounded and cannot select authority` 与失败语义，明确显式索引、默认索引和默认索引失败时的行为。
- `app-config-schema`: 修改 app composition 配置基线，声明 `rag.indexes` 的配置所有权和边界。

## 影响范围（Impact）

- `agent-capability`: `rag` Tool 描述与 executor 默认索引语义保持一致；Tool 仍只依赖 `RagRetrievalGateway` 和 invocation context。
- `agent-app`: 继续作为唯一 composition root，将 frozen `rag.indexes` 注入 builtin Tool dependency。
- OpenSpec: 新增 active change delta；实施阶段不直接修改 `openspec/specs/` 长期基线。
- 测试: 需要覆盖显式 indexes 不被默认值覆盖、未指定 indexes 时使用默认值、默认索引安全失败 reason、配置边界与 OpenSpec 校验。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/rag-tool/spec.md`: 归档时合入显式 indexes 优先、默认 logical indexes、默认索引不可用时显式安全失败的行为。
- `openspec/specs/app-config-schema/spec.md`: 归档时合入 `rag.indexes` 的配置所有权和边界。

长期背景：
- `openspec/overview.md`: 无。

设计视图：
- `openspec/designs/architecture/<topic>.md`: 无。
- `openspec/designs/modules/agent-capability.md`: 如已有 RAG Tool 描述入口，可在归档时补充默认索引只来自 composition 注入；没有对应入口则无。
- `openspec/designs/modules/agent-app.md`: 如已有 app composition 配置说明入口，可在归档时补充 `rag.indexes` 注入关系；没有对应入口则无。
- `openspec/designs/adr/<id>.md`: 无。
- `openspec/designs/spec-to-design-map.md`: 无。

验证入口：
- `npm test -- packages/agent-capability/tests/rag-capability.test.ts`
- `npm run test:contract`
- `npm run lint:architecture`
- `npm run build`
- `openspec validate --all --strict`
