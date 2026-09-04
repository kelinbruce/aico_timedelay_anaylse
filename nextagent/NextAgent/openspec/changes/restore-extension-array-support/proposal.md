## Why

Skill extension 字段 `api_header_params` 和 `api_request_params` 需要以数组形式传递多个值（如 header 名列表）。commit `18130774e`（guanyuanchao）实现了对安全字符串数组的支持，但 commit `511494b77`（Gongxuping）在 release 修复时将其回退为 `return false`，导致数组值再次被拒绝。

## 目标与非目标

**目标：**

- 恢复 `isSafeExtensionValue` 对安全字符串数组的支持。
- 恢复 `SkillExtensionValue` 类型定义和 schema 包含 `readonly string[]`。
- 同步更新基线 spec，允许 extension 值为安全字符串数组。
- 修复受影响的测试用例。

**非目标：**

- 不改变 extension key 的校验规则（`unsafeKeyPattern`、`reservedExtensionKeys`、`extensionKeyWhitelist` 不变）。
- 不改变非数组值的校验规则。
- 不改变 `skill-tool.ts` 中对数组值的消费逻辑（已支持 string 和 array 两种格式）。

## What Changes

- **MODIFIED**: `skill-manifest-contract` spec 中 extension 值类型从"不允许数组"改为"允许安全字符串数组"。
- 恢复 `skill-manifest.ts` 中 `isSafeExtensionValue` 的数组支持分支。
- 恢复 `agent-contracts` 中 `SkillExtensionValue` 类型和 schema 的 `readonly string[]`。
- 修复因数组支持变更导致的测试用例。

## Feature 影响

无。数组支持是已设计的行为，本 change 恢复其正确实现。

## Function 影响

### 修改的 Function

- `FN-3.2 Skill 清单校验` → `specs/skill-manifest-contract/spec.md`
  - 功能边界：extension 值类型从"仅 primitive + Map"扩展为"primitive + Map + 安全字符串数组"。
  - 系统质量属性：可维护性
  - 映射说明：canonical spec `skill-manifest-contract`

## 影响范围

- **Skill 开发者**：可以在 `extension` 中使用 YAML 列表语法传递字符串数组（如 `api_header_params: [x-user-id, x-user-name]`）。
- **受影响代码**：`skill-manifest.ts`（`isSafeExtensionValue`）、`agent-contracts/capability/index.ts`（`SkillExtensionValue` 类型和 schema）。
- **受影响测试**：skill 相关测试用例。
