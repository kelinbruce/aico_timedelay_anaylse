## 背景与问题（Why）

Skill 披露目前由 `DefaultModelInputRenderer.renderSystemMessageText`（`model-input-renderer.ts`）硬编码渲染：`renderSkillDisclosure`（`list` 模式）和 `renderSkillToolSearchDisclosure`（`tool-search` 模式）在模板 section block 之后追加 `### Available skills` 列表和 `### How to use skills` 指令文本。两段指令文本是纯静态英文串，每次请求逐字相同，但完全无法定制：Agent 不能通过自身 prompt 模板调整 Skill 使用指导的措辞、详略或领域侧重。

与此同时，builtin SYSTEM_PROMPT 已具备成熟的 per-Agent 定制机制：Agent package `prompts/SYSTEM_PROMPT/` 经 `mergeSections` 以同 id 覆盖 builtin section、缺省回落（`network-explorer` 已实际整体覆盖 `tooling.md`）。`memory` section 先例（2026-06-30 change）也验证了"新增 builder-owned section + 可信投影条件渲染"的路径。Skill 使用指导却游离在这套机制之外，是当前 system prompt 中唯一不可由 Agent 定制的工具使用指导面。

现状还有两个伴随缺口：

1. **同形同策缺口**：skill 列表在 system prompt 中出现两次——`tooling.md` 末尾的 `{{ enabledSkills? }}` 变量（消费 `enabledCapabilities` 投影）和 renderer 硬编码的 `### Available skills`（消费 post-patch 的 `visibleCapabilities`，含完整门控过滤）。同一语义事实两个 owner、两套数据视图、两套过滤规则。
2. **缓存边界缺口**：静态的指令文本被追加在 CACHE_BOUNDARY 标记之后，落在 dynamic 区，每请求都无法享受 stable 前缀的 KV-cache 语义（实际文本不变，纯浪费）。

## 变更范围（What Changes）

- 新增 builder-owned system section `skill_disclosure`，加入 `systemSectionOrder`（位置在 `memory` 之后、`action_safety` 之前）与 `dynamicSystemSections`，渲染在 CACHE_BOUNDARY 之后、与现状位置语义一致。
- builtin `SYSTEM_PROMPT` 模板新增 `skill-disclosure.md` 内容文件，承载默认的 `### Available skills` / `### How to use skills` 英文结构：列表占位变量 + 指令正文。
- 新增两个安全投影变量：`skillDisclosureList`（policy 层按现有可见性门控过滤后渲染的 skill bullet 列表，含 heading 语义的正文占位）与 `skillDisclosureMode`（值为 `list` / `tool-search`，供覆盖模板按模式差异化定制）。
- builtin `skill-disclosure.md` 按 `skillDisclosureMode` 提供两套默认指令正文；覆盖即接管——Agent 覆盖该 section 后，模式感知由覆盖方自行负责（可在覆盖内容中引用 `{{ skillDisclosureMode }}`）。
- Skill tool 可见性门控改为 render filter：`Skill` tool 不可见或 skill 列表为空时 system render policy 过滤整个 `skill_disclosure` section（与 `memoryEnabled` 过滤 `memory` 同构），Agent 覆盖内容无法绕过该门控。
- 删除 `model-input-renderer.ts` 中 `renderSkillDisclosure` / `renderSkillToolSearchDisclosure` 两段硬编码指令文本与 skill 列表渲染；列表过滤逻辑迁至 variable resolver / policy 层，数据源统一为 post-patch 的 `visibleCapabilities`。
- 收敛重复列表：`tooling.md` 移除 `{{ enabledSkills? }}` 引用，`enabledSkills` 变量从变量注册表删除，`PromptAssemblyRequest.enabledCapabilities` 投影随之下线；skill 列表在 system prompt 中只出现一次。

非变更：

- 不改变 Skill tool 的任何执行契约（解析、dispatch、args 校验、inline envelope、acknowledgement）。
- 不改变 `skillDisclosureMode` 配置的取值、默认值（`list`）和现有 wire 路径（config → context engine deps）。
- 不改变 CLIP/agent/attachment disclosure 的渲染方式（它们保持 renderer-owned；如需模板化属后续独立 change）。
- 不把 `skillDisclosureMode` 加入模板 `match` 选择维度。
- 不让 `skill-disclosure.md` 内容参与模型选择、模板选择或 model options 交接。
- **BREAKING**：对 builtin 默认路径无 breaking（渲染产物逐字不变）；`enabledSkills` 变量删除对 Agent 模板是编译期 fail-closed（未知变量 `PROMPT_VARIABLE_UNKNOWN`），当前仓库无 Agent 模板引用该变量，属受控 breaking，需在 change 归档说明。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `skill-tool`：`Skill disclosure 使用固定英文 prompt 格式` Requirement 改写——披露 section 改为由 builtin `skill_disclosure` 模板 section 承载，Agent 可经既有 agent-over-builtin 覆盖机制定制；门控（Skill tool 可见性、列表为空省略）和列表格式契约不变。
- `prompt-template-assembly`：builder-owned system section 集合新增 `skill_disclosure`（dynamic 区）；新增 `skillDisclosureList` / `skillDisclosureMode` 受治理变量；删除 `enabledSkills` 变量与 `enabledCapabilities` 投影；system render policy 新增 skill disclosure 条件过滤。

## 影响范围（Impact）

- 代码：
  - `packages/agent-context-engine/src/prompt-shaping/prompt-template-purpose-policy.ts`：`systemSectionOrder` / `dynamicSystemSections` 插入 `skill_disclosure`；`SystemSectionRenderFilters` 增加 skill disclosure 门控字段；`orderSections` 过滤逻辑。
  - `packages/agent-context-engine/src/prompt-shaping/variable-resolver.ts`：新增 `skillDisclosureList` / `skillDisclosureMode` 变量，删除 `enabledSkills`。
  - `packages/agent-context-engine/src/prompt-shaping/model-input-renderer.ts`：删除两段硬编码 disclosure 及 `skillDisclosureMode` renderer option；`renderSystemMessageText` 相应简化。
  - `packages/agent-context-engine/src/prompt-shaping/prompt-template-types.ts` / `prompt-template-assembler.ts`：渲染上下文增加 skill disclosure 投影；移除 `enabledCapabilities`。
  - `packages/agent-context-engine/src/assembly/assemble-context.ts`：向装配请求传递 skill disclosure 门控与模式投影；移除 `enabledCapabilities` 传递。
  - `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/`：新增 `skill-disclosure.md`（两套模式正文），`template.yaml` 注册 section，`tooling.md` 移除 `{{ enabledSkills? }}`。
  - `packages/agent-app/src/composition/context-engine-composition.ts`：`skillDisclosureMode` 从 renderer option 改为传入装配投影。
- 契约：`PromptAssemblyRequest` 变更（增投影、删 `enabledCapabilities`）；渲染产物对 builtin 默认路径逐字不变。
- 配置：无新配置项；`capability-disclosure.skill-disclosure-mode` 语义不变。
- 测试：`skill-disclosure-render.test.ts` 重写断言目标（模板产物 + 门控 + 覆盖定制）；`prompt-shaping.test.ts`（section 顺序、marker、变量）；`tests/architecture/prompt-template-assembly-boundary.test.ts`（白名单）；`tests/smoke/framework-capability.smoke.test.ts`、`tests/e2e/p1-p2-scenario-gate/routing-child-agent.test.ts` 回归确认。
- 运维：无。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/skill-tool/spec.md`：改写 `Skill disclosure 使用固定英文 prompt 格式` Requirement（模板承载 + Agent 定制 + 门控不变）。
- `openspec/specs/prompt-template-assembly/spec.md`：新增 `skill_disclosure` section Requirement；修改变量注册表与 `Prompt assembly has one decision boundary`（投影集合变更）。

长期背景：

- `openspec/overview.md`：无（能力面无变化）。

设计视图：

- `openspec/designs/architecture/prompt-template-assembly.md`：更新"capability disclosure 留在通用模板渲染之外"表述——skill 披露经 purpose-specific owner 的安全投影变量进入模板。
- `openspec/designs/modules/agent-context-engine.md`：补 `skill_disclosure` section、两个投影变量与门控过滤落点。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：检查导航是否需更新。

验证入口：

- `packages/agent-context-engine/tests/skill-disclosure-render.test.ts`：默认渲染、门控省略、模式差异、Agent 覆盖。
- `packages/agent-context-engine/tests/prompt-shaping.test.ts`：section 顺序、CACHE_BOUNDARY 位置、变量解析。
- `tests/architecture/prompt-template-assembly-boundary.test.ts`：白名单与负例。
