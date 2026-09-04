---
title: NextAgent Workflow 使用指南
version: v1.0
date: 2026-07-16
audience: 面向第一次使用 Workflow 的开发者
---

# NextAgent Workflow 使用指南

## 一、概述

NextAgent 的 Workflow 是一套基于 **Recipe（配方）+ FlowGraph（有向图）+ Node Catalog（节点处理器）** 的可编排执行引擎，专门服务电信网络运维场景。它不是独立的流程引擎，而是深度嵌入 Agent 能力体系的一条执行路径。

Recipe 在 NextAgent 中被建模为一种 Capability（`kind: "RECIPE"`），与 Tool、Skill、Agent 同属能力体系。系统启动时自动扫描 recipe 文件并注册为当前 Agent Scope 下的 capability，供路由和 LLM 工具调用使用。

## 二、前置准备：创建 Recipe 文件

无论用哪种触发方式，首先需要有一个 recipe YAML 文件。路径是固定的：

```
{打包根目录}/agents/{agentId}/recipes/{recipeName}.yaml
```

默认 agent 的路径为 `agents/default-agent/recipes/`。系统启动时自动扫描该目录，校验通过后注册为 `RECIPE` 类型 capability。校验失败的 recipe 会被跳过，不影响启动。

### 最小 Recipe 示例

```yaml
name: ran-alarm-diagnosis
version: "v1"
description: RAN 告警诊断流程
nodes:
  start:
    type: start-event
    next:
      diagnose: {}
  diagnose:
    type: llm
    description: 分析 KPI 和告警上下文，输出诊断结论
    inputs:
      source: context
      prompt_template: "你是电信网络诊断专家，分析以下告警并给出结论。"
    outputs:
      summary: true
    outputParser:
      mode: json
    timeoutMs: 30000
    retryPolicy:
      maxAttempts: 2
    next:
      done: {}
  done:
    type: end-event
```

### 带条件分支和并行汇聚的 Recipe 示例

```yaml
name: alarm-diagnosis-v2
version: "2.0.0"
description: 告警诊断 V2 流程
nodes:
  start:
    type: start-event
    next:
      fetch_a: {}
      fetch_b: {}
  fetch_a:
    type: restful
    description: 获取告警数据
    next:
      merge: {}
  fetch_b:
    type: restful
    description: 获取 KPI 数据
    next:
      merge: {}
  merge:
    type: llm-router
    description: 综合分析告警和 KPI
    dependsOn:
      - fetch_a
      - fetch_b
    retry:
      maxAttempts: 3
      backoff: exponential
      delayMs: 2000
    timeout: 30000
    presentation:
      outputParser:
        type: TEXT
      tag: ANSWER
    next:
      end: {}
  end:
    type: end-event
```

### Recipe 核心字段说明

| 字段 | 类型 | 必填 | 说明 |
------|------|------|------|
| name | string | 是 | Recipe 名称，同时作为 capabilityId |
| version | string | 是 | 版本号，请求时需携带匹配的 recipeVersion |
| description | string | 否 | 描述信息，会出现在 LLM 的 system prompt 中 |
| domain | string | 否 | 电信领域分类（如 ran、core、transport） |
| scene | string | 否 | 场景（如 alarm、capacity） |
| type | string | 否 | `recipe` 或 `boot-recipe`；boot-recipe 在无显式 targetRecipe 时自动进入 |
| nodes | object | 是 | 节点字典，通过 `next` 字段隐式定义边 |
| runtime | object | 否 | 运行时配置（timeout、checkpoint、retry、controlPolicy） |
| inputs | object | 否 | 输入参数声明 |
| timeoutMs | number | 否 | 全局超时（毫秒） |
| priority | number | 否 | 优先级 |

### 支持的节点类型

| 类别 | 节点类型 | 说明 |
------|---------|------|
| 网关 | `start-event` `end-event` `exclusive-gateway` `parallel-gateway` `delay-gateway` | 流程控制 |
| LLM | `llm` `llm-router` `intent-recognition` `question-rewriting` `translation` `data-analysis` `param-extract` | 模型调用 |
| 能力 | `tool` `tool-choice` `restful` `python` `agent` `skill` | Capability 调用 |
| 知识 | `knowledge-search` `knowledge-qa` `api-choice` `recipe-choice` | RAG 检索与知识问答 |
| 交互 | `display-content` `guardrail-check` `user-check` `interrupt-gateway` `sub-recipe` | 内容展示、护栏、用户交互 |

> 节点类型支持 snake_case 和 kebab-case 两种写法，loader 会自动规范化为 canonical 形式。

## 三、四种触发方式

### 方式一：API 显式指定 routingConstraints.targetRecipe

最直接、最可控的方式。调用方在提交请求时明确指定走哪个 workflow，**不经过 LLM**。

**接口**: `POST /api/v1/requests`（便捷提交，自动创建 session）

**请求体**:

```json
{
  "inputText": "基站告警频繁，请定位问题",
  "idempotencyKey": "req-001-abc",
  "routingConstraints": {
    "targetRecipe": "ran-alarm-diagnosis"
  }
}
```

也可以用 `POST /api/v1/sessions/{sessionId}/requests`（在已有 session 内提交），请求体结构一样。

**执行流程**:
1. routing policy 检测到 `targetRecipe`，查询当前 Agent Scope 下是否有该 recipe
2. 命中时直接进入 workflow path，不调 LLM
3. 未命中时回退到普通对话循环（`safeReason: TARGET_RECIPE_MISS_FALLBACK`）
4. workflow 执行完毕，结果作为 ASSISTANT 消息写入对话

routingConstraints 其他可用字段:

| 字段 | 说明 |
------|------|
| `targetSkill` | 指定走某个 skill（与 targetRecipe 互斥） |
| `forbiddenCapabilityIds` | 禁用某些 capability |
| `executionMode` | `"default"` 或 `"model-only"`（只跑模型不调工具） |
| `maxToolCalls` | 工具调用上限（0-5） |
| `allowHumanInput` | 是否允许人工输入 |
| `locale` | 语言区域设置 |

### 方式二：输入文本中写 $workflow:recipe-name 指令

面向终端用户的快捷指令语法。在聊天输入文本中直接写指令前缀。

**用法**:

```
$workflow:ran-alarm-diagnosis 诊断3扇区的RRC连接失败告警
```

routing policy 中的 `parseCapabilityDirective` 会用正则扫描输入文本，提取出指令类型和名称：
- 命中且 recipe 可用时直接进 workflow path（不调 LLM）
- 命中但 recipe 不可用时回退到对话循环
- 同时出现多个不同指令时判为 `ambiguous` 并拒绝

同样的语法还有 `$skill:skill-name`（走 skill 路径）。retry 操作会保留原始指令文本，确保重试时路由一致。

### 方式三：LLM 在对话循环中自主调用 Workflow 工具

最智能的方式：用户正常提问，不指定任何 workflow，LLM 自主判断是否需要调用 workflow。

**用法**: 用户正常输入，不带任何指令或 routingConstraints。

```json
{
  "inputText": "基站告警频繁，请定位问题",
  "idempotencyKey": "req-002-abc"
}
```

routing 未命中任何显式指令，进入 `MODEL_DRIVEN_LOOP`（普通对话循环）。LLM 在对话过程中如果判断需要跑 workflow，会发起 tool call：

```json
{
  "toolCallId": "call-1",
  "toolName": "Workflow",
  "arguments": {
    "recipeName": "ran-alarm-diagnosis",
    "inputText": "基站告警频繁，请定位问题",
    "inputVariables": {}
  }
}
```

Workflow 工具的参数 schema:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| recipeName | string | 是 | 要执行的 recipe 名称（必须在当前 Agent Scope 已注册） |
| inputText | string | 否 | 用户问题文本 |
| inputVariables | object | 否 | 结构化上下文变量 |

工具内部校验 recipe 可用性后委托执行，结果返回给 LLM，LLM 拿到结果后生成最终回答。

**关键点**: LLM 如何知道有哪些 recipe 可用？每个 recipe 注册时 `disclosurePolicy` 为 `EAGER`，recipe 名称和描述会直接出现在 system prompt 中。

### 方式四：Agent routing policy 正则规则路由

配置驱动的自动路由，由 Agent 定义中的正则规则决定，不需要用户或 API 调用方做任何事。

在 Agent 定义（`agent.yaml`）中配置：

```yaml
agentId: default-agent
routing:
  mode: policy
  policy:
    method: policy:intent-recognition
    rules:
      - reg: ".*告警.*"
        target:
          kind: WORKFLOW
          name: ran-alarm-diagnosis
      - reg: ".*容量.*"
        target:
          kind: WORKFLOW
          name: capacity-triage
      - reg: ".*查询.*"
        target:
          kind: SKILL
          name: network-diagnostics
```

routing policy 按顺序用 `new RegExp(rule.reg).test(inputText)` 匹配：
- 命中且 target 可用时直接进 workflow/skill path
- 命中但 target 不可用时回退对话循环
- 全部未命中时回退对话循环（`POLICY_RULE_MISS_FALLBACK`）

target 可用性按治理后的 capability 视图判定：`kind: SKILL` 必须解析出 `SKILL` capability，`kind: WORKFLOW`
必须解析出 `WORKFLOW` capability（recipe 只从 `agents/{agentId}/recipes/` 扫描）。kind 不匹配按未命中处理，
不会互相替代。

排障时看这次 run 的 `POLICY_APPLIED` 事件（`GET /api/v1/sessions/{sessionId}/runs/{runId}/events`），
`reasonCode` 直接说明落在哪条分支：

| reasonCode | 含义 |
|------------|------|
| `POLICY_RULE_SKILL_MATCHED` / `POLICY_RULE_WORKFLOW_MATCHED` | 规则命中且 target 可用 |
| `POLICY_RULE_SKILL_MISS_FALLBACK` / `POLICY_RULE_WORKFLOW_MISS_FALLBACK` | 规则命中但 target 名字解析不到或 kind 不对 |
| `POLICY_RULE_MISS_FALLBACK` | 规则都没匹配上（注意 `reg` 不带 `i`/`u` flag） |
| `POLICY_RULE_TARGET_SKILL_PRIORITY` | 本次请求带了显式 `targetSkill`（含 `$skill:` 指令），显式选择优先，规则不参与 |
| `POLICY_INTENT_RECOGNITION_DEFAULT` | `mode: policy` 但没有配置 `rules` |
| `DEFAULT_MODEL_DRIVEN_LOOP` | assembly 里根本不是 `mode: policy`，通常是 agent.yaml 没被读到 |

Skill 命中后还会有一条 `policyDomain=TARGETED_SKILL` 的证据：`PREFERRED_SKILL_LOADED` 表示已注入，
`PREFERRED_SKILL_UNAVAILABLE` / `PREFERRED_SKILL_FORBIDDEN` 表示被治理拦下。

### 四种方式对比

| 方式 | 谁决定 | 是否调 LLM | 控制粒度 | 适用场景 |
------|--------|-----------|---------|---------|
| `routingConstraints.targetRecipe` | API 调用方 | 否 | 精确指定 | 外部系统编排、API 集成 |
| `$workflow:recipe-name` 指令 | 终端用户 | 否 | 精确指定 | 用户快捷指令、调试 |
| LLM 调 Workflow 工具 | LLM 自主 | 是 | 模型判断 | 自然语言交互、智能路由 |
| routing policy 正则 | 配置规则 | 否 | 模式匹配 | 固定关键词路由、批量场景 |

## 四、Skill 如何引导 LLM 调用 Workflow

Skill 本身不直接调 workflow，而是通过 prompt 指引 LLM 在合适时机调用 `Workflow` 工具。

### Skill 文件格式

Skill 文件放在 `agents/{agentId}/skills/{skill-name}/SKILL.md`，由 frontmatter 和 body 组成：

```markdown
---
name: alarm-diagnosis-guide
description: 引导告警诊断流程，当用户描述告警问题时触发 RAN 告警诊断 workflow。
context: inline
user-invocable: true
model-invocable: true
metadata:
  version: 1.0.0
---

当用户描述基站告警、KPI 异常、RRC 连接失败等网络告警问题时，
调用 Workflow 工具执行 ran-alarm-diagnosis 配方。

调用时传入：
- recipeName: "ran-alarm-diagnosis"
- inputText: 用户的原始告警描述
- inputVariables: 提取的关键参数（如 cellId、alarmIds）

执行完成后，根据 workflow 返回的 outputVariables 中的 summary 字段，
向用户输出诊断结论和建议操作。
```

### Frontmatter 关键字段

| 字段 | 类型 | 默认值 | 说明 |
------|------|--------|------|
| name | string | - | Skill 名称，全小写连字符格式（如 `alarm-diagnosis-guide`） |
| description | string | - | LLM 在 system prompt 中看到的描述，决定 LLM 何时选择此 skill |
| context | string | - | `inline`（主对话内执行）或 `fork`（启动子 agent） |
| user-invocable | boolean | false | 是否允许用户通过 `$skill:` 指令触发 |
| model-invocable | boolean | true | 是否允许 LLM 自主调用 |
| allowed-tools | string | - | 可选，空格分隔的工具白名单（如 `Workflow Bash Python`） |
| metadata.version | string | - | Skill 版本号 |

### Skill body 编写要点

1. **明确触发条件**: 在 body 开头写清楚什么场景下应该调用哪个 workflow
2. **指定传参方式**: 告诉 LLM 调用 Workflow 工具时 recipeName、inputText、inputVariables 分别传什么
3. **说明输出处理**: 告诉 LLM 拿到 workflow 结果后如何向用户呈现
4. **避免敏感信息**: body 中不能包含路径、credential、API key 等，否则会被安全校验拒绝

## 五、端到端完整示例

### 场景：告警诊断 workflow

**第 1 步**: 创建 recipe 文件

文件路径: `agents/default-agent/recipes/ran-alarm-diagnosis.yaml`

```yaml
name: ran-alarm-diagnosis
version: "v1"
description: RAN 告警诊断流程
nodes:
  start:
    type: start-event
    next:
      diagnose: {}
  diagnose:
    type: llm
    description: 分析告警上下文，输出诊断结论
    inputs:
      prompt_template: "你是电信网络诊断专家，分析以下告警并给出结论。"
    outputs:
      summary: true
    outputParser:
      mode: json
    timeoutMs: 30000
    retryPolicy:
      maxAttempts: 2
    next:
      done: {}
  done:
    type: end-event
```

**第 2 步**: 启动系统

系统启动时自动扫描 `agents/default-agent/recipes/` 目录，加载并注册 recipe 为 capability。

**第 3 步**: 用任意方式触发

方式一（API 指定）:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/requests \
  -H "Content-Type: application/json" \
  -d '{
    "inputText": "3扇区RRC连接失败告警频繁",
    "idempotencyKey": "test-001",
    "routingConstraints": { "targetRecipe": "ran-alarm-diagnosis" }
  }'
```

方式二（指令触发）: 在聊天框输入 `$workflow:ran-alarm-diagnosis 3扇区RRC连接失败告警频繁`

方式三（LLM 自主）: 在聊天框输入 `3扇区RRC连接失败告警频繁，请诊断`

方式四（策略路由）: 在 agent.yaml 中配置正则规则 `.*告警.*` 映射到 `ran-alarm-diagnosis`

**第 4 步**: 获取结果

Workflow 执行完成后，结果作为 ASSISTANT 消息写入对话。可通过以下接口查看:

```bash
curl http://127.0.0.1:3000/api/v1/sessions/{sessionId}/conversation?limit=50&includeCapabilityResults=true
```

响应中 `role: "CAPABILITY_RESULT"` 且 `content` 包含 `"toolName":"Workflow"` 的条目即为 workflow 执行记录，其中 `status` 字段标识执行结果（`succeeded` / `failed` / `waiting`）。

## 六、Workflow 执行状态与交互

### 执行状态

| 状态 | 说明 | 对应 CapabilityInvocationResult |
------|------|-------------------------------|
| `COMPLETED` | 正常完成 | `SUCCEEDED` |
| `FAILED` | 执行失败 | `FAILED` |
| `INTERRUPTED` | 被中断（如 abort/timeout） | `FAILED` |
| `WAITING` | 等待用户输入（如 USER_CHECK 节点） | `DEGRADED` |

### 用户交互（WAITING 状态）

当 workflow 执行到 `user-check` 或 `interrupt-gateway` 节点时，会进入 WAITING 状态，向用户发起提问。用户回答后 workflow 从挂起点恢复继续执行。

用户回答通过以下接口提交:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer \
  -H "Content-Type: application/json" \
  -d '{
    "answers": [["选项A"]]
  }'
```

`answers` 是二维数组：外层对应问题，内层对应每个问题的选项（支持多选）。

### Checkpoint 与恢复

在 recipe 的 runtime 配置中启用 checkpoint 后，每个非网关节点完成后会保存恢复状态：

```yaml
runtime:
  persistence:
    checkpoint: true
```

如果执行被中断（如进程重启），下次可以从最近的 checkpoint 恢复，不需要从头执行。

### 失败控制策略

在 recipe 的 runtime.controlPolicy 中配置失败时的处理策略：

```yaml
runtime:
  controlPolicy:
    cancel:
      strategy: ROLLBACK_THEN_STOP
      rollbackNode: diagnose
    restart:
      strategy: RESTART
```

| 策略 | 说明 |
------|------|
| `STOP` | 直接停止（默认） |
| `CONTINUE` | 跳过失败节点继续 |
| `RESTART` | 从头重新执行 |
| `ROLLBACK_THEN_STOP` | 回滚到指定节点执行后停止 |
| `ROLLBACK_THEN_CONTINUE` | 回滚后继续向前执行 |
| `ROLLBACK_THEN_RESTART` | 回滚后从头重新执行 |

## 七、循环节点

Recipe 支持循环节点，通过 `loopConfig` 配置：

```yaml
nodes:
  loopend:
    type: tool
    next:
      summarize: {}
    loopConfig:
      loopEndNode: loopend
      loopStartNode: diagnose
      loopCardinality: 3
      loopResultVariable: LOOP_RESULT
      loopResultType: List
      loopResultValue: "${count}"
```

三种循环模式:

| 模式 | 配置字段 | 说明 |
------|---------|------|
| 固定次数 | `loopCardinality: N` | 循环体执行 N 次 |
| 数据驱动 | `loopInputDataItem` + `loopElementVariable` | 遍历数组，每次迭代注入元素变量 |
| 条件终止 | `loopCompletionCondition` | 每次迭代后求值，满足则退出 |

结果收集支持 `List`（数组）和 `Map`（字典，按 `loopResultKey` 建键）两种类型。

## 八、本地与远程执行模式

Workflow 支持本地和远程两种执行模式，通过 gateway 配置选择：

- **本地模式**（默认）: 在当前进程内执行
- **远程模式**: 通过 `WorkflowRemoteExecutionGateway` 以流式传输执行事件，适用于将 workflow 执行隔离到独立服务的场景

在系统配置中通过 gateway selection 控制：

```yaml
gateway:
  gateways:
    - gatewayId: local-sqlite
      gatewayKind: sqlite
      deploymentMode: LOCAL
    - gatewayId: workflow-execution
      gatewayKind: workflow-execution
      deploymentMode: REMOTE
      endpoint: https://workflow-service.internal/api/v1/workflow
```

## 九、相关参考

- Recipe DSL 完整规范: `docs/workflow/Recipe specification.md`
- 节点能力详细说明: `docs/workflow/Recipe-node-specification-detail.md`
- Workflow OpenSpec 规格: `openspec/specs/workflow-package/`、`openspec/specs/workflow-routing/`
- 合约定义: `packages/agent-contracts/src/core/index.ts`
- 引擎实现: `packages/agent-workflow/src/engine/index.ts`
- 节点处理器: `packages/agent-workflow/src/nodes/`
- Recipe 加载器: `packages/agent-workflow/src/workflow-recipe-loader.ts`
- Workflow 工具: `packages/agent-capability/src/builtins/workflow/workflow-tool.ts`
- 路由策略: `packages/agent-core/src/routing/agent-routing-policy.ts`
