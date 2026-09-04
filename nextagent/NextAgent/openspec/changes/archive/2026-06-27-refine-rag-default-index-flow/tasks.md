## 1. RAG Tool 默认索引语义

- [x] 1.1 实现 `rag` Tool 显式 indexes 优先：当模型传入 `indexes` 时，executor 只使用该列表，不追加或替换为默认 indexes。
  验证：`npm test -- packages/agent-capability/tests/rag-capability.test.ts`
  来源：`rag-tool` Requirement: Tool input is bounded and cannot select authority；design 决策 2
- [x] 1.2 实现省略 indexes 时使用 app composition 注入的默认 logical indexes；未注入时 fallback `["local"]`。
  验证：`npm test -- packages/agent-capability/tests/rag-capability.test.ts`
  来源：`rag-tool` Requirement: Tool input is bounded and cannot select authority；design 决策 1
- [x] 1.3 在 Tool 描述中声明默认索引失败时应反问用户指定可用索引名，不在 Tool 内自动切换 provider 或猜测其他索引。
  验证：code review 检查 `packages/agent-capability/src/builtins/rag/rag-tool.ts` 描述和 executor 无 provider 选择逻辑
  来源：`rag-tool` Requirement: Failures and degradation are explicit；design 决策 3
- [x] 1.4 实现 RAG retrieval provider 从 trusted `gatewaySelection` 中选择：启用的 `rag-knowledge` LOCAL entry 接线 local governance，REMOTE 未实现时 fail closed。
  验证：`npm run build`、`npm run test:contract`、config assembly/gateway contract 相关测试
  来源：`rag-tool` Requirement: Tool input is bounded and cannot select authority

## 2. App 配置边界

- [x] 2.1 实现 `rag.indexes` startup config validation：1-5 个唯一 safe logical index names，缺省为 `["local"]`。
  验证：`npm test` 或覆盖 config assembly 的现有配置测试；`npm run build`
  来源：`app-config-schema` Requirement: App composition schema exposes a stable first-release group baseline；design 决策 4
- [x] 2.2 验证非法 `rag.indexes` fail closed，不允许空列表、重复值、unsafe 名称或超限数量进入 frozen config。
  验证：config assembly 测试或 code review 检查 startup validation schema
  来源：`app-config-schema` Requirement: App composition schema exposes a stable first-release group baseline；design 决策 4

## 3. OpenSpec 放置和验证

- [x] 3.1 将默认索引行为规格放在 active change delta 中，实施阶段不直接修改 `openspec/specs/` 基线文档。
  验证：`git diff --name-only origin/main...HEAD | Select-String '^openspec/specs/'` 无输出；`openspec validate --all --strict`
  来源：proposal 变更范围；design 目标
- [x] 3.2 运行 RAG 相关验证和常规门禁，确认实现与 active change 规格一致。
  验证：`npm test -- packages/agent-capability/tests/rag-capability.test.ts`、`npm run build`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`
  来源：design 验证映射

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/rag-tool/spec.md`。
- 同步 `openspec/specs/app-config-schema/spec.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md`。
