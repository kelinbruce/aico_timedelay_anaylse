# Recipe DSL 规范（基于 1.0 的高阶能力增强版）

> 本规范以 Recipe 1.0 DSL 为基线，在保留 1.0 顶层结构和节点类型命名的基础上，补充 NextAgent TS 后端通过 OpenSpec change 和代码实现新增的高阶能力。
>
> **章节结构：** 主章节描述 2.0 推崇的写法（推荐使用的字段和语法）；1.0 兼容语法统一放在附录 A。未实现的能力点在各字段说明中标注"预留"。
>
> TS 加载器（`normalizeRecipeDefinition`）在加载时自动将 1.0 YAML 归一化为内部 `RecipeDefinition` 契约。DSL 字段在 YAML 层面保持 1.0 风格（kebab-case 节点类型、`name`/`nodes` 结构）；TS 内部使用 UPPER_CASE 类型枚举作为实现细节，不要求 DSL 作者感知。

---

## 一、顶层结构

```yaml
name: demo_recipe
description: demo desc
domain: NAIE
scene: demo
type: boot-recipe
version: 1.1.0
lang: zh
expandFields:
  recipe_ne_version: "1.0"
  recipe_ne_type: xxx
runtime:
  control_policy:
    cancel:
      rollback_node:
        condition: ""
    cancel_timeout: 60
nodes:
  start_node:
    type: "start-event"
    description: "开始处理您的问题"
    next:
      ext_api:
        condition: ""
  # ... 其余节点
```

### 1.0 基线字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | Recipe 名称，最长 255，与 domain 组合唯一 |
| description | string | 否 | 描述，最长 4096 |
| domain | string | 是 | 域，与 name 组合唯一，最长 512 |
| scene | string | 是 | 场景，最长 512 |
| version | string | 是 | 版本，最长 128 |
| lang | enum | 否 | zh / en |
| type | enum | 否 | boot-recipe 或 recipe，默认 recipe |
| expandFields | object | 否 | 扩展字段，TS 归一化为 metadata（1.0 原生写法，见附录 A） |
| nodes | map<node> | 是 | 节点列表 |

### TS 高阶扩展字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| runtime | object | 否 | 运行时策略配置，详见第二章 |

---

## 二、runtime 运行时配置

`runtime` 是 Recipe 顶层可选字段，承载执行器级策略。所有时间字段以秒为单位（正整数）。

```yaml
runtime:
  control_policy:
    cancel:
      rollback_node:
        condition: ""
    cancel_timeout: 60
```

| 字段 | 类型 | 说明 |
|------|------|------|
| control_policy | ControlPolicy | 外部取消策略 |
| incremental | bool | 预留，是否增量执行 |

### control_policy（ControlPolicy）

`control_policy` 只包含 `cancel` 一个入口，用于外部取消（`controller.abort()`）后的回退补偿。

```yaml
control_policy:
  cancel:
    rollback_node:           # 回退目标节点，key 为节点 ID
      condition: ""          # 预留，当前不求值
  cancel_timeout: 60          # 回退执行超时（秒）
```

| 字段 | 类型 | 说明 |
|------|------|------|
| cancel | map<nodeId, BranchDef> | 回退节点映射，与 next 同形同策 |
| cancel.rollback_node[nodeId].condition | string | 预留，当前不求值 |
| cancel_timeout | int (>=1) | 回退执行超时（秒） |

**执行语义：** 外部 `controller.abort()` 后，引擎检索 `control_policy.cancel`。有回退目标时，用独立子信号（`cancel_timeout` 超时控制）执行回退节点子路径再终止；无回退目标时直接终止。两种情况最终状态均为 `INTERRUPTED`。回退路径不写 checkpoint，继承原 run 的 agent scope / owner scope。回退失败仅记录诊断日志，不改终态。

**已废弃字段（加载时报错）：** `resume`、`modify`、`restart`、`strategy`、`rollback_node`（旧 `{ strategy, rollback_node }` 形式）。---

## 三、节点通用结构

> 以下示例展示节点的完整结构。其中 `retry`、`presentation` 当前为预留字段，暂不支持（详见 4.1 / 4.4）。

```yaml
node_name:
  type: "node-type"
  description: "节点描述"
  inputs:
    key1: value1
  outputs:
    key1: ${output_var}
  next:
    next_node_1:
      condition: ""
    next_node_2:
      condition: "${var == 'value'}"
  retry:
    max_attempts: 2
    backoff: fixed
    delay: 3
  timeout: 60
  presentation:
    output_parser:
      show_title: true
      show_content: true
      show_aigc: false
      type: TEXT
      message_level: ANSWER
      data:
        piu_name: example
    recommends:
      - "推荐问题1"
    tag: REJECT
  exception:
    error_handler: ""
  loop_config:                 # 或 loopConfig
    loop_cardinality: 3
    loop_input_data_item: ${data_list}
    loop_element_variable: item
    loop_result_type: List
  batch_config:                # 或 batchConfig
    batch_input_data_item: ${item_list}
    batch_element_variable: item
    batch_size: 10
    batch_mode: parallel
    batch_fail_strategy: continue
    batch_parallelism: 5
    batch_result_merge: append
```

### 1.0 基线字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 节点名 (key) | string | 是 | 字母开头，Recipe 内唯一 |
| type | string | 是 | 节点类型（kebab-case） |
| description | string | 否 | 节点描述 |
| inputs | object | 视节点 | 输入参数 |
| outputs | object | 视节点 | 输出参数 |
| next | map | 是 | 下一步节点，`condition: ""` 代表 true |

### 2.0 推崇字段

| 字段 | 类型 | 说明 |
|------|------|------|
| retry | RetryPolicy | 节点级重试策略（预留，暂不支持，见 4.1） |
| timeout | int (>=1) | 节点级超时（秒） |
| presentation | NodePresentation | 展示配置（统一入口，含 output_parser/recommends/tag）（预留，暂不支持，见 4.4） |
| exception | map<目标节点名, string> | 异常跳转映射，value=异常详情(预留)，默认"" |
| loop_config / loopConfig | WorkflowLoopConfig | 循环配置 |
| batch_config / batchConfig | WorkflowBatchConfig | 批量配置 |

> **命名规范（snake_case 优先）：** Recipe DSL 默认使用 snake_case 作为字段命名规范（如 `input_question`、`action_type`、`loop_cardinality`）。加载器对 `loop_config`/`loopConfig`、`batch_config`/`batchConfig` 等结构化字段自动归一化，两种写法均可。

> **1.0 camelCase 兼容：** 1.0 DSL 中存在的历史 camelCase 字段（`openGuardrail`、`openApiRecall`、`enableTranslation`、`openReflection`）仍被加载器接受并归一化为对应 snake_case 语义（`open_guardrail`、`open_api_recall`、`enable_translation`、`open_reflection`）。新 Recipe 应使用 snake_case 写法。

> **1.0 兼容字段：** 独立 `output_parser`（不在 `presentation` 下）、节点级 `recommends`（不在 `presentation` 下）、`loop`（1.0 别名）、`retryPolicy`（1.0 别名）仍被加载器接受并归一化，详见附录 A。推荐使用 2.0 推崇写法。

---

## 四、节点级控制能力

### 4.1 retry（节点重试）

> **预留字段，暂不支持。** 当前 TS 运行时不执行节点级重试；`retry` 字段会被加载器接受并归一化保留，但不产生重试行为。后续版本通过 OpenSpec change 启用。

```yaml
retry:
  max_attempts: 2
  backoff: fixed
  delay: 3
```

| 字段 | 类型 | 说明 |
|------|------|------|
| max_attempts | int (>=0) | 最大重试次数（预留） |
| backoff | enum | fixed / exponential（预留） |
| delay | int (>=0) | 重试间隔（秒）（预留） |

> 上述字段均为预留，当前不支持。

### 4.2 timeout（节点超时）

```yaml
timeout: 60
```

节点级超时（秒，正整数）。引擎将其转换为 `AbortSignal` 超时控制单次 handler 执行。对于 `user-check` 等待型节点，`timeout` 复用为等待超时（超时后抛 `WORKFLOW_NODE_TIMEOUT`，走 `exception` 分支或 FAILED 终止）。

### 4.3 exception（异常跳转）

```yaml
exception:
  error_handler: ""
```

| 字段 | 类型 | 说明 |
|------|------|------|
| key (目标节点名) | string | 异常跳转目标节点 ID |
| value (异常详情) | string | 异常详情，预留字段，默认 `""` |

**当前行为：** 节点执行失败时，引擎取 `exception` 的第一个分支跳转到目标节点继续执行。`value`（异常详情）当前为预留字段，不做语义解析。

**支持的异常类型：** restful 和 user-check 节点超时产生的 `SafeError` 触发 `exception` 路由：

| 异常来源 | error.code 示例 |
|---------|----------------|
| restful / user-check 超时 | `WORKFLOW_NODE_TIMEOUT`（category: `TIMEOUT`） |

**异常全局变量：** 节点失败进入 `exception` 路由时，引擎注入 `error` 变量到全局上下文：

| 字段 | 说明 |
|------|------|
| error.code | 业务失败的第一标识。capability/RESTful 业务失败时直接携带上游接口返回的业务 code；框架自身结构性失败携带框架码 |
| error.message | 业务失败的人类可读原因。优先取上游接口返回的 msg/message |
| error.category | 可选，仅保留 `TIMEOUT` 单值。框架合成的超时失败携带 `category: "TIMEOUT"`；其他失败不携带此字段 |

### 4.4 presentation（展示控制）

> **预留字段，暂不支持。** `presentation` 是节点级可选字段，是 2.0 推崇的统一展示控制入口。当前 TS 运行时不处理 `presentation` 语义；字段会被加载器接受并归一化保留，但不影响结构化 delta 输出。后续版本通过 OpenSpec change 启用。

```yaml
presentation:
  output_parser:
    show_title: true
    show_content: true
    show_aigc: false
    type: TEXT
    message_level: ANSWER
    data:
      piu_name: example_piu
      piu_version: "1.0"
  recommends:
    - "推荐问题1"
    - "推荐问题2"
  tag: REJECT
```

> 以下子字段均为预留，当前不支持。

**output_parser 子字段（完整六字段）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| show_title | bool | 是否显示节点标题，默认 true |
| show_content | bool | 是否显示节点内容，默认 true |
| show_aigc | bool | 是否显示 AIGC 标记，默认 false。true 时结构化 delta 携带 `aigc: true` |
| type | enum | 显示类型：TEXT/TABLE/CHART/PIU/HTML/DSL/OBJECT。映射到结构化 delta 的 displayType |
| message_level | enum | 消息级别：TITLE/ANSWER/DETAIL/EXPAND_PANEL。覆盖默认 answer-node 推导级别 |
| data | object | 当 `data` 为非空对象时，用其作为结构化 delta 的 `content`，替代序列化输出 |

**recommends 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| (列表项) | string | 推荐问题文本，缓存 10 分钟 |

**tag 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| tag | string | 标签，`REJECT` 时 chat 更新为拒绝级别 |

**HOFS/ZENITH 偏差说明：** 1.0 产品规范提到 "PIU type 存储到 HOFS，其他存储到 ZENITH"。TS 运行时使用统一的 `TOOL_STRUCTURED_DELTA` 时间线事件模型，PIU 数据内联在结构化 delta content 中，不做独立的 HOFS/ZENITH 存储路由。这是对 1.0 产品规范的明确设计例外。---

## 五、loop_config / loopConfig（循环配置）

`loop_config`（或 `loopConfig`）是节点级可选字段，用于单节点或多节点间串行循环编排。

```yaml
loop_config:                     # 或 loopConfig
  loop_id: my_loop               # 或 loopId
  loop_cardinality: 3            # 或 loopCardinality
  loop_completion_condition: "${index >= 3}"   # 或 loopCompletionCondition
  loop_input_data_item: ${data_list}            # 或 loopInputDataItem
  loop_element_variable: item                  # 或 loopElementVariable
  loop_time_cycle: 0                           # 或 loopTimeCycle
  loop_start_node: current_node                # 或 loopStartNode
  loop_end_node: current_node                  # 或 loopEndNode
  loop_result_variable: loop_result            # 或 loopResultVariable
  loop_result_type: Map                        # 或 loopResultType
  loop_result_key: ${item.name}                # 或 loopResultKey
  loop_result_value: ${item.result}            # 或 loopResultValue
```

| 字段 | 类型 | 说明 |
|------|------|------|
| loop_id | string | 循环标识 |
| loop_cardinality | int (1-1000) | 循环次数 |
| loop_completion_condition | string | 循环结束条件 |
| loop_input_data_item | string | 循环输入数据列表（变量引用） |
| loop_element_variable | string | 循环元素临时变量名 |
| loop_time_cycle | int (>=0) | 循环间隔（秒） |
| loop_start_node | string | 循环起始节点 ID（默认为当前节点） |
| loop_end_node | string | 循环结束节点 ID（必须等于当前节点 ID） |
| loop_result_variable | string | 循环结果变量名 |
| loop_result_type | enum | List / Map |
| loop_result_key | string | Map 结果的 key 表达式 |
| loop_result_value | string | Map 结果的 value 表达式 |

**校验规则：**

- `loop_end_node` 必须等于声明 `loop_config` 的节点 ID。
- `loop_start_node` 必须存在于 Recipe 节点列表中（默认为 `loop_end_node`）。
- `loop_config` 与 `batch_config` 互斥，同一节点不可同时声明（加载器拒绝，reason code `WORKFLOW_BATCH_LOOP_CONFLICT`）。

---

## 六、batch_config / batchConfig（批量配置）

`batch_config`（或 `batchConfig`）是节点级可选字段，用于对一组数据元素执行批量并行/串行编排。当前支持 `restful`、`knowledge-search` 和 `llm-router` 三种节点类型。

```yaml
batch_config:                    # 或 batchConfig
  batch_input_data_item: ${alarm_list}    # 或 batchInputDataItem
  batch_element_variable: alarm          # 或 batchElementVariable
  batch_size: 10                        # 或 batchSize
  batch_mode: parallel                  # 或 batchMode
  batch_fail_strategy: continue          # 或 batchFailStrategy
  batch_parallelism: 5                  # 或 batchParallelism
  batch_result_merge: append             # 或 batchResultMerge
```

| 字段 | 类型 | 说明 |
|------|------|------|
| batch_input_data_item | array | 批量输入数据列表（必须为非空数组） |
| batch_element_variable | string | 元素临时变量名（默认 `element`） |
| batch_size | int (>=1) | 分批大小（默认 10） |
| batch_mode | enum | serial / parallel（默认 serial） |
| batch_fail_strategy | enum | continue / abort（默认 continue） |
| batch_parallelism | int (1-20) | 并行模式下的最大并发数（默认 5，上限 20） |
| batch_result_merge | enum | append / map（默认 append） |

**执行语义：**

1. 串行模式：按 `batch_size` 分批，每批内顺序执行，批间顺序执行。
2. 并行模式：以 `batch_parallelism` 为并发上限，对所有元素并发执行。
3. `continue`：元素失败记录到 `failed_items`，继续处理其余元素。
4. `abort`：元素失败后立即终止剩余元素，节点标记 `NODE_FAILED`。
5. 结果合并：`append` 为成功结果列表（过滤失败项）；`map` 以元素 `key` 字段（或索引）为 key 的对象映射。

**批量输出变量：**

| 变量 | 说明 |
|------|------|
| batch_results | 批量结果（append 为数组，map 为对象） |
| failed_items | 失败元素列表（含 index/item/error） |
| api_response | 最后一个成功元素的结果（restful 专有） |

**节点类型限制：**

| 节点类型 | batch_config 支持 | 说明 |
|---------|:---:|------|
| restful | YES | 每个 element 独立调用 capability |
| knowledge-search | YES | 每个 element 独立检索，空检索转为 failed item |
| llm-router | YES | 每个 element 独立 LLM 调用（强制非流式） |
| 其他节点 | NO | 不支持 |

---

## 七、Condition 条件语法

`condition: ""` 代表 true。多个 `next` 条件同时为 true 时顺序执行。

### 运算符

| 语法 | 说明 |
|------|------|
| `${...}` | 变量占位符 |
| `==`, `!=`, `<`, `>`, `<=`, `>=` | 比较运算 |
| `&&`, `\|\|` | 逻辑与/或 |
| `()` | 括号分组 |

> TS 引擎使用 `ConditionParser` 求值条件表达式，支持比较运算、逻辑运算、括号分组和变量路径解析。不支持 `size()`、`contains()`、`empty` 等 1.0 内置函数，如需使用可通过 `python` 节点预处理变量。
---

## 八、节点类型

### 8.1 流程控制节点

#### start-event

Recipe 流程入口，每个 Recipe 必须有且仅有一个 start-event。

```yaml
start_node:
  type: start-event
  description: "开始处理您的问题"
  next:
    next_node:
      condition: ""
```

| 字段 | 必填 | 说明 |
|------|:---:|------|
| type | 是 | 固定 `start-event`（或 `start_event`） |
| next | 是 | 入口分支，至少一个 |

start-event 不产生输出变量，仅做流程入口标记。

#### end-event

Recipe 流程终止节点。执行到 end-event 时，Recipe 终止，最终状态为 `COMPLETED`。

```yaml
end_node:
  type: end-event
  description: "处理结束"
```

| 字段 | 必填 | 说明 |
|------|:---:|------|
| type | 是 | 固定 `end-event`（或 `end_event`） |

end-event 不需要 `next`，执行后返回 `TERMINAL` transition。

#### parallel-gateway

并行网关，支持 fork/join 并行执行多条分支。当多个 `next` 条件为 true 时，所有匹配分支并发执行，在 join 节点汇合。

```yaml
parallel_node:
  type: parallel-gateway
  description: "并行查询"
  inputs:
    join_node: join_result
    join_on_failure: wait
    join_timeout: 600
  next:
    branch_a:
      condition: ""
    branch_b:
      condition: ${need_kb == true}
```

**inputs 子字段：**

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| join_node | string | 自动推断 | 汇合节点 ID。未指定时自动推断所有分支首个公共 END 节点 |
| join_on_failure | enum | wait | 分支失败策略：`wait`（等待所有分支完成）/ `break`（任一分支失败即终止） |
| join_timeout | int | 600 | 汇合超时（秒） |

> parallel-gateway 的 next 条件支持变量表达式。单个分支命中时退化为单路跳转（不产生 fork）。

#### exclusive-gateway

排他网关，按 next 条件顺序求值，选择第一个匹配的分支跳转。最后一条空 condition 分支作为 fallback。

```yaml
weather_route:
  type: exclusive-gateway
  description: "天气路由"
  next:
    sunny_path:
      condition: ${weather == "晴"}
    rainy_path:
      condition: ${weather == "雨"}
    default_path:
      condition: ""
```

| 字段 | 必填 | 说明 |
|------|:---:|------|
| next | 是 | 分支列表，至少一个。最后一条可用 `condition: ""` 作为默认分支 |

> 无 fallback 且无匹配分支时抛 `WORKFLOW_EXCLUSIVE_GATEWAY_NO_MATCH`。

#### delay-gateway

延迟网关，等待指定时间后继续执行。

```yaml
delay_node:
  type: delay-gateway
  description: "等待10秒"
  inputs:
    delay_time: 10
  next:
    next_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| delay_time | int (>=0) | 0 | 延迟时间（秒） |

**输出变量：**

| 变量 | 说明 |
|------|------|
| delay_result | `{ completed: true, delayMs }` |
| delayed | `true` |
| delay_ms | 实际延迟毫秒数 |

#### interrupt-gateway

中断网关，暂停 Recipe 执行等待外部恢复信号。恢复后继续执行后续节点。

```yaml
interrupt_node:
  type: interrupt-gateway
  description: "等待外部审批"
  timeout: 120
  next:
    after_interrupt:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| timeout | int (>=1) | 等待超时（秒），复用 node.timeout |

**输出变量（恢复后）：**

| 变量 | 说明 |
|------|------|
| interrupt_result | `{ resumed: true, pendingInputId, pendingAnswerSummary }` |
| resumed | `true` |

> interrupt-gateway 依赖 `requestPendingInput` 边界。超时后抛 `WORKFLOW_NODE_TIMEOUT`。

### 8.2 LLM 节点

#### llm-router

LLM 路由节点，核心文本生成节点。支持流式输出、结构化输出校验和模板化 prompt。

```yaml
llm_node:
  type: llm-router
  description: "总结天气，给出建议"
  inputs:
    llm_type: NetGPT
    model: gpt-4o
    prompt_template: "请根据天气状态：${elementVariables}，给出出行建议。"
    is_stream: "true"
    outputSchema:
      type: object
      properties:
        suggestion:
          type: string
      required: [suggestion]
  outputs:
    result: ${llm_completion}
  next:
    end_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| llm_type | string | 模型类型标识（1.0 兼容字段，TS 归一化为 modelId hint） |
| model | string | 模型名称，覆盖默认模型选择 |
| model_group | string | **预留**，当前不支持按 group 路由，仅应用 model 名称覆盖 |
| prompt_template | string | prompt 模板，支持 `${var}` 变量插值 |
| prompt_template_name | string | 命名 prompt 模板（需 runtime 提供 `prepareLlmPrompt`） |
| is_stream / isStream | string | 是否流式输出：`"true"` / `"false"` |
| outputSchema | object | JSON Schema，指定后 LLM 输出必须通过校验 |
| result_with_think | string | `"true"` 时输出包含 `{ content, reasoning }` |
| model_params | object | 模型推理参数（temperature/maxTokens 等） |

**输出变量：**

| 变量 | 说明 |
|------|------|
| llm_completion | LLM 完成内容（已解析 JSON 或原始文本） |
| llm_result | `{ content, reasoning?, toolCalls?, finishReason?, usage? }` |
| invocation_trace | 调用诊断信息 |

**流式输出规则：**

1. 显式 `is_stream: "true"` 或 `is_stream: "false"` 优先。
2. 未指定时：主 Recipe（非 sub-recipe）且 `next` 直指 end-event → 默认流式；否则非流式。
3. batch_config 模式下强制非流式。

> `model_group` 为预留字段，当前仅 `model` 字段生效。

#### intent-recognition

意图识别节点，将用户输入分类到预定义意图。支持规则匹配快捷路径和 LLM 推理两条路径。

```yaml
intent_node:
  type: intent-recognition
  description: "识别用户意图"
  inputs:
    query_text: ${input_question}
    candidate_intents:
      - 故障诊断
      - 性能查询
      - 配置变更
  outputs:
    intent: ${intent}
    confidence: ${confidence}
  next:
    diag_recipe:
      condition: ${intent == "故障诊断"}
    end_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| query_text | string | 待识别的输入文本 |
| candidate_intents | array | 候选意图列表 |
| prompt_template | string | 自定义 prompt 模板 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| intent_recognition_result | `{ intent, confidence, source }` |
| intent | 识别到的意图名称 |
| confidence | 置信度（0-1） |

> 规则匹配由 runtime `resolveIntentRules` 提供，命中时跳过 LLM 调用。LLM 输出必须为 `{ intent: string, confidence: number }` JSON。

#### question-rewriting

问题改写节点，将原始问题改写为更适合检索或推理的形式，保留电信术语。

```yaml
rewrite_node:
  type: question-rewriting
  description: "改写用户问题"
  inputs:
    input_question: ${input_question}
    history_summary: ${conversation_summary}
    domain_context: "5G核心网运维"
  outputs:
    rewritten_question: ${rewritten_input_question}
  next:
    knowledge_search:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| input_question | string | 原始问题 |
| history_summary | string | 对话历史摘要 |
| domain_context | string | 领域上下文 |
| prompt_template | string | 自定义 prompt 模板 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| question_rewriting_result | `{ rewrittenQuery, askQuestion? }` |
| rewritten_input_question | 改写后的问题 |

#### translation

翻译节点，支持多语言翻译。

```yaml
translate_node:
  type: translation
  description: "翻译告警描述"
  inputs:
    text: ${alarm_description}
    source_lang: en
    target_lang: zh
  outputs:
    result: ${translated_text}
  next:
    next_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| text | string | - | 待翻译文本 |
| source_lang / sourceLang | string | auto | 源语言 |
| target_lang / targetLang | string | ZH | 目标语言 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| translation_result | `{ translatedText }` |
| translated_text | 翻译结果 |

#### param-extract

参数提取节点，从自然语言文本中提取结构化参数。

```yaml
extract_node:
  type: param-extract
  description: "提取告警参数"
  inputs:
    text: ${input_question}
    source_text: ${raw_input}
    model: gpt-4o
  outputs:
    extracted_params: ${extracted_params}
  next:
    restful_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| text | string | 待提取文本（优先取 text，其次 source_text） |
| model | string | 覆盖默认模型 |
| model_group | string | **预留**，当前不支持 |
| prompt_template | string | 自定义 prompt 模板 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| param_extract_result | `{ extractedParams }` |
| extracted_params | 提取出的参数对象 |

### 8.3 能力调用节点

#### restful

RESTful 能力调用节点，通过 capability invocation 调用上游 API。支持参数自动提取、长任务轮询和自定义重试。

```yaml
weather_api:
  type: restful
  description: "查询天气接口"
  inputs:
    api_name: weather_query
    city: ${city_name}
  outputs:
    elementVariables: ${api_response}
  next:
    sunny_path:
      condition: ${elementVariables[0] == "晴"}
    default_path:
      condition: ""
```

**inputs 基础字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| api_name | string | 是 | capability ID，对应注册的 API 能力标识 |
| (其他参数) | any | 否 | 透传给 capability 的业务参数 |

**inputs 控制字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| fm_extract_parameter | bool | 启用 LLM 参数自动提取（需 inputSchema 支持） |
| model | string | 参数提取使用的模型 |
| param_extract_prompt_template | string | 参数提取自定义 prompt |
| is_long_api | bool | 是否为长任务 API（启用轮询模式） |
| stream_type | string | SSE 流式模式开关，仅支持 `"sse"`；启用后通过 CLIP `subscribe` 原语流式调用，流式事件实时上报，最终聚合结果作为 `api_response` 输出。与批处理（`batchInputDataItem`）和长轮询（`is_long_api`）互斥 |
| retry_times | int | 自定义重试次数（不含首次） |
| retry_wait_time | int | 重试间隔（秒） |
| poll_max_times | int | 最大轮询次数（长任务模式必填） |
| poll_interval | int | 轮询间隔（秒） |
| poll_timeout | int | 轮询总超时（秒） |
| poll_single_timeout | int | 单次轮询超时（秒） |
| on_poll_error | enum | 轮询错误策略：`skip` / `terminate`（默认 terminate） |

**输出变量：**

| 变量 | 说明 |
|------|------|
| api_response | capability 返回的完整 payload |
| invocation_trace | 调用诊断信息 |

> restful 节点支持 batch_config（见第六章）。长任务轮询模式下，每次轮询结果累计到 `poll_results`。

#### python

Python 沙箱执行节点，通过 sandbox gateway 执行 Python 脚本。

```yaml
python_node:
  type: python
  description: "计算告警严重度"
  inputs:
    script: |
      result = sorted(alarms, key=lambda x: x['severity'], reverse=True)
      return {'top_alarms': result[:5]}
    alarms: ${alarm_list}
    param_to_json_str: false
  outputs:
    analysis_result: ${python_result}
  next:
    display_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| script | string | 是 | Python 脚本内容 |
| param_to_json_str | bool | 否 | 为 true 时将输入参数序列化为 JSON 字符串字面量 |
| (其他参数) | any | 否 | 自动声明为 Python 变量注入脚本 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| python_result | 脚本返回值（自动解析 JSON） |
| invocation_trace | 调用诊断信息 |

> python 节点通过 sandbox gateway 执行，不使用宿主进程权限。脚本中的非 script 参数自动作为变量前声明注入。

### 8.4 知识节点

#### knowledge-search

知识检索节点，从知识库检索相关文档。

```yaml
kb_search:
  type: knowledge-search
  description: "检索故障知识"
  inputs:
    query: ${input_question}
    rag_index:
      - index_name: fault_kb
        index_type: KNOWLEDGE
        vs_topN: 10
        es_topN: 20
    rank_topN: 1
  outputs:
    search_result: ${knowledge_search_result}
    recall: ${recall_result}
  next:
    llm_summary:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| query | string | - | 检索查询文本 |
| rag_index / ragIndex | array | - | 知识库索引列表 |
| rank_topN | int | 1 | 排序后返回数量（1-10） |
| vs_topN | int | 10 | 向量召回数量（1-20） |
| es_topN | int | 20 | ES 召回数量 |
| filters | object | - | 过滤条件 |
| enable_query_rewrite | bool | false | 是否启用查询改写 |

**rag_index 子项字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| index_name | string | 索引名称 |
| index_type | enum | API / RECIPE / KNOWLEDGE |
| priority | int | 优先级 |
| vs_topN | int | 向量召回数 |
| es_topN | int | ES 召回数 |
| filters | object | 过滤条件 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| knowledge_search_result | 匹配文档的 knowledge 文本列表 |
| recall_result | 原始推荐列表（含完整 metadata） |

> 检索结果为空时抛 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`。支持 batch_config。

#### knowledge-qa

知识问答节点，检索知识后通过 LLM 生成摘要回答。支持 free-infer 快捷路径。

```yaml
kb_qa:
  type: knowledge-qa
  description: "知识问答"
  inputs:
    query: ${input_question}
    rag_index:
      - index_name: fault_kb
        index_type: KNOWLEDGE
    open_free_infer: true
    model: gpt-4o
  outputs:
    answer: ${knowledge_qa_result}
    llm_completion: ${llm_completion}
  next:
    end_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| query | string | 查询文本 |
| rag_index / ragIndex | array | 知识库索引列表（同 knowledge-search） |
| open_free_infer / openFreeInfer | bool | 启用 free-infer 快捷路径 |
| model | string | 摘要生成使用的模型 |
| model_group | string | **预留** |
| loop_element_variable | string | 知识摘要循环元素变量名（默认 `knowledge`） |
| prompt_template | string | 自定义摘要 prompt |

**输出变量：**

| 变量 | 说明 |
|------|------|
| knowledge_qa_result | LLM 摘要列表 |
| knowledge_search_result | 原始知识文本列表 |
| llm_completion | 最后一次 LLM 完成内容 |
| recall_result | 原始推荐列表 |
| knowledge_diagnostic | `{ status, reason? }` |

> free-infer 命中时跳过知识检索和 LLM 调用，直接返回缓存答案。检索结果为空时输出空列表，不调用 LLM。

#### api-choice

API 选择节点，通过 RAG 召回或候选列表 + LLM 选择最合适的 API。

```yaml
api_choice_node:
  type: api-choice
  description: "选择查询API"
  inputs:
    query: ${input_question}
    open_api_recall: true
    rag_index:
      - index_name: api_registry
        index_type: API
    candidate_apis:
      - apiName: weather_query
        description: "查询天气"
        paramsSchema:
          type: object
          properties:
            city: { type: string }
  outputs:
    selected_api: ${api_name}
  next:
    call_api:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| query | string | 查询文本 |
| open_api_recall / openApiRecall | bool | 启用 API RAG 召回 |
| open_api_knowledge_recall / openApiKnowledgeRecall | bool | 同时检索知识库 |
| rag_index / ragIndex | array | RAG 索引列表 |
| candidate_apis / candidateApis | array | 候选 API 列表 |
| model | string | LLM 选择使用的模型 |

**candidate_apis 子项字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| apiName | string | API 名称（capability ID） |
| description | string | API 描述 |
| paramsSchema | object | API 参数 JSON Schema |

**输出变量：**

| 变量 | 说明 |
|------|------|
| api_name | 选中的 API 名称 |
| recall_result | RAG 召回结果（使用 RAG 路径时） |

> 无 RAG 索引且无 candidate_apis 时抛 `WORKFLOW_API_CHOICE_NO_CANDIDATES`。

#### recipe-choice

Recipe 选择节点，通过 RAG 召回或候选列表 + LLM 选择最合适的子 Recipe。

```yaml
recipe_choice_node:
  type: recipe-choice
  description: "选择处理Recipe"
  inputs:
    query: ${input_question}
    candidate_recipes:
      - alarm_diag
      - performance_check
  outputs:
    selected_recipe: ${recipe_name}
  next:
    sub_recipe:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| query | string | 查询文本 |
| candidate_recipes / candidateRecipes | array | 候选 Recipe 名称列表 |
| model | string | LLM 选择使用的模型 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| recipe_name | 选中的 Recipe 名称 |

### 8.5 交互节点

#### user-check

用户交互节点，暂停 Recipe 等待用户输入。支持四种 kind，每种有独立的交互形态。

**kind: QUESTION（问答型）**

```yaml
ask_node:
  type: user-check
  description: "询问用户城市"
  inputs:
    kind: QUESTION
    question: "请选择您要查询的城市"
    action_type: choice
    options:
      - label: "北京"
        value: "beijing"
      - label: "上海"
        value: "shanghai"
  outputs:
    user_answer: ${user_check_result}
    answer_values: ${answer_values}
  next:
    next_node:
      condition: ""
```

QUESTION 的 `action_type` 支持 `choice` / `input`：
- `choice`：选项列表，用户选择一个。
- `input`：自由输入。当 `fields` 为多字段数组时，每个 field 独立提问，结果绑定到 `user_check_result` 对象。

**kind: CONFIRMATION（确认型）**

```yaml
confirm_node:
  type: user-check
  description: "确认执行变更"
  inputs:
    kind: CONFIRMATION
    question: "确认要执行此项变更操作吗？"
  outputs:
    confirmed: ${user_check_result}
  next:
    execute:
      condition: ${user_check_result == "approve"}
    cancel:
      condition: ${user_check_result == "reject"}
```

CONFIRMATION 固定提供 `approve` / `reject` 两个选项，不支持自定义 options。

**kind: AUTHORIZATION（授权型）**

```yaml
auth_node:
  type: user-check
  description: "请求授权"
  inputs:
    kind: AUTHORIZATION
    question: "此操作需要管理员授权，是否批准？"
  outputs:
    authorized: ${user_check_result}
  next:
    proceed:
      condition: ${user_check_result == "approve"}
    deny:
      condition: ${user_check_result == "deny"}
```

AUTHORIZATION 固定提供 `approve` / `deny` 两个选项。

**kind: HUMAN_HANDOFF（人工转接型）**

```yaml
handoff_node:
  type: user-check
  description: "转接人工客服"
  inputs:
    kind: HUMAN_HANDOFF
    question: "您的问题需要人工处理，正在为您转接客服..."
  next:
    end_node:
      condition: ""
```

HUMAN_HANDOFF 不等待用户回复，直接输出提示文本后 `TERMINAL` 终止 Recipe。

**user-check 通用 inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| kind | enum | QUESTION / CONFIRMATION / AUTHORIZATION / HUMAN_HANDOFF（默认 QUESTION） |
| question | string | 提示文本（也可用 prompt / tips） |
| action_type / actionType | enum | choice / input（仅 QUESTION 有效） |
| options | array | 选项列表（choice 模式必填），子项 `{ label, value }` |
| fields | array | 输入字段列表（input 模式多字段），子项 `{ name, description }` |

**输出变量（恢复后）：**

| 变量 | 说明 |
|------|------|
| user_check_result | 选择结果（choice 模式为选中 value；input 单字段为 summary） |
| selectedOption | 选中选项值（choice 模式） |
| answer_values | 回答值二维数组 |
| user_check_input | input 模式的 summary（仅 input 模式） |

> user-check 依赖 `requestPendingInput` 边界。超时后抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）。

#### display-content

内容展示节点，将节点输出或变量内容以结构化方式呈现给用户。不使用 `inputs`，内容来源为 `outputs` 或全局变量。

```yaml
display_node:
  type: display-content
  description: "展示查询结果"
  outputs:
    title: "查询结果"
    content: ${api_response.summary}
  presentation:
    output_parser:
      show_title: true
      show_content: true
      show_aigc: false
      type: TEXT
      message_level: ANSWER
  next:
    end_node:
      condition: ""
```

**outputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| (任意 key) | string / object | 展示内容。单条取值，多条按换行拼接。OBJECT 类型时整体作为 JSON 输出 |

> display-content 不声明 `inputs`。内容来源优先级：outputs 字段 > 全局变量 `display_content` / `text`。HTML 类型内容经过安全过滤（屏蔽 script/style/iframe 等标签）。

**输出变量：**

| 变量 | 说明 |
|------|------|
| display_content_result | `{ content, projected: true, type }` |
| display_content | 序列化后的展示内容字符串 |

**展示类型（presentation.output_parser.type）：**

| 类型 | 说明 |
|------|------|
| TEXT | 纯文本展示 |
| OBJECT | JSON 对象展示 |
| HTML | HTML 展示（经安全过滤） |
| TABLE | 表格展示 |
| CHART | 图表展示 |
| DSL | DSL 展示 |

#### guardrail-check

护栏检查节点，对内容进行安全策略校验。

```yaml
guardrail_node:
  type: guardrail-check
  description: "输入安全检查"
  inputs:
    policy_id: guardrail:question
    guardrail_type: QUESTION
    content: ${input_question}
    guardrail_params:
      max_length: 500
  outputs:
    passed: ${guardrail_result}
    reason: ${reason}
  next:
    proceed:
      condition: ${guardrail_result == true}
    reject:
      condition: ${guardrail_result == false}
```

**inputs 子字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| policy_id / policy_id | string | 护栏策略 ID。未指定时根据 guardrail_type 自动生成 |
| guardrail_type / guardrail_type | enum | QUESTION / TOPIC / ANSWER |
| content | string | 待检查内容（也可用 text / prompt） |
| guardrail_params / guardrail_params | object | 护栏参数 |

**输出变量：**

| 变量 | 说明 |
|------|------|
| guardrail_result | `true`（通过）/ `false`（拒绝） |
| guardrail_response | `{ decision, safeReason?, policy_id }` |
| result | `"pass"` / `"block"` |
| reason | 拒绝原因（拒绝时为 `GUARDRAIL_REJECTED`） |

> 护栏返回 `REJECT` 时，`guardrail_result` 为 `false`，但节点本身不抛异常。调用方通过 next 条件路由。护栏边界不可用时抛 `WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE`。

#### sub-recipe

子 Recipe 调用节点，嵌套执行另一个已注册的 Recipe。父子 execution 之间仅通过显式 mapping 交换输入输出，不隐式共享变量。

```yaml
sub_recipe_node:
  type: sub-recipe
  description: "调用告警诊断子Recipe"
  inputs:
    recipe_name: alarm_diag_recipe
    inputMapping:
      alarm_id: ${alarm_id}
      input_question: ${input_question}
    outputMapping:
      diag_summary: ${outputs.diag_result}
  outputs:
    diag_result: ${recipe_result}
    sub_info: ${sub_recipe_result}
    summary: ${diag_summary}
  next:
    end_node:
      condition: ""
```

**inputs 子字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| recipe_name | string | 是 | 子 Recipe 名称（支持 `${var}` 插值） |
| inputMapping | object | 是 | 父变量到子 Recipe inputVariables 的显式映射，值为 `${var}` 模板 |
| outputMapping | object | 否 | 子 Recipe outputVariables 到父节点 binding scope 的显式映射；省略时不回写额外输出 |
| is_node_record_with_recipe_result | bool | 否 | node_record_info 是否更新 recipe_result，默认 false（MAE-CN 场景自动 true） |

**输出变量：**

| 变量 | 说明 |
|------|------|
| sub_recipe_result | `{ recipe_name, executionId, status }` |
| recipe_result | 子 Recipe answer 节点的输出（END 前最后一个非网关节点） |
| node_record_info | 子 Recipe 节点执行记录 |

> sub-recipe 通过显式 `inputMapping`（必填）构造子 Recipe 输入，通过可选 `outputMapping` 映射子流程输出。`recipe_result`、`sub_recipe_result` 和 `node_record_info` 默认绑定，`outputMapping` 用于消费子流程中间节点输出。最大嵌套深度 3 层，超出抛 `WORKFLOW_SUB_RECIPE_DEPTH_EXCEEDED`。子 Recipe 失败时抛对应 SafeError。
---

## 九、节点类型别名映射

加载器在归一化时将 1.0 DSL 的 kebab-case 节点类型映射为 TS 内部枚举。DSL 作者只需使用左列写法。

| DSL 类型（kebab-case） | 别名兼容 |
|------|------|
| `start-event` | `start_event` |
| `end-event` | `end_event` |
| `llm-router` | - |
| `intent-recognition` | - |
| `question-rewriting` | - |
| `translation` | - |
| `param-extract` | - |
| `restful` | `api-invoke` |
| `python` | - |
| `display-content` | - |
| `guardrail-check` | `guardrail_check` |
| `knowledge-search` | - |
| `knowledge-qa` | - |
| `api-choice` | - |
| `recipe-choice` | - |
| `user-check` | - |
| `interrupt-gateway` | `suspend` |
| `sub-recipe` | - |
| `parallel-gateway` | `inclusive-gateway` |
| `exclusive-gateway` | - |
| `delay-gateway` | - |

**已废弃节点类型（加载时警告，不阻止加载）：**

| DSL 类型 | 状态 |
|------|------|
| `data-analysis` | 已废弃，不建议使用 |
| `agent` | 已废弃，不建议使用 |
| `tool` / `tool-invoke` | 已废弃，不建议使用 |
| `tool-choice` / `tool_choice` | 已废弃，不建议使用 |

> 已废弃节点类型仍被加载器接受（记录 `WORKFLOW_NODE_DEPRECATED` 警告日志），但本规范不推荐使用，且不再在 DSL 章节中描述其用法。

---

## 十、执行能力

### 检查点与恢复

Recipe 因 user-check / interrupt-gateway 暂停或异常中断后，可通过恢复请求（携带 `resumeState`）从暂停节点继续执行。恢复请求必须携带与原始请求一致的 `agentId`（Agent Scope 一致性）。

### 生命周期事件与流式输出

引擎通过 `WorkflowExecutionObserver` 发出 `NODE_STARTED`/`NODE_COMPLETED`/`NODE_FAILED`/`RECIPE_COMPLETED`/`RECIPE_FAILED`/`RECIPE_INTERRUPTED` 等结构化事件。LLM 节点在流式模式下通过 `emitOutputDelta` 逐 chunk 发出 `WorkflowVisibleDelta`（CONTENT channel 为正文增量，THINKING channel 为推理增量），流式 delta 中的 content 受安全脱敏约束。

---

## 十一、完整示例

以下示例展示一个包含知识检索、LLM 路由、用户确认和异常处理的完整 Recipe。示例中出现的 `retry`、`presentation` 为预留字段（暂不支持，见 4.1 / 4.4），仅作结构示意：

```yaml
name: alarm_diag_recipe
description: 告警智能诊断流程
domain: NAIE
scene: alarm_diagnosis
type: boot-recipe
version: 1.1.0
lang: zh
expandFields:
  recipe_ne_version: "1.0"
  recipe_ne_type: 5G_CORE
runtime:
  control_policy:
    cancel:
      rollback_node:
        condition: ""
    cancel_timeout: 60
nodes:
  start_node:
    type: start-event
    description: "开始处理告警"
    next:
      intent_node:
        condition: ""

  intent_node:
    type: intent-recognition
    description: "识别用户意图"
    inputs:
      query_text: ${input_question}
      candidate_intents:
        - 故障定位
        - 根因分析
        - 解决方案推荐
    outputs:
      intent: ${intent}
      confidence: ${confidence}
    next:
      kb_search:
        condition: ""
      end_node:
        condition: ${confidence < 0.5}

  kb_search:
    type: knowledge-search
    description: "检索故障知识库"
    inputs:
      query: ${input_question}
      rag_index:
        - index_name: alarm_kb
          index_type: KNOWLEDGE
          vs_topN: 10
          es_topN: 20
      rank_topN: 3
    outputs:
      search_result: ${knowledge_search_result}
      recall: ${recall_result}
    retry:
      max_attempts: 2
      backoff: fixed
      delay: 3
    timeout: 30
    exception:
      error_handler: ""
    next:
      llm_summary:
        condition: ""

  error_handler:
    type: display-content
    description: "知识检索失败提示"
    outputs:
      content: "知识库暂时不可用，请稍后重试。"
    presentation:
      output_parser:
        show_title: true
        show_content: true
        type: TEXT
        message_level: ANSWER
    next:
      end_node:
        condition: ""

  llm_summary:
    type: llm-router
    description: "基于知识库生成诊断建议"
    inputs:
      llm_type: NetGPT
      model: gpt-4o
      prompt_template: |
        请根据以下知识库内容和用户问题，给出告警诊断建议。
        知识库内容：${knowledge_search_result}
        用户问题：${input_question}
        告警ID：${alarm_id}
    is_stream: "true"
    outputs:
      result: ${llm_completion}
    next:
      confirm_node:
        condition: ""

  confirm_node:
    type: user-check
    description: "确认诊断结果"
    inputs:
      kind: CONFIRMATION
      question: "是否需要进一步排查？"
    timeout: 120
    outputs:
      confirmed: ${user_check_result}
    next:
      handoff_node:
        condition: ${user_check_result == "approve"}
      display_result:
        condition: ${user_check_result == "reject"}

  handoff_node:
    type: user-check
    description: "转接专家"
    inputs:
      kind: HUMAN_HANDOFF
      question: "正在为您转接网络运维专家，请稍候..."
    next:
      end_node:
        condition: ""

  display_result:
    type: display-content
    description: "展示诊断结果"
    outputs:
      content: ${llm_completion}
    presentation:
      output_parser:
        show_title: true
        show_content: true
        show_aigc: true
        type: TEXT
        message_level: ANSWER
    next:
      end_node:
        condition: ""

  end_node:
    type: end-event
    description: "处理结束"
```

## 附录 A：1.0 兼容语法

以下语法为 1.0 DSL 原生写法，加载器仍接受并归一化，但推荐使用 2.0 推崇写法（见主章节）。

| 1.0 写法 | 2.0 推崇写法 | 归一化行为 |
|------|------|------|
| 节点级 `outputParser` / `outputs.output_parser` | `presentation.output_parser` | 提取到 `node.outputParser`，从 `outputs` 移除 |
| 节点级 `recommends` / `tag` | `presentation.recommends` / `presentation.tag` | 合并到 `presentation` |
| `loop` / `loopConfig` | `loop_config` | 归一化为内部 `loopConfig` |
| `retryPolicy`（`maxRetries`） | `retry`（`max_attempts`） | `maxAttempts = maxRetries + 1` |
| `expandFields` / `metadata` | `expandFields` | 归一化为内部 `metadata` |
| `onError` | `exception` | 归一化为内部 `exception` |
