---
name: nextagent-recipe-to-skill
description: 根据现有 NextAgent recipe 生成内置 recipe reference 的 Skill，或在没有 recipe 时根据 Skill 描述和已确认的工具用法生成 Skill。用于 recipe 到 Skill 转换和领域 Skill 创建；不用于保留确定性 workflow 运行语义的迁移。
metadata:
  version: "1.2.0"
---

# NextAgent Recipe to Skill

生成一个符合当前 NextAgent manifest、Skill resource 和 capability governance 边界的目标 Skill。只支持两个场景，并按输入事实选择其一。

开始前完整读取 [开发指南](references/development-guide.md)。

修改本转换 Skill、示例或节点映射后，在 NextAgent 仓库根目录运行 `node docs/developer/nextagent-recipe-to-skill/scripts/validate-examples.mjs`。该脚本是开发期回归门禁，不是目标 Skill 的运行步骤；脚本只使用公开 package exports。如果同一提交修改了相关 runtime source，先运行 `npm run build:runtime` 刷新这些 exports 背后的 `dist` contract。

## 场景选择

1. 用户提供 recipe 文件、recipe 内容或明确 recipe 路径时，使用“场景一：recipe 内置到 Skill”。
2. 用户没有提供 recipe，只提供 Skill 描述、目标和工具使用要求时，使用“场景二：描述与工具生成 Skill”。
3. 不得同时生成两套候选方案。输入不足但可从当前目标目录、Agent 配置或 capability catalog 安全确认时直接确认；无法确认会改变目标行为、Agent Scope 或工具权限的事实时再向用户提问。

## 共同行为

1. 确定目标 Skill 名称和输出位置：
   - `name` 使用小写 kebab-case，长度不超过 64，并与 Skill 目录名完全一致。
   - 优先使用用户指定目录。
   - 用户未指定 durable 目录时，生成到当前 execution scope 的 `generated-skills/<skill-name>/`，并明确这不是全局安装。
2. 生成当前 contract 支持的 frontmatter：至少包含 `name` 和同时说明“做什么、何时使用”的 `description`；durable Skill 增加 `metadata.version`；当前版本使用 `context: inline`。
3. 只有用户或当前 Agent 装配明确要求直接选择时才写 `user-invocable: true`；只有允许模型编排时才写 `model-invocable: true`。
4. `allowed-tools` 只列已确认且目标 Skill 会实际调用的 canonical tool name，并使用空格分隔字符串。它只收窄工具，不授予 capability 权限；不得通过 Skill 扩大 Agent binding、Owner Scope 或 Agent Scope。
5. 默认只创建完成任务需要的文件。不得添加 README、占位目录、重复模板或未被正文使用的资源。
6. 不删除、覆盖或移动源 recipe，除非用户明确要求且转换验证已证明没有 workflow runtime 保证被丢失。

## 场景一：recipe 内置到 Skill

目标形态：

```text
<skill-name>/
|-- SKILL.md
`-- references/
    `-- recipe.yaml
```

执行步骤：

1. 使用当前 `RecipeDefinitionSchema` 和 loader 语义理解 recipe；旧版 `name + nodes` 先按当前 loader 归一化，不把旧字段传播为新的 Skill contract。
2. 建立转换清单：触发条件、必需输入、领域步骤、决策准则、Tool/Skill/Agent/knowledge 依赖、输出、失败语义和 runtime 保证；同时为每个节点建立 `nodeId | nodeType | sourceEffect | targetKind | target | evidence` 映射。
3. 检查是否含不能内置为 Skill 指令的语义：
   - `boot-recipe` 启动生命周期；
   - 精确 branch/join、parallel、loop、batch、subflow、delay、interrupt；
   - checkpoint、resume、cancel、pending input；
   - runtime 强制的 retry、timeout、exception、顺序、节点状态或 exactly-once side effect；
   - 安全 guardrail、必须由 runtime schema 强制的输入输出，或没有等价 governed capability 的节点效果。
4. 命中任一项时停止转换，返回 `RECIPE_REQUIRES_WORKFLOW`，列出决定性节点或字段。不得把 workflow 状态机降级为提示词，也不得偷偷生成 companion Skill。
5. 未命中时：
   - 把 recipe 规范化为不含 secret、credential、host path 和 provider-private 数据的 `references/recipe.yaml`；
   - 在目标 `SKILL.md` 中把 recipe 的业务意图收敛为目标、输入、执行准则、工具使用、失败处理和输出验收；
   - 明确 `references/recipe.yaml` 是只读指导资源，不会被注册或执行为 Workflow；
   - 正文必须能指导模型完成任务，不能只写“读取 recipe 并照做”。
6. 如果源 recipe 含敏感或运行时私有字段，停止并报告具体字段类别；未经用户确认不得静默删除或改写这些事实。

### 节点到目标的映射

每个节点必须且只能归入以下一种 `targetKind`：

- `TOOL_CALL`：目标 Skill 会调用已确认、已绑定且模型可见的 Tool；`target` 写 canonical tool name，并加入 `allowed-tools`。
- `INSTRUCTION`：节点效果由 Skill 的步骤、判断准则或失败规则表达；不产生 Tool。
- `OUTPUT`：节点效果进入输出格式或完成条件；不产生 Tool。
- `WORKFLOW_ONLY`：节点依赖 workflow runtime 保证；整次转换返回 `RECIPE_REQUIRES_WORKFLOW`。
- `UNSUPPORTED`：当前 handler、输入字段或等价 capability 无法确认；返回 `RECIPE_REQUIRES_WORKFLOW` 并列出缺失证据，不根据节点名称猜 Tool。

使用当前实现核对语义，而不是按节点名称机械映射：

- `START` 映射为输入和触发条件，`END`/`DISPLAY` 映射为输出。
- LLM、识别、改写、翻译、参数提取和普通分析映射为 `INSTRUCTION`；`DATA_ANALYSIS` 只有在目标步骤确实执行代码且 `Python` 已绑定时才额外产生 `Python` Tool 调用。
- `RESTFUL` 只有在 `inputs.api_name` 指向模型可调用且已绑定的 capability 时才映射到该 canonical name；`PYTHON` 映射到 `Python`；`AGENT` 映射到 `Agent`，并保留受信任的 agent 选择约束。
- `TOOL_CHOICE`、`API_CHOICE` 和 `RECIPE_CHOICE` 只表达选择，不能把候选项全部视为已调用 Tool；选择后的真实调用必须有独立映射和权限证据。
- knowledge 节点只有存在等价、已绑定的模型可调用 Tool 时才映射为 `TOOL_CALL`，否则为 `UNSUPPORTED`。
- `USER_CHECK` 仅在普通即时澄清时可映射到已绑定的提问 Tool；涉及 pending input、`WAITING` 或 resume 时为 `WORKFLOW_ONLY`。
- guardrail、parallel/join、loop、batch、subflow、delay、interrupt、checkpoint、resume 和精确 runtime branch 均为 `WORKFLOW_ONLY`。
- schema 中出现但当前 node catalog 未注册 handler 的节点类型不得转换为 Tool，必须标记 `UNSUPPORTED`。

`allowed-tools` 等于所有 `TOOL_CALL.target` 去重后的集合，不等于 recipe 中所有 Tool-like 节点或候选工具的集合。完整映射表写入生成报告；默认不为它额外创建文件。

## 场景二：描述与工具生成 Skill

目标形态默认只有：

```text
<skill-name>/
`-- SKILL.md
```

执行步骤：

1. 从用户输入提取：Skill 目标、触发场景、必需输入、期望输出、失败行为和工具使用要求。
2. 对照当前 capability catalog、Agent binding 或工具 contract 确认 canonical tool name、输入和可观察结果；不得根据自然语言名称猜测工具 id。
3. 如果用户只给出工具名称但未给出使用顺序，按完成目标所需的最短数据流组织步骤；不得发明额外 Tool、配置项、扩展点或外部 side effect。
4. 生成 `SKILL.md`：
   - frontmatter `description` 精确说明能力和触发条件；
   - “输入与前置条件”说明缺失信息的澄清或拒绝行为；
   - “执行步骤”说明每个工具何时调用、使用什么已授权输入、如何消费结果；
   - “失败与降级”禁止编造工具结果，保留安全错误并说明可继续路径；
   - “输出”定义用户或下游可观察的结果和质量标准。
5. 没有实际消费方时不创建 `references/`、`scripts/` 或 `assets/`。

## 黑盒效果

把转换动作和生成后 Skill 的运行效果分开报告：

1. 转换阶段：
   - 可转换 recipe：先通过全部转换门禁，再生成完整的 `SKILL.md + references/recipe.yaml`，并返回逐节点映射；源 recipe 保持不变。
   - 描述与工具：只生成 `SKILL.md`，并返回工具使用映射；不得创建 recipe。
   - 命中 `WORKFLOW_ONLY` 或 `UNSUPPORTED`：统一返回 `RECIPE_REQUIRES_WORKFLOW`，并分别列出所需 runtime 保证或缺失的节点语义证据；不创建部分目标 Skill。
   - 缺少会改变行为或权限的输入：请求补充信息，在确认前不生成、不猜测。
2. 目标 Skill 被安装并调用后：
   - runtime 发现的是一个普通 Skill；场景一的 `recipe.yaml` 只作为模型可读 reference，不会注册或启动 Workflow。
   - 模型按 `SKILL.md` 执行业务步骤；存在 `allowed-tools` 时，可见工具是当前 Agent binding 与该列表的交集；省略该字段时不改变 Agent binding，正文仍不得执行映射表之外的 Tool 调用。
   - 不产生 recipe execution、node state、checkpoint、pending input、resume 或 workflow terminal commit。
   - 转换不授予 Tool 权限，不改变 Agent Scope、Owner Scope、routing、capability binding 或源 recipe 生命周期。

生成报告必须包含一行 `Black-box effect`，说明调用目标 Skill 时用户可观察到的结果；一行 `Effective tool calls`，列出映射后确实需要且已确认绑定的 Tool；同时包含一行 `Explicit non-effects`，列出没有发生的 Workflow 注册/执行、授权、安装、切流和源文件删除。

## 验证

完成前至少验证：

1. manifest frontmatter 可解析，字段属于当前 contract，`name` 与目录名一致。
2. Skill body 不包含 host 绝对路径、具体 credential、raw provider error 或 provider-private source facts。
3. 场景一存在且仅存在 `references/recipe.yaml` 这一份内置 recipe reference，正文明确其非 Workflow 执行语义；场景二不创建 recipe 文件。
4. 所用 Tool 在目标 Agent Scope 可发现且已绑定；`allowed-tools` 没有被误当成授权来源。
5. 每个 recipe 节点恰有一个映射结果，`allowed-tools` 与全部 `TOOL_CALL.target` 的去重集合完全一致；`WORKFLOW_ONLY` 或 `UNSUPPORTED` 没有被生成文本掩盖。
6. 至少验证一个正常场景和一个缺失输入、Tool 失败或依赖不可用场景。
7. 如目标进入产品仓库，按影响范围运行 Skill manifest、local source、相关 E2E 和 architecture gate；只生成文档源 Skill 时，报告未运行的产品测试。
8. 不得把结构/parser 通过表述为模型业务效果通过；没有在真实 Agent 装配中执行目标 Skill 时，明确报告行为 E2E 未验证。

## 输出报告

报告以下事实后停止：

- `Scenario: RECIPE_EMBEDDED | DESCRIPTION_AND_TOOLS`
- 目标 Skill 名称和完整路径
- 创建的 `SKILL.md` 及资源文件
- 场景一的逐节点映射表，以及由 `TOOL_CALL` 推导出的 `allowed-tools`
- 使用的 Tool 与权限前提
- `Black-box effect` 与 `Explicit non-effects`
- 验证命令和结果
- recipe 是否只作为 reference 内置，或因 `RECIPE_REQUIRES_WORKFLOW` 未转换
- 未获授权的安装、切流或删除动作
