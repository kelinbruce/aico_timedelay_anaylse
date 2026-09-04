## 背景和现状（Context）

当前 NextAgent 的 System Prompt 拼装管线中，`communication-style.md` 是 SYSTEM_PROMPT 的一个静态 section，位于 `communication_style` 位置，`systemSectionOrder` 中排在 `task_approach` 之后、`agent_delegation` 之前。section 内容直接来自 markdown 文件，不经过变量解析。

当前 `Locale/language hint` 行由 `ModelInputRenderer.renderSystemMessageText()` 根据 `assembly.request.locale` 生成，追加到所有 sections 末尾。系统缺少两条关键行为约束：
1. 没有指令约束模型的输出语言应跟随用户输入语言。
2. 电信术语保留约束没有进入模型可见的 system prompt 文本。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 `communication-style.md` 末尾追加两条英文规则指令："输出语言跟随用户输入"和"电信术语保留原样"。
- 规则的语言指令优先级高于 `Locale/language hint` 行。
- 不修改 System Prompt 拼装管线、section 排序、variable resolver 或 ModelInputRenderer。

**非目标：**
- 不修改 `ContextEnginePort.render()` 契约或 `RenderedModelInput` 结构。
- 不修改 `ModelInputRenderer.renderSystemMessageText()` 的逻辑。
- 不修改 `agent-contracts/context` 中的任何定义。
- 不新增 runtime 或 channel 层面的 locale 处理逻辑。
- 不创建新 section、新变量或新 TypeScript 导出。

## 设计决策（Decisions）

### 决策 1：规则直接追加到 communication-style.md，而非新增 section + 变量注入

**选择**：将两条英文规则指令文本直接追加到 `communication-style.md` 文件末尾，不新建 section 或 template variable。

**理由**：
1. 语言选择（跟随用户输入）和术语保留方式（电信术语不译）本质上是"模型如何与用户沟通"的延伸，属于 `communication_style` 的语义范畴。追加到现有 section 比创建语义平行但关联松散的新 section 更紧凑。
2. 规则文本是静态常量（~150 字符），不依赖运行时上下文。`runtime`、`environment` 等变量注入模式是因为其内容需要动态数据驱动的渲染，而语言规则不需要。为静态文本引入完整变量注入链路（resolver 注册 + template.yaml 引用 + 可选失败兜底）是过度抽象。
3. 消除管线侵入：不需要改 `systemSectionOrder`、`template.yaml`、`variable-resolver.ts`，编译风险和回归风险降至零。
4. 测试等价：rendering integration test 仍然可以断言 `renderSystemMessageText()` 输出包含规则文本，与变量注入方案的验证能力一致。

**弃用方案**：新建 `language_telecom_rules` section 并通过 `{{ bilingualTelecom? }}` 变量注入（需要改 4 个文件，过度抽象）。

### 决策 2：规则 override 效果通过指令文本实现，而非删除 localeHint

**选择**：语言跟随的 override 效果完全通过规则指令文本实现，不修改 `ModelInputRenderer.renderSystemMessageText()`。

**理由**：
1. localeHint 行保留供诊断和调试使用。
2. 不需要在 render 管线或 context assembly 中引入新的优先级逻辑——只需在指令文本中写明"以用户实际输入语言为准，忽略 locale hint 的语言声明"即可。
3. 0 行修改 `renderSystemMessageText()`。

## 模块归属与数据流

```
communication-style.md (已存在)
  -> 末尾追加英文规则文本（两条指令）

prompt-template-compiler.ts (已有，无需修改)
  -> 读取 communication-style.md -> 规则文本作为 section content 的一部分

prompt-template-assembler.ts (已有，无需修改)
  -> 正常解析 section content，无变量引用

model-input-renderer.ts (已有，无需修改)
  -> renderSystemMessageText() -> 输出包含新规则文本的 section + localeHint
```

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 规则文本来自纯字符串常量，不含用户输入或外部数据，无注入风险。 | code review |
| 性能/容量 | 新增约 150 字符的常量文本，对 token 预算影响可忽略。 | unit test（验证 section content 长度在预期范围内）|
| 可靠性/恢复 | 纯静态文本写入 markdown 文件，无运行时依赖，不存在解析失败路径。 | rendering test |
| 可维护性 | 规则文本直接在 communication-style.md 中，编辑一个文件即可修改。| code review |
| 可测试性 | rendered system message 可断言包含规则文本。 | unit test + rendering test |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `communication-style.md` 末尾包含两条英文指令文本 | 1.1 | `tail -5 communication-style.md` 包含语言跟随和电信术语保留两条英文指令 |
| 渲染后的 system message 包含规则文本 | 2.1 | rendering integration test：`renderSystemMessageText()` 输出包含两条指令文本 |
| localeHint 行不受影响 | 2.2 | rendering integration test：system message 仍包含 `Locale/language hint:` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/telecom-bilingual-output/spec.md`
- 模块设计：`openspec/designs/modules/agent-context-engine.md`（归档前补充规则归属说明）
- ADR：无。

## 风险与取舍（Risks / Trade-offs）

- [取舍] 模型是否遵守指令文本取决于模型本身，当前没有工程手段强制模型输出语言。我们只优化 prompt 指令，无法完全保证模型行为。这是一条实用取舍——大多数 LLM 对明确的语言指令响应良好，且电信术语保留指令与当前模型能力匹配。
- [风险] 规则文本可能与其他 Agent 自定义 prompt section 的指令冲突。-> 缓解：规则写在 `communication-style.md` 中，Agent 自定义 section 可覆盖该 section 但不破坏附加规则文本的意图。

## 迁移计划（Migration Plan）

无。追加规则不改变现有行为，旧 session 的 context 在 compaction 后应用新规则。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/telecom-bilingual-output/spec.md`：新增 telecome-bilingual-output capacity 的稳定行为契约。
- `openspec/designs/modules/agent-context-engine.md`：在 prompt shaping 子模块职责中补充规则归属说明。

## 待确认问题（Open Questions）

无。
