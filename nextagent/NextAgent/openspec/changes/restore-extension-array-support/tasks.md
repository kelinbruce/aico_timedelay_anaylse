# Tasks

## 1. 恢复 extension 数组支持

### 1.1 skill-manifest.ts

- [ ] 1.1.1 恢复 `isSafeExtensionValue` 中 `Array.isArray(value)` 分支：允许安全字符串数组（每个元素为 string、长度 <= 512、不匹配 `unsafeValuePattern`）。
  验证：`packages/agent-capability/src/skills/skill-manifest.ts`

### 1.2 agent-contracts

- [ ] 1.2.1 恢复 `SkillExtensionValue` 类型定义包含 `readonly string[]`。
  验证：`packages/agent-contracts/src/capability/index.ts`

- [ ] 1.2.2 恢复 `SkillExtensionValueSchema` 增加 `Type.Array(Type.String({ maxLength: 512 }), { maxItems: 64 })` 分支。
  验证：同文件

## 2. 基线 spec 更新

### 2.1 skill-manifest-contract spec

- [ ] 2.1.1 更新 extension 值类型描述：从"不允许数组"改为"允许安全字符串数组（每个元素为 string、长度 <= 512、不匹配 unsafe value pattern、数组最大长度 64）"。
  验证：`openspec/specs/skill-manifest-contract/spec.md`

## 3. 测试修复

### 3.1 skill 相关测试

- [ ] 3.1.1 修复因数组支持恢复导致的测试失败（如果有）。
  验证：`npx vitest run packages/agent-capability/tests/skill-tool.test.ts --config vitest.config.release.ts`
