## 1. Manifest parser 和 metadata schema

- [x] 1.1 扩展 `agent-capability` Skill frontmatter parser，使 `metadata.exclusiveWith`、`metadata.compatibleWith`、`metadata.tags` 支持 YAML block list 和 inline list。
  验证：`npm test -- packages/agent-capability/tests/skill-manifest.test.ts`
  来源：`Skill Manifest Supports Standard And Supported Extension Frontmatter Fields`；design decision 1-3
- [x] 1.2 更新 source metadata validation 和 `SkillMetadataSchema`，只允许上述三个 key 保存 string array，不新增 governed `SkillMetadata` 字段。
  验证：`npm test -- packages/agent-capability/tests/skill-manifest.test.ts`，并断言 mapped metadata 仍通过 `SkillMetadataSchema`
  来源：`Unknown metadata Does Not Carry Governed Meaning`；design decision 4-5

## 2. 正向和负向测试

- [x] 2.1 为 block list、inline list、unsupported array key、空元素或 unsafe 元素添加 Skill manifest 黑盒测试。
  验证：`npm test -- packages/agent-capability/tests/skill-manifest.test.ts`
  来源：spec scenarios `Supported source metadata arrays are accepted`、`Invalid standard fields are rejected`

## 3. 验证和收尾

- [x] 3.1 运行 OpenSpec 和相关 package 验证，确认 change 与实现一致。
  验证：`openspec validate --all --strict`；`npm test -- packages/agent-capability/tests/skill-manifest.test.ts`
  来源：proposal 验证入口；design verification map
- [x] 3.2 检查实现没有引入无关 public behavior、临时 fixture 或未使用代码。
  验证：`git diff --check`；code review 检查 `SkillMetadata` governed fields 未扩展
  来源：design non-goals；实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/skill-manifest-contract/spec.md`。
- 按需更新 `openspec/designs/architecture/skill-manifest-contract.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md`。
- 不更新 `openspec/overview.md`、ADR 或 `openspec/designs/spec-to-design-map.md`。
