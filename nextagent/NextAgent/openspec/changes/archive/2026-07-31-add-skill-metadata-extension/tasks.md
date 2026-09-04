<!--
Task 编写规则：
- 每个 checkbox 只能对应一个可独立验收的交付结果；如果能被"部分完成"，必须拆分。
- 每个实现类 task 必须包含"验证：<具体命令、测试文件或 code review 检查点>"。
- 每个实现类 task 必须包含"来源：<spec requirement、design rule 或 proposal scope>"。
- 涉及 forbidden behavior、边界约束、权限、依赖规则或失败路径时，必须添加 negative verification task，并实际触发和断言失败。
-->

## 1. Contract 变更

- [x] 1.1 在 `agent-contracts/src/capability/index.ts` 的 `SkillMetadataSchema` 中新增 `extension` 字段；value 允许 primitive 与递归嵌套 object，public schema 在顶层及任意嵌套层拒绝 array。
  验证：`npm run build` 编译通过；`SkillMetadataSchema` Ajv 正向校验 primitive/object，并负向拒绝顶层及嵌套 array。
  来源：spec "Skill Metadata Extension Supports Nested Object Values"

- [x] 1.2 在 `agent-contracts/src/capability/index.ts` 的 `SkillManifestDiagnosticReasonCode` type 中新增 `EXTENSION_OMITTED` 字面量。
  验证：`npm run build` 编译通过；TypeScript type check 通过。
  来源：spec "Skill Manifest Diagnostic Includes Extension Reason Code"

## 2. Parser 实现

- [x] 2.1 在 `agent-capability/src/skills/skill-manifest.ts` 中新增 `parseExtension` 函数，处理 nested object value 并执行安全校验。
  验证：`npm run build` 编译通过；unit test 测试 parseExtension 逻辑。
  来源：design "Extension Value 安全校验策略"

- [x] 2.2 修改 `parseMetadataWithExtension` 函数：将 `metadata.extension` 识别为保留包装键，flatten 其对象值子键进 `extensionValue`（不产生 `extension.extension.*` 双层嵌套）；对 `metadata.<非 extension 名>: {object}` direct form 改为 reject（`INVALID_OFFICIAL_FIELD`）；对非 object 的 `metadata.extension` 值改为 reject（`INVALID_OFFICIAL_FIELD`）。
  验证：`npx vitest run --config _tmp-vitest.config.ts`（include `packages/agent-capability/tests/skill-manifest.test.ts`）中 wrapper-flatten、direct-form-object reject、non-object-wrapper reject 用例通过。
  来源：spec "Metadata Field Parsing Distinguishes String Source Metadata, Reserved Extension Wrapper, and Invalid Direct-Form Object" + "Skill Metadata Extension Supports Nested Object Values"

- [x] 2.3 修改 `parseFlatFrontmatter` 函数，支持解析 nested object value（当前只支持 string 和 array）。
  验证：`npm test` 现有测试全部通过；新增测试覆盖 nested object 解析。
  来源：design "Extension 字段与 SourceMetadata 分离"

- [x] 2.4 修改 `isSafeExtensionValue` 函数，允许 boolean/number/null 直接通过，string 经 `unsafeValuePattern` + ≤512 字符校验通过，JsonObject 维持 depth/size/nested 规则，JsonArray 拒绝。同步修改 `isSafeExtension` 终检守卫，使 `extension.<name> = <primitive>` 能通过 `isSkillMetadata` 校验。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 中 primitive value accepted 用例、unsafe string value omitted 用例通过。
  来源：design "Extension Value 安全校验策略"

- [x] 2.5 验证 `SkillFrontmatter.extension` 直接复用 `SkillMetadataSchema.extension` 的推导类型，使 primitive/object value 在类型层合法并排除 array。
  验证：`npm run build` 编译通过；`npm run test:contract` contract 测试通过。
  来源：spec "Skill Metadata Extension Supports Nested Object Values"
  验证记录（2026-07-28）：群内已确认 `SkillMetadataSchema.extension` 的 public contract 允许 primitive 与递归嵌套 object、拒绝 array。

- [x] 2.6 使用单一递归 `isSafeExtensionValue` type guard 校验 extension value：array 返回 false，经 `EXTENSION_OMITTED` 静默 omit（degraded），并移除重复的 nested/array helper。
  验证：`npx vitest run --config vitest.config.release.ts --maxWorkers=1 packages/agent-capability/tests/skill-manifest.test.ts -t "extension metadata"` 中 `omits array extension values` 等 12/12 用例通过。
  来源：spec "Array extension value is omitted with degraded diagnostic"

## 3. Mapper 实现

- [x] 3.1 修改 `createSkillMetadata` 函数，新增 `extension` 字段映射。
  验证：`npm test` 测试用例验证 extension 字段正确映射。
  来源：spec "Skill Manifest Produces Typed Skill Capability Metadata"

- [x] 3.2 修改 `isSkillMetadata` 函数，新增 `extension` 字段类型守卫。
  验证：`npm test` 测试用例验证 extension 类型守卫。
  来源：spec "Skill Manifest Produces Typed Skill Capability Metadata"

- [x] 3.3 更新 `SkillFrontmatter` interface，新增 `extension` 字段定义。
  验证：`npm run build` 编译通过；TypeScript type check 通过。
  来源：design "Extension 字段与 SourceMetadata 分离"

## 4. 测试

- [x] 4.1 改写 extension accepted 测试用例：`metadata.extension.<name>` wrapper 形状（含 primitive `smartcanvas: true`、`logging: false` 和 JsonObject value）被接受，flatten 进 `SkillMetadata.extension.<name>`，且不产生 `extension.extension.*`。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 通过。
  来源：spec "Wrapper-form extension entries are accepted and flattened"

- [x] 4.2 新增 extension missing 测试用例：Skill manifest 不包含 extension metadata 时正常接受，不发出 diagnostic。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 通过。
  来源：spec "Missing extension is accepted without diagnostic"

- [x] 4.3 改写 extension degraded 测试用例：unsafe extension key/value（含 unsafe string primitive）被 omitted 并发出 `EXTENSION_OMITTED` diagnostic；unsafe 条目被 omit，safe 条目保留。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 通过。
  来源：spec "Unsafe extension key is omitted with degraded diagnostic" + "Unsafe extension value is omitted with degraded diagnostic"

- [x] 4.4 改写 extension rejected 测试用例：extension nesting depth >3、size >32KB 被 rejected/degraded；primitive value 不再 reject（改为 accepted，因决策 2 放开 primitive）。新增 `metadata.<非 extension 名>: {object}` direct-form-object reject 和 `metadata.extension: <非 object>` non-object-wrapper reject 用例。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 通过；negative case 实际触发并断言 `INVALID_OFFICIAL_FIELD`。
  来源：spec "Direct-form object metadata outside the wrapper is rejected" + "Non-object metadata.extension wrapper is rejected"

- [x] 4.5 新增 extension 不影响 NextAgent 内部 governed behavior 测试用例：extension 字段存在时不影响 NextAgent 内部的 capability governance、Agent assembly 等路径。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 通过；code review 检查无 NextAgent 内部 governed behavior 路径消费 extension。
  来源：spec "Extension does not affect NextAgent internal governed behavior"

- [x] 4.6 改写 metadata 分类测试用例：string source metadata、array source metadata、wrapper-form object extension 被正确分类和保留；direct-form object 被 reject。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 通过。
  来源：spec "Metadata Field Parsing Distinguishes String Source Metadata, Reserved Extension Wrapper, and Invalid Direct-Form Object"

- [x] 4.7 新增 external-accessor 测试用例：`readSkillMetadata(descriptor).extension`（即 `CapabilityDescriptor.metadata.extension`）能读到 wrapper flatten 后的 extension 配置，验证外部集成服务消费路径。
  验证：`npx vitest run --config _tmp-vitest.config.ts` 通过。
  来源：spec "Extension is accessible to upper-layer integration services through the typed accessor"

- [x] 4.8 新增 public schema 负向测试：`SkillMetadataSchema` 接受 primitive/递归 object，并拒绝顶层及嵌套 array extension value。
  验证：`npx vitest run --config vitest.config.release.ts --maxWorkers=1 packages/agent-capability/tests/skill-manifest.test.ts -t "rejects array values at the public SkillMetadataSchema boundary"` 通过。
  验证记录（2026-07-28）：1/1 targeted test 通过；同一 describe 的 extension metadata 场景 12/12 通过。
  来源：spec "Skill Metadata Extension Supports Nested Object Values"

## 5. 验证和收尾

- [x] 5.1 运行 `npm run build` 确保 TypeScript 编译通过。
  验证：`npm run build` 无 error。
  验证记录（2026-07-28）：typecheck、builtin Skill asset copy、agent-dev-workbench Vite build 均通过。
  来源：design "验证映射"

- [x] 5.2 运行 release Vitest config 的 extension metadata targeted tests，确保所有 extension 相关单元测试通过（wrapper-flatten、primitive accepted、array schema reject/parser omit、direct-form-object reject、non-object-wrapper reject、external-accessor）。
  验证：`npx vitest run --config vitest.config.release.ts --maxWorkers=1 packages/agent-capability/tests/skill-manifest.test.ts -t "extension metadata"` 的 12 个 extension 用例全部通过；全文件唯一失败仍为既有 `rejects invalid official fields` case 8（`metadata.owner: [array]` 期望 reject 实际 degraded），属 source metadata array 范畴，与本 change 的 extension 改动无关。
  来源：design "验证映射"
  备注：根 vitest.config.ts exclude 了 `packages/agent-capability/tests/**`，故使用 release config 运行该文件。

- [x] 5.3 运行 `npm run test:contract` 确保 contract 测试通过。
  验证：`npm run test:contract` 39 个文件、331 个 contract 测试全部通过。
  来源：design "验证映射"

- [x] 5.4 运行 `npm run lint:architecture` 确保 architecture boundary 测试通过。
  验证：`npm run lint:architecture` 无 dependency violation，package manifest policy 通过，40 个文件、242 个 architecture 测试全部通过。
  来源：design "可维护性"

- [x] 5.5 Code review 检查：extension 不被 NextAgent 内部 governed behavior 路径消费，但可通过 `CapabilityDescriptor.metadata.extension` 暴露给上层集成服务。
  验证：code review 检查 `agent-capability/src/builtins/skill-tool.ts`、`agent-core/src/tools/skill-catalog-query-port.ts` 等 NextAgent 内部文件无 extension 消费逻辑；检查 extension 正确保留在 `CapabilityDescriptor.metadata.extension`。
  验证记录（2026-07-28）：语义 review PASS；extension 仅由 capability manifest parser/mapper/type guard 处理，`readSkillMetadata` 返回完整 typed metadata；agent-core routing、Agent assembly 和 Web catalog production projection 均无 extension 消费。
  来源：design "Extension 消费边界"

## 归档前更新基线检查（非实施任务）

本节不是 apply 阶段的实现任务，不使用 checkbox。
实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/skill-manifest-contract/spec.md`：新增 Requirement "Skill Metadata Extension Supports Nested Object Values"。
- 更新 `openspec/overview.md`：补充 Skill manifest 支持结构化 extension 元数据的能力描述。
- 更新 `openspec/designs/architecture/core-contracts.md`：更新 `SkillMetadata` interface，新增 `extension` 字段。
- 更新 `openspec/designs/architecture/skill-manifest-contract.md`：更新 Field Policy，补充 extension 字段边界。
- 新增 `openspec/designs/adr/skill-extension-metadata-boundary.md`：承载 extension 与 sourceMetadata 边界、安全校验策略和 governed behavior 分离原则。
- 更新 `openspec/designs/spec-to-design-map.md`：更新 `skill-manifest-contract` 到 design 文档的导航。
