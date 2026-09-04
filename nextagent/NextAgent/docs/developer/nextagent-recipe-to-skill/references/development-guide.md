# Recipe to Skill 开发指南

本指南定义两种 Skill 创建场景：已有 recipe 时把它作为只读 reference 内置到 Skill；没有 recipe 时，只根据 Skill 描述和工具使用生成 `SKILL.md`。

## 1. 使用边界

本目录本身是可复制的 Skill 源包：

```text
nextagent-recipe-to-skill/
|-- SKILL.md
|-- scripts/
|   `-- validate-examples.mjs
`-- references/
    `-- development-guide.md
```

- 在开发工具中，可以显式加载本目录的 `SKILL.md`。
- 在 NextAgent runtime 中使用时，复制整个 `nextagent-recipe-to-skill/` 目录到已授权的系统级或 Agent-owned Skill source，目录名保持不变。
- `docs/developer/` 不是运行时 Skill discovery root，因此仅把文件留在本文档目录不会自动安装。

### 目录架构评审

结论：`PASS`。

| 项目 | 结论 |
|---|---|
| 新目录 | `docs/developer/nextagent-recipe-to-skill/` |
| owner | 开发者文档与可复用 Skill 源资产 |
| 职责 | 提供 recipe 内置转换和无 recipe 创建两种 Skill 开发路径 |
| 生命周期 | 随仓版本化；按需复制到授权 Skill source |
| 构建与打包 | 不进入 npm workspace、产品 build 或默认发布包；验证脚本只在开发期由 Node.js 执行 |
| 运行时影响 | 留在 docs 时无运行时影响；安装后按普通 Skill 参与 discovery |
| 子目录 | `references/` 承载按需读取的开发指南；`scripts/` 承载可重复的示例与映射回归验证，不参与目标 Skill 业务执行 |

## 2. 两个场景

### 场景一：recipe 内置到 Skill

适用于 recipe 主要描述领域步骤、判断方法、知识使用和工具调用建议，且不依赖 workflow engine 的状态与控制保证。

目标 Skill：

```text
alarm-diagnosis/
|-- SKILL.md
`-- references/
    `-- recipe.yaml
```

这里的“内置”有严格含义：

- `references/recipe.yaml` 随 Skill 一起分发并投影为只读资源；
- `SKILL.md` 将 recipe 语义改写成模型可执行的业务指令；
- `recipe.yaml` 不会进入 workflow catalog，也不会被 workflow engine 执行；
- 不能用 Skill 文本替代 checkpoint、恢复、并行、精确分支或安全 guardrail。

命中以下任一事实时必须返回 `RECIPE_REQUIRES_WORKFLOW`，不得生成一个声称等价的 Skill：

- `type: boot-recipe`；
- parallel/join、loop、batch、subflow、delay 或 interrupt；
- checkpoint、resume、cancel 或 pending input；
- runtime 强制 retry、timeout、exception、固定顺序或节点状态；
- exactly-once、可恢复 side effect 或安全 guardrail；
- input/output 必须由 runtime schema 强制；
- 节点效果没有目标 Agent 可调用的等价 governed capability。

#### 映射方法

| Recipe 事实 | Skill 落点 |
|---|---|
| `recipeName` | Skill 目录和 frontmatter `name`，归一为小写 kebab-case |
| `version` | `metadata.version` |
| `displayName` | Skill 标题；只有语言明确时才写 locale metadata |
| `description`、`domain`、`scene`、`lang` | frontmatter `description` 和“适用场景” |
| `inputs` / `inputSchema` | “输入与前置条件”；不冒充 runtime schema enforcement |
| START | 目标、触发条件和输入 |
| LLM、识别、改写、翻译、分析、参数提取 | 合并成执行步骤与判断准则 |
| Tool、REST、Python、Skill、Agent、knowledge | 工具或知识使用规则；必须确认等价 capability |
| 非强制条件判断 | 可验证的决策准则 |
| END、`outputSchema` | 输出结构和质量标准 |

上表只说明信息落点，不能替代逐节点行为映射。转换时必须输出以下审计表：

| 字段 | 含义 |
|---|---|
| `nodeId` | recipe 中的稳定节点 id |
| `nodeType` | 源节点类型 |
| `sourceEffect` | 当前 node handler 的真实黑盒效果 |
| `targetKind` | `TOOL_CALL`、`INSTRUCTION`、`OUTPUT`、`WORKFLOW_ONLY` 或 `UNSUPPORTED` |
| `target` | canonical Tool name、Skill 正文章节或阻断原因 |
| `evidence` | handler、capability catalog、Agent binding 或输入字段证据 |

一个节点不必对应一个 Tool：多个节点可以收敛为一条 Skill 指令，一个节点也可能包含“模型判断 + 可选 Tool 调用”。`allowed-tools` 必须严格等于所有 `TOOL_CALL.target` 去重后的集合。

#### 当前节点与 Tool 的映射边界

映射事实以当前 [`node catalog`](../../../../packages/agent-workflow/src/nodes/index.ts)、[`capability node handlers`](../../../../packages/agent-workflow/src/nodes/capability-nodes.ts) 和 [`LLM node handlers`](../../../../packages/agent-workflow/src/nodes/llm-nodes.ts) 为准；节点类型全集来自 [`agent-contracts/core`](../../../../packages/agent-contracts/src/core/index.ts)。

| Recipe 节点 | 黑盒效果 | 转换落点 | 是否进入 `allowed-tools` |
|---|---|---|---|
| `START` | 建立入口和初始变量 | 输入、触发条件，`INSTRUCTION` | 否 |
| `END`、`DISPLAY` | 结束或投影内容 | 输出格式、完成条件，`OUTPUT` | 否 |
| `LLM`、`LLM_ROUTER`、`INTENT_RECOGNITION`、`QUESTION_REWRITING`、`TRANSLATION`、`PARAM_EXTRACT` | 调用模型完成认知步骤 | Skill 步骤和判断准则，`INSTRUCTION` | 否 |
| `DATA_ANALYSIS` | 模型分析；满足实现条件时可追加 Python 执行 | 默认 `INSTRUCTION`；确有代码执行且 `Python` 已绑定时另记 `TOOL_CALL -> Python` | 仅后一种情况加入 `Python` |
| `RESTFUL` | 调用 `inputs.api_name` 指定的 capability | 经 catalog 和 binding 确认后 `TOOL_CALL -> <api_name>` | 是 |
| `PYTHON` | 经 sandbox 执行 Python | `TOOL_CALL -> Python` | 是 |
| `AGENT` | 调用 `Agent` capability，并传递受约束的目标 Agent | `TOOL_CALL -> Agent` | 是 |
| `TOOL_CHOICE`、`API_CHOICE`、`RECIPE_CHOICE` | 选择候选项，不执行候选项 | 选择准则，`INSTRUCTION`；真实调用另行映射 | 否，不能把候选项全加入 |
| `KNOWLEDGE_SEARCH`、`KNOWLEDGE_QA` | 走 workflow knowledge boundary，QA 还会调用模型 | 只有确认等价模型可见 Tool 后才 `TOOL_CALL`，否则 `UNSUPPORTED` | 有等价 Tool 时才加入 |
| `USER_CHECK` | 请求用户输入；workflow 可进入等待并恢复 | 普通即时澄清可映射到已绑定提问 Tool；需要等待/恢复则 `WORKFLOW_ONLY` | 仅即时澄清映射时加入 |
| `CONDITION` | runtime 分支选择 | 仅非强制建议可写决策准则；精确分支为 `WORKFLOW_ONLY` | 否 |
| `ROUTER` | 当前 catalog 未注册 handler | `UNSUPPORTED`，返回 `RECIPE_REQUIRES_WORKFLOW` | 否，整次转换被阻断 |
| `PARALLEL`、`SUBFLOW`、`DELAY`、`INTERRUPT` | runtime fork/join、子流程、等待或中断恢复 | `WORKFLOW_ONLY` | 否，整次转换被阻断 |
| `GUARDRAIL` | 受治理的安全判定 | `WORKFLOW_ONLY`，不得降级为提示词 | 否，整次转换被阻断 |
| 当前 catalog 未注册 handler 的节点类型 | 没有可确认的执行效果 | `UNSUPPORTED`，返回 `RECIPE_REQUIRES_WORKFLOW` | 否，整次转换被阻断 |

注意：`TOOL`、`SKILL`、`ROUTER` 虽可出现在节点类型 schema 中，但当前 node catalog 没有对应 handler 注册。转换器不能按名称臆测为 Tool 或 Skill 调用；必须等待明确的当前实现或 capability 证据。

#### `references/recipe.yaml` 规则

1. 使用当前 loader 归一化后的 `recipeName + flowGraph` 形状。
2. 删除不参与 Skill 行为的展示噪声，但不得改变业务步骤、输入、输出或失败含义。
3. 不得包含 credential、token、真实 endpoint header、host absolute path、provider-private id 或 raw error。
4. 文件是模型指导资源，不是隐藏执行入口。Skill body 必须明确它的非执行性质。
5. Skill body 应包含最小完整操作规则；不能依赖模型自行理解全部 DSL 私有语义。

#### 典型生成效果 A：将告警诊断 recipe 内置到 Skill

输入：用户要求把下面的 recipe 转换为 `ran-alarm-diagnosis` Skill。该 recipe 已是当前 contract 形状，不含 workflow 专属保证或敏感字段。

生成目录：

```text
ran-alarm-diagnosis/
|-- SKILL.md
`-- references/
    `-- recipe.yaml
```

生成的 `references/recipe.yaml`：

<!-- example: recipe-embedded-reference -->
```yaml
recipeName: ran-alarm-diagnosis
version: "1.0.0"
displayName: RAN 告警诊断
description: 根据告警、KPI 和近期变更生成根因分析
inputs:
  neId:
    type: string
    required: true
    description: 网元标识
  timeWindow:
    type: string
    required: true
    description: 诊断时间窗
  alarms:
    type: array
    required: true
    description: 告警记录
  kpiData:
    type: object
    required: true
    description: KPI 数据
  changeRecords:
    type: array
    required: true
    description: 近期配置变更记录
flowGraph:
  nodes:
    start:
      type: START
      next:
        analyze: {}
    analyze:
      type: DATA_ANALYSIS
      description: 对齐告警时间线、KPI 退化和配置变更
      next:
        end: {}
    end:
      type: END
```

生成的 `SKILL.md`：

<!-- example: recipe-embedded-skill -->
```markdown
---
name: ran-alarm-diagnosis
description: 分析 RAN 告警、KPI 与近期变更并输出可追溯根因；当用户请求无线网络告警定位或影响分析时使用。
context: inline
user-invocable: true
model-invocable: true
metadata:
  version: "1.0.0"
---

# RAN 告警诊断

使用 `references/recipe.yaml` 作为只读业务步骤参考；它不是可执行 Workflow。

## 输入与前置条件

- 获取网元、时间窗、告警、KPI 数据和近期配置变更记录；缺失时先澄清。
- 只使用当前 Agent Scope 和 Owner Scope 已授权的数据。

## 执行步骤

1. 归一化告警时间线并识别主告警。
2. 对齐相同时间窗的 KPI 退化和近期配置变更。
3. 区分事实、推断与待确认项，按证据强度排序候选根因。

## 失败与降级

- 数据不可用时列出缺失证据和可继续执行的最小检查，不编造诊断事实。

## 输出

给出影响范围、证据、候选根因、建议动作和残余风险。
```

预期生成报告：

<!-- example-report: recipe-embedded -->
```text
Scenario: RECIPE_EMBEDDED
Target: generated-skills/ran-alarm-diagnosis/
Files: SKILL.md, references/recipe.yaml
Recipe reference: embedded, read-only, non-executable
Node mapping:
  start | START | 建立入口变量 | INSTRUCTION | 输入与前置条件 | node catalog
  analyze | DATA_ANALYSIS | 模型分析已有数据 | INSTRUCTION | 执行步骤 1-3 | LLM node handler
  end | END | 结束执行 | OUTPUT | 输出 | node catalog
Derived allowed-tools: none
Black-box effect: 调用 Skill 后返回告警影响、证据、候选根因、建议动作和残余风险
Effective tool calls: none
Workflow effect: none
Explicit non-effects: no permission grant; no routing change; no automatic install; no source deletion
Validation: recipe schema accepted; skill manifest accepted
Source recipe: retained
```

这个例子中 `DATA_ANALYSIS` 没有机械映射成 `Python`：源节点只要求分析已有数据，没有要求执行代码，因此目标 Skill 不声明 `allowed-tools`。这正是节点行为与工具名称分离后的黑盒效果。

### 场景二：没有 recipe，只有 Skill 描述和工具使用

适用于用户已经说明 Skill 的目标和需要使用的工具，但没有 workflow DSL。

默认目标只有一个文件：

```text
config-audit/
`-- SKILL.md
```

需要闭合六个事实：

1. 做什么：目标业务结果。
2. 何时使用：触发场景和明确非适用场景。
3. 输入：必需数据、可信来源和缺失处理。
4. 工具：canonical tool name、调用时机、输入来源和结果消费方式。
5. 失败：Tool 不可用、拒绝、超时或返回安全错误时如何降级。
6. 输出：用户或下游可观察的结构和质量标准。

#### 工具使用策略

- 先从当前 capability catalog、Agent binding 或 Tool contract 确认工具，不根据显示名称猜测 id。
- `allowed-tools` 是空格分隔的约束事实，不授予权限。
- 动态执行 shell、Python 或生成代码必须经过 sandbox gateway。
- Tool 结果为空或失败时不得编造数据。
- 多个工具按最短数据依赖顺序组织；只有相互独立且无 side effect 的读取才建议并行。
- 不为未来工具、可选 provider 或假想扩展点预留配置。

#### 典型生成效果 B：根据描述和工具生成配置审计 Skill

输入：

```text
Skill 名称：config-audit
描述：检查电信网元配置差异并输出整改建议
工具：Read、Grep
输出：差异项、证据位置、风险等级、整改建议
```

生成目录：

```text
config-audit/
`-- SKILL.md
```

生成的 `SKILL.md`：

<!-- example: description-tools-skill -->
```markdown
---
name: config-audit
description: 检查电信网元配置差异并输出可追溯整改建议；当用户要求配置核查、基线对比或变更风险检查时使用。
context: inline
user-invocable: true
model-invocable: true
allowed-tools: Read Grep
metadata:
  version: "1.0.0"
---

# 配置审计

## 输入与前置条件

- 确认配置文件和基线规则均来自当前授权 workspace。
- 缺少基线时停止审计并说明所需输入。

## 执行步骤

1. 使用 Read 获取目标配置和基线规则。
2. 使用 Grep 定位关键配置项及其证据位置。
3. 比较实际值和基线值，按影响范围评估风险。

## 失败与降级

- 文件不可读或工具拒绝时，报告安全错误和未完成范围，不推测配置值。

## 输出

输出差异项、证据位置、风险等级、整改建议和待确认项。
```

预期生成报告：

<!-- example-report: description-and-tools -->
```text
Scenario: DESCRIPTION_AND_TOOLS
Target: generated-skills/config-audit/
Files: SKILL.md
Tools: Read, Grep; requires target Agent bindings
Tool mapping:
  读取目标配置和基线 | TOOL_CALL | Read
  定位配置项证据     | TOOL_CALL | Grep
Derived allowed-tools: Read Grep
Black-box effect: 调用 Skill 后返回配置差异、证据位置、风险等级、整改建议和待确认项
Effective tool calls: Read Grep; both require current Agent bindings
Workflow effect: none
Explicit non-effects: no recipe creation; no permission grant; no routing change; no automatic install
Validation: skill manifest accepted
Recipe: not created
```

#### 典型边界效果：含并行语义的 recipe 被拒绝

输入 recipe 本身可以通过 schema，但 `PARALLEL` 是 workflow engine 的控制语义，不能内置为等价 Skill：

<!-- example: workflow-required-recipe -->
```yaml
recipeName: parallel-kpi-check
version: "1.0.0"
displayName: 并行 KPI 检查
description: 并行读取多个 KPI 数据源后汇总
flowGraph:
  nodes:
    start:
      type: START
      next:
        fork: {}
    fork:
      type: PARALLEL
      next:
        end: {}
    end:
      type: END
```

预期结果是不创建目标 Skill：

<!-- example-report: workflow-required -->
```text
Result: RECIPE_REQUIRES_WORKFLOW
Decisive fact: flowGraph.nodes.fork.type = PARALLEL
Generated files: none
Source recipe: retained
Black-box effect: conversion blocked; caller receives RECIPE_REQUIRES_WORKFLOW with node fork as evidence
Effective tool calls: none
Workflow effect: conversion blocked; source Workflow retained
Explicit non-effects: no partial Skill; no permission grant; no routing change; no source deletion
Required next step: keep execution in agent-workflow or define a separate product change
```

## 3. 黑盒效果说明

黑盒效果分为两层：转换器对文件和报告产生什么效果，以及生成的目标 Skill 被安装、发现和调用后产生什么效果。不能用“转换成功”同时代替这两层说明。

### 转换器黑盒契约

| 输入 | 可观察结果 | 文件副作用 | 明确不发生 |
|---|---|---|---|
| 可转换 recipe | `Scenario: RECIPE_EMBEDDED`，返回逐节点映射和推导后的工具集合 | 全部门禁通过后生成完整的 `SKILL.md` 与 `references/recipe.yaml` | 不修改或删除源 recipe；不注册 Workflow |
| 含 workflow runtime 保证的 recipe | `RECIPE_REQUIRES_WORKFLOW`，返回决定性节点或字段 | 不创建目标 Skill 或部分文件 | 不把状态机改写成提示词；不生成 companion Skill |
| 节点语义或等价 capability 无法确认的 recipe | `RECIPE_REQUIRES_WORKFLOW`，返回缺失的 handler、输入字段或 capability 证据 | 不创建目标 Skill 或部分文件 | 不按节点名称猜测 Tool |
| 只有 Skill 描述和已确认工具 | `Scenario: DESCRIPTION_AND_TOOLS`，返回动作到 Tool 的映射 | 只生成 `SKILL.md` | 不创建 recipe、references 占位目录或额外工具配置 |
| 工具 id、权限或关键输入无法确认 | 请求补充决定性事实 | 确认前不生成 | 不猜 canonical id，不扩大 binding 或 scope |

所有 schema、语义、权限证据和 workflow-only 门禁必须先于文件写入。只有目标文件集合完整且验证通过时才能报告成功；不得把部分文件报告为可用 Skill。若目标目录在转换前已存在，覆盖行为仍需用户明确授权。

### 目标 Skill 的运行时黑盒效果

目标 Skill 只有在被复制到已授权 Skill source 后才参与 runtime discovery。安装并调用后的可观察链路是：

```text
用户请求
  -> runtime 发现并选择普通 Skill
  -> 模型读取 SKILL.md
  -> 场景一按需读取只读 references/recipe.yaml
  -> 模型执行指令并调用已绑定且被 allowed-tools 收窄的 Tool
  -> 返回 Skill 定义的业务输出
```

调用过程中：

- 用户看到的是 Skill 定义的业务结果、缺失输入说明或安全失败，不会看到一个 recipe execution id。
- `references/recipe.yaml` 不进入 workflow catalog，不创建 node execution、checkpoint、`WAITING`、resume 或 workflow terminal commit。
- `allowed-tools` 只做交集收窄：字段存在时，可见工具为 `Agent 已绑定工具 ∩ allowed-tools`；字段省略时不改变 Agent binding。无论字段是否存在，转换报告中的 `Effective tool calls` 只列逐节点或逐动作映射后确实需要调用的 Tool。
- Tool 的认证、sandbox、审计、Agent Scope 和 Owner Scope 继续由既有 capability/runtime boundary 负责。
- 留在 `docs/developer/` 的本源 Skill 不会自动安装，因此仓库当前黑盒效果只有“可读取和复制的开发资产”，没有产品运行时变化。

### 三个典型黑盒结果

| 输入 | 节点/工具判断 | 最终结果 |
|---|---|---|
| `START -> DATA_ANALYSIS -> END`，只分析已有告警数据 | 三个节点分别为 `INSTRUCTION / INSTRUCTION / OUTPUT`，没有实际 Tool 调用 | 生成两文件的内置 recipe Skill；不写 `allowed-tools` |
| 描述要求使用 `Read`、`Grep` 审计配置 | 两个动作均为 `TOOL_CALL` | 只生成 `SKILL.md`；`allowed-tools: Read Grep` |
| recipe 包含 `PARALLEL` | `PARALLEL -> WORKFLOW_ONLY` | 返回 `RECIPE_REQUIRES_WORKFLOW`；生成文件为零 |

每次生成报告使用以下固定黑盒摘要：

```text
Black-box effect: <调用目标 Skill 后用户可观察到的业务结果或阻断结果>
Effective tool calls: <映射后确实需要且已确认绑定的 Tool，或 none>
Workflow effect: none | conversion blocked; source Workflow retained
Explicit non-effects: no permission grant; no routing change; no automatic install; no source deletion
```

## 4. 示例验证记录

检查日期：2026-08-18。

| 示例 | 验证边界 | 结果 |
|---|---|---|
| `recipe-embedded-reference` | 当前 `RecipeDefinitionSchema` | `accepted` |
| `recipe-embedded-skill` | 当前 Skill manifest parser，candidate=`ran-alarm-diagnosis` | `accepted`，无 diagnostics |
| `description-tools-skill` | 当前 Skill manifest parser，candidate=`config-audit` | `accepted`，无 diagnostics |
| `workflow-required-recipe` | recipe schema + 转换硬门禁 | schema `accepted`；因 `PARALLEL` 返回 `RECIPE_REQUIRES_WORKFLOW` |
| 转换 Skill 本身 | Codex `quick_validate.py` + NextAgent Skill manifest parser | `accepted` |
| 节点与 Tool 映射 | 当前 node catalog、capability/LLM handlers、内置 Tool 定义 | `RESTFUL`/`PYTHON`/`AGENT` 映射与 handler 一致；`TOOL`/`SKILL`/`ROUTER` 未注册，不作名称猜测 |
| 黑盒报告契约 | 两个成功示例和一个阻断示例 | 均说明业务结果、实际 Tool 调用、Workflow 效果和明确非效果 |
| 可重复回归脚本 | `node docs/developer/nextagent-recipe-to-skill/scripts/validate-examples.mjs` | Node 22.22.0：`10/10` checks passed |
| 当前 runtime Skill 回归 | `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts packages/agent-capability/tests/local-skill-source.test.ts --maxWorkers=2` | Node 22.22.0、Vitest 4.1.7：2 files、54 tests passed |

验证直接从本指南带 `example` 标记的 fenced code block 抽取内容，避免另存一份 fixture 后发生漂移。parser 验证只证明结构和 manifest contract 合法；Tool binding、真实数据访问和业务输出质量仍需在目标 Agent 环境执行行为测试。

### 当前实测效果基线

检查日期：2026-08-18。以下数字来自当前分支在仓库声明的 Node.js 22.22.0 下的实际命令输出，不是目标值或估算值。

| 效果面 | 当前结果 | 能证明 | 不能证明 |
|---|---|---|---|
| 转换 Skill manifest | 1/1 accepted，0 diagnostics | 本转换 Skill 可被当前 manifest parser 接受 | 模型一定按指令正确转换 |
| 生成 Skill 示例 | 2/2 accepted，0 diagnostics | 两种场景生成的 frontmatter 合法 | 真实 Tool 已绑定或返回正确业务数据 |
| recipe 示例 | 2/2 schema accepted | 正常与阻断 recipe 都是合法输入 | recipe 业务语义已被模型完整理解 |
| 节点映射覆盖 | 可转换示例 3/3 节点各映射一次 | 没有示例节点被遗漏或重复映射 | 未纳入 fixture 的所有 recipe 都正确 |
| Tool 集合一致性 | 2/2 场景与 `allowed-tools` 一致 | 示例不会因映射漂移扩大或漏掉 Tool 声明 | `allowed-tools` 能授予权限；它不能 |
| Workflow 阻断 | 1/1 `PARALLEL` 被阻断且生成文件为零 | 已覆盖的 workflow-only 负例不会静默降级 | 所有复杂 Workflow 组合均已覆盖 |
| 当前 runtime 回归 | 2 files、54/54 tests passed | manifest 与 local Skill source 既有行为未回归 | 本 docs Skill 已安装并完成真实用户任务 |

首次尝试的无 config 命令 `npx vitest run packages/agent-capability/tests/skill-manifest.test.ts packages/agent-capability/tests/local-skill-source.test.ts` 实际返回 `No test files found`，因为根 Vitest 配置排除了该 package；它不能作为通过证据。上表使用 `vitest.config.release.ts` 的成功结果。

当前未执行真实模型前向 E2E，因此现阶段可以确认“结构、schema、节点映射样例和 runtime parser/source 不回归”，不能声称“任意 recipe 的业务转换质量已经实测稳定”。

### 如何保障效果不下降

1. 把 `scripts/validate-examples.mjs` 作为本目录变更的必跑门禁。脚本直接读取本指南中的示例，并只通过公开 package exports 验证 manifest、recipe schema、逐节点覆盖、`allowed-tools` 集合、Workflow 阻断和当前 node catalog 假设，避免文档、fixture 与实现各自漂移。公开 exports 由当前 `packages/*/dist` 承载；同一提交修改相关 runtime source 时，必须先运行 `npm run build:runtime`，避免用旧 dist 得到假通过。
2. 把 release config 下的 `skill-manifest` 与 `local-skill-source` focused tests 作为 runtime 兼容门禁。测试数量可以增长，但不得出现失败或 `No test files found`。
3. 任何 node catalog、handler、canonical Tool name 或 Skill manifest 字段变化，都必须先更新映射规则和正/负例，再让回归脚本通过；不得通过放宽断言掩盖行为变化。
4. 保持三类最小金丝雀：可转换且无 Tool、描述加多个 Tool、含 workflow-only 节点。新增一种映射类别时，至少增加一个正常例和一个拒绝/降级例。
5. 产品安装前增加真实 Agent 前向 E2E，至少检查生成文件集合、业务输出必需字段、实际 Tool 调用集合、源 recipe 未修改，以及 Workflow execution/node state 为零。模型或 prompt 升级时使用相同输入重复执行并与已批准基线比较。
6. 以安全不变量作为硬门禁：未授权 Tool 扩张为 0、workflow-only 误转换为 0、源 recipe 意外修改为 0。业务文字允许非关键措辞变化，但这些不变量不得下降。

## 5. 实施策略

1. 选择唯一场景：有 recipe 使用场景一；没有 recipe 使用场景二。
2. 确认 Skill 名称、目标目录、Agent Scope 和工具权限。
3. 先写可观察行为，再逐节点填写映射表；不从节点或工具名称反推未定义需求。
4. 场景一先执行 workflow 保证门禁，通过后才创建 `references/recipe.yaml`。
5. 从 `TOOL_CALL` 行推导 `allowed-tools`，并反查两者集合完全一致。
6. 场景二默认只写 `SKILL.md`；只有正文实际需要时才增加资源。
7. 验证 manifest、resource、安全、tool binding、节点覆盖、正常路径和失败路径。
8. 未经授权不安装到 durable source、不切换 routing、不删除源 recipe。

## 6. 验证门禁

### 结构

- `name` 为小写 kebab-case，且与目录名一致；
- frontmatter 只使用当前支持字段；
- `context` 使用当前可执行的 `inline`；
- 场景一包含 `references/recipe.yaml`，场景二不包含 recipe；
- 没有未被正文使用的目录或资源。

### 安全与 owner

- recipe reference 和 Skill body 不含 credential、host path 或 provider-private 数据；
- Skill 不拥有 workflow checkpoint、resume、pending input 或 terminal commit；
- Agent Scope 来自可信目录或装配，不来自用户可伪造字段；
- Tool 权限仍由 capability governance 和 Agent binding 决定。

### 行为

- 正常输入得到规定输出；
- 缺失输入时澄清或安全拒绝；
- Tool 失败时不编造结果；
- 报告同时说明用户可观察结果和明确不发生的副作用；
- 场景一的业务步骤可追溯到内置 recipe；
- 场景一每个节点恰有一个 `targetKind`，且没有 `WORKFLOW_ONLY` 或 `UNSUPPORTED` 被静默降级；
- `allowed-tools` 与所有 `TOOL_CALL.target` 的去重集合完全一致；
- 场景二的每个工具都有明确调用条件和结果消费方。

如生成的目标 Skill 进入产品仓库，按影响范围运行：

```powershell
npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts packages/agent-capability/tests/local-skill-source.test.ts --maxWorkers=2
npm run lint:architecture
```

如果工作触达 Web API、routing contract、workflow runtime、capability contract 或安全边界，必须先建立 OpenSpec change，再运行仓库完整门禁。
