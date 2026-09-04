## 1. `FN-5.9 调用技能`

- [x] 1.1 更新 directed Skill 真实 payload 回归测试到 `structuredPayload.body + generatedMessages: []` 目标态
  来源：功能行为：`FN-5.9 调用技能` + `Inline Skill 正文必须保持单一隐藏注入` + `成功结果携带单一 Skill 正文`
  验证：在仓库根目录运行 `npx vitest run packages/agent-core/tests/targeted-skill-payload-discard-repro.test.ts --maxWorkers=1`；预期测试通过，并断言 `structuredPayload.body` 存在、`generatedMessages` 为空、不追加 page-hidden USER message。

- [x] 1.2 回归 Skill tool 正文边界、资源投影和用户隐藏行为
  来源：功能行为：`FN-5.9 调用技能` + `Inline Skill 正文必须保持单一隐藏注入` + `用户可见输出不暴露正文`
  验证：在仓库根目录运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-channel-web/tests/conversation-route.test.ts --maxWorkers=1`；预期全部通过，且 Capability result 正文不进入普通用户可见输出。

## 2. Change 整体验证

- [x] 2.1 运行 OpenSpec strict 验证
  来源：proposal 影响范围 + design 验证策略
  验证：在仓库根目录运行 `npx openspec validate --all --strict`；预期全部通过。

## 归档前更新基线检查（非实施任务）

- 归档时同步 `skill-tool` stable spec 与 FN-5.9 长期设计文档。
- 确认长期文档不再描述 hidden generated message 作为当前 inline Skill 正文传输方式。
- 确认用户可见投影边界与 Skill body 安全边界没有重复定义。
