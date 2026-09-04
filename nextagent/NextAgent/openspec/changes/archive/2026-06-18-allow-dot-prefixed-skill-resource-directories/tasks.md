- [x] 1. 更新 `WorkspaceFilePort` Skill resource projection 路径过滤，允许 `.xxx` 目录段和 root-level `.hidden/skip.py`，同时继续拒绝空段、`.`、`..`、越界路径和不安全资源路径。
  来源：`skill-resource-access` requirement "Skill resource projection SHALL publish only eligible governed resources"。
  验证：`npm test -- packages/agent-capability/tests/skill-resource-projection.test.ts`。

- [x] 2. 增加 projection 回归测试，断言 `assets/.schemas/chatbi.yaml` 和 root-level `.hidden/skip.py` 会被投影并可通过授权 Skill resource path 读取，`.nextagent/skills/.staging` 和 `.locks` 仍未授权。
  来源：design 安全和可测试性结论。
  验证：`npm test -- packages/agent-capability/tests/skill-resource-projection.test.ts`。

- [x] 3. 执行 OpenSpec strict 校验和相关构建校验，确认规格 delta 与代码变更一致。
  来源：proposal 验证入口。
  验证：`openspec validate --all --strict`、`npm run build`。

- [x] 4. 扩展 Skill source 资源枚举，支持 `api/` 顶层目录下的安全资源，并保持 package cache 等不安全目录过滤。
  来源：`skill-resource-access` requirement "Skill resource projection SHALL publish only eligible governed resources"。
  验证：`npm test -- packages/agent-capability/tests/builtin-skill-source.test.ts packages/agent-capability/tests/local-skill-source.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts`、`openspec validate --all --strict`。
