## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.9 调用技能` | 将 inline Skill 正文从 hidden generated message 收敛为同一 `structuredPayload.body`，并保持用户不可见。 | `skill-tool` | `FN-5.9 调用技能` |

## `FN-5.9 调用技能`

### 目标与规范依据

inline Skill 成功结果必须只携带一份 canonical 正文，模型可读，用户不可见。目标态与当前生产实现一致，但 stable spec 和 directed Skill 回归测试仍停留在旧的 hidden generated message 形态。

#### 本 Function 的目标 Requirements

canonical spec：`skill-tool`

- `MODIFIED`：`Inline Skill 正文必须保持单一隐藏注入`

### 当前实现

- `agent-capability` 的 `Skill` tool 成功时返回 `structuredPayload: { name, status, body }`。
- `generatedMessages` 为空。
- Web conversation projection 对 `CAPABILITY_RESULT` 内容返回空字符串，公共 metadata 只保留 capability result kind、toolCallId 和 toolName。
- 既有 `skill-tool` tests 已断言 `structuredPayload.body` 和空 `generatedMessages`。
- `targeted-skill-payload-discard-repro.test.ts` 仍断言旧形态，当前在 `main` 上失败。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 规格描述 `structuredPayload.body` 目标态 | stable spec 仍要求 hidden generated message | 更新 stable spec delta |
| `generatedMessages` 为空 | 生产代码和 `skill-tool` tests 已满足 | 更新 directed Skill stale test |
| 用户不可见正文 | conversation projection 已隐藏 Capability result 内容 | 用回归测试锁定 |
| 资源提示和安全边界 | 既有 `skill-tool` tests 已覆盖 | 不重复设计，运行既有测试 |

### 修改方案

本 change 不修改生产代码。生产实现已经是目标态；实施只做两件事：

1. 用 `skill-tool` delta Requirement 固化 `structuredPayload.body + generatedMessages: []` 目标态。
2. 更新 `targeted-skill-payload-discard-repro.test.ts`，删除旧 page-hidden USER message 断言，改为断言：
   - `structuredPayload` 包含 `name`、`status` 和 `body`;
   - `body` 含 canonical `<skill_content>` envelope 和受治理资源提示；
   - `generatedMessages` 为空；
   - 不追加 page-hidden USER Skill body message；
   - 用户可见 projection 不展示 body。

既有 `skill-tool` tests 继续覆盖资源根、wrapper boundary、source-private path 和编码等安全行为，不在本 change 重复实现。

## 验证策略（Verification Strategy）

- **unit**：运行 directed Skill 真实 payload 回归测试，断言新契约。
- **contract**：运行 `skill-tool` tests，确认正文边界、资源投影和安全检查不回归。
- **architecture**：运行 architecture gate，确认没有引入新的 owner 或跨 package private path。
- **OpenSpec**：运行 strict validation。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/skill-tool/spec.md`：修改 inline Skill 正文承载 Requirement。
- `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.9-调用技能.md`：更新调用结果与 inline body 规格。
- `openspec/designs/features/`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/`：无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无新增导航。

## 风险与取舍（Risks / Trade-offs）

- **正文驻留 tool result**：模型可见性和用户隐藏依赖 conversation/stream 投影边界；需要保持既有测试并防止未来把 raw Capability result 内容直接透出。
- **旧 history 兼容**：旧运行可能存在 page-hidden USER message；本 change 不回填或迁移，读取路径继续按既有 message 语义处理。
- **契约收敛**：不恢复旧实现，明确选择当前更简单的单一 result payload 形态，避免 consume-once 和重复消息问题。

## 待确认问题（Open Questions）

无。
