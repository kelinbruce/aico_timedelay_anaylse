## 背景与问题（Why）

当前 `SKILL.md` manifest 的 `metadata` 只接受 string-to-string map。Skill 作者在声明天然多值的 metadata 时，例如 `exclusiveWith`、`compatibleWith` 或 `tags`，只能写成逗号分隔字符串。这个写法不符合 YAML authoring 直觉，也让多值维护、diff 和后续机器处理变得脆弱。

本次问题发生在 Skill manifest contract 的解析边界：`metadata` 中出现数组值时会被判定为 `INVALID_OFFICIAL_FIELD`，即使数组元素都是安全字符串。需要在 contract 中明确哪些 metadata key 可以使用字符串数组，并让 parser 对这些 key 接受 YAML block list 与 inline list 写法。

## 变更范围（What Changes）

- `metadata` 继续是受治理的 manifest 字段，默认仍要求未知 key 使用安全字符串值。
- 仅允许以下 source metadata key 使用字符串数组值：`exclusiveWith`、`compatibleWith`、`tags`。
- 数组值必须是非空安全字符串元素，元素长度和敏感信息过滤沿用 safe source metadata 约束。
- parser 需要接受 YAML block list 和 inline list 两种写法，例如：
  - `exclusiveWith: [skill-a, skill-b]`
  - `exclusiveWith:` 后接缩进的 `- skill-a`、`- skill-b`
- 这些数组 key 在本 change 中只作为 safe source metadata 保留，不新增互斥、兼容、标签治理行为，也不扩展 `SkillMetadata` 的 governed fields。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `skill-manifest-contract`: 修改 `metadata` frontmatter shape 和 unknown/source metadata preservation 规则，允许受治理的 source metadata 数组键。

## 影响范围（Impact）

- `openspec/changes/allow-skill-manifest-metadata-arrays/specs/skill-manifest-contract/spec.md`: 增量定义 metadata 数组 key 的 contract。
- `packages/agent-capability/src/skills/skill-manifest.ts`: frontmatter parser、metadata shape validation、safe source metadata preservation。
- `packages/agent-capability/tests/skill-manifest.test.ts`: 覆盖 block list、inline list、非法数组 key 和非法数组元素。
- 不修改 `agent-contracts/capability` 中 `SkillMetadata` 的 governed fields；数组值只留在 `sourceMetadata` 内。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/skill-manifest-contract/spec.md`: 归档时合并 metadata 数组 key 的 shape、校验和 source metadata preservation 规则。

长期背景：
- `openspec/overview.md`: 无。

设计视图：
- `openspec/designs/architecture/skill-manifest-contract.md`: 归档时补充 parser 对受治理 source metadata 数组键的边界说明。
- `openspec/designs/modules/agent-capability.md`: 归档时补充 `agent-capability` manifest parser 支持的 metadata value shape。
- `openspec/designs/adr/<id>.md`: 无。
- `openspec/designs/spec-to-design-map.md`: 无。

验证入口：
- `npm test -- packages/agent-capability/tests/skill-manifest.test.ts`
- `openspec validate --all --strict`
