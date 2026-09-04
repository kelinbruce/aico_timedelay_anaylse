# Recipe YAML 规范完整手册

> 本文件为 Recipe YAML 工作流执行规范的压缩精简版，包含所有原始规范的完整信息，可据此还原全部37+源文件。

---

## 一、Recipe 顶层结构

```yaml
name: demo_recipe
description: demo desc
domain: NAIE
scene: demo
type: boot-recipe
version: 1.1.0
lang: zh
agentName: my-agent
schema_version: 27.0.0
expandFields:
  recipe_ne_version: 1.0
  recipe_ne_type: xxx
nodes:
  start_node: ...
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | Recipe名称，最长255，与domain组合唯一 |
| description | string | 否 | 描述，最长512 |
| domain | string | 是 | 域，与name组合唯一，最长512 |
| scene | string | 是 | 场景，最长512 |
| version | string | 是 | 版本，最长32 |
| lang | enum | 否 | 语言："zh"/"en"，无zh/en目录时必填 |
| type | enum | 否 | boot-recipe或recipe，默认recipe，每个Agent仅一个boot-recipe |
| agentName | string | 否 | Agent名称，小写英文+数字+连字符+下划线，小写开头，最长64，多Agent场景必填 |
| schema_version | string | 否 | 版本控制：缺省=旧流程；"27.0.0"=问题改写新流程；"default"=旧流程 |
| expandFields | object | 否 | 扩展字段，键值均可自定义，可用于DB搜索 |
| nodes | list\<node\> | 是 | 节点列表 |

**内置上下文环境变量：** `input_question`(用户原始问题), `output_result`(LLM问答输出), `api_response`(API调用响应体), `prompt_template`(prompt模板)

**重要规则：** 参数值只支持字符串，数字需加引号。

---

## 二、节点通用结构

```yaml
node_name:
  type: "node-type"
  description: "节点描述"
  version: "27.0.0"
  inputs:
    key1: value1
  outputs:
    key1: ${output_var}
  next:
    next_node_1:
      condition: ""
    next_node_2:
      condition: "${var == 'value'}"
  recommends:
    - "推荐问题1"
    - "推荐问题2"
  loop:
    loop_cardinality: 3
    loop_completion_condition: ""
    loop_input_data_item: ${data_list}
    loop_element_variable: item

```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 节点名(key) | string | 是 | 字母开头，Recipe内唯一 |
| type | string | 是 | 节点类型 |
| description | string | 否 | 节点描述，LUI展示标题 |
| version | string | 否 | 节点版本，"27.0.0"=新流程，"default"=旧流程，缺省用schema_version |
| inputs | list | 视节点 | 输入参数 |
| outputs | list | 视节点 | 输出参数 |
| output_parser | object | 否 | PIU显示控制 |
| recommends | list\<string\> | 否 | 推荐问题列表，缓存10分钟 |
| loop | object | 否 | 循环配置 |
| next | list | 是 | 下一步节点，condition=""代表true，至少一个条件可满足 |
| exception | map | 否 | key=目标节点名，value=异常详情(预留)，默认"" |

**NextAgent TS 执行补充约束：** 当前已接入的节点在执行期都可以向上层 runtime 投影安全的中间可见结果；该流式投影属于执行期能力，不要求在 Recipe DSL 中新增独立字段。

### output_parser 子字段

| 字段 | 说明 |
|------|------|
| show_title | 是否显示节点标题，默认true |
| show_content | 是否显示节点内容，默认true |
| show_aigc | 是否显示AIGC，默认false |
| message_level | 显示位置：TITLE/DETAIL/ANSWER/EXPAND_PANEL |
| type | PIU数据类型：TEXT/CHART/CHART_PRO/HTML/TABLE/PIU/DSL |
| data | PIU数据内容，含piuName/piuVersion/date等 |

### loop 子字段

| 字段 | 说明 |
|------|------|
| loop_cardinality | 循环次数 |
| loop_completion_condition | 循环结束条件 |
| loop_input_data_item | 循环输入数据列表 |
| loop_element_variable | 循环元素临时变量名 |
| loop_result | 循环结果，loop_result_type: Map/List；Map时需loop_result_key+loop_result_value |

---

## 三、Condition 条件语法

`condition=""` 代表 true。多个 next 条件同时为 true 时顺序执行。

### 运算符

| 语法 | 说明 | 示例 |
|------|------|------|
| `${...}` | 变量占位符 | `${object.field == "field"}` |
| `==`, `!=`, `<`, `>`, `<=`, `>=` | 比较运算 | `${big != small}` |
| `&&`, `||` | 逻辑与/或 | `${a >= b && c == "d"}` |
| `()` | 括号 | `${bool1 && (str1 == "he" || int1 > 2)}` |
| 字符串用`""`，数字裸写，布尔true/false | 字面量 | `${age >= 20 && flag == true}` |

### 内置函数

| 函数 | 说明 | 示例 |
|------|------|------|
| `size()` | 数组/字符串长度 | `${list.size() != 0}` |
| `contains()` | 包含判断 | `${list.contains("field")}` |
| `empty` | 为空判断 | `${empty global_vars.node1}` |
| `!empty` | 非空判断 | `${!empty global_vars.node1.str1}` |
| `toUpperCase()` | 转大写 | `${str1.toUpperCase() == "HELLO"}` |
| `toLowerCase()` | 转小写 | `${str1.toLowerCase() == "hello"}` |

**警告：** condition 内容禁止包含 `.getClass().forName("` 字符串，否则运行报错。

---

## 四、Prompt 模板语法

### 普通变量
`{{xxx}}` 或 `${xxx}` 定义可替换变量。25.1版本同时兼容两种写法。推荐用`{{}}`，`${}`变量不存在时报错。

### For循环（单层，最多3个）
```
{% for a in b %}
${a.field}
{% endfor %}
```
不支持嵌套循环。

### $slots 风格替换
```
{% for style in $slots.{{filename}}[style_name] %}
{{style.name}} | {{style.description}} | {{style.styleSample}}
{% endfor %}
```

---

## 五、全部节点类型详细规格

### 5.1 基础节点

#### start-event（开始节点）
流程入口，必须有且仅有一个。

```yaml
start_node:
  type: "start-event"
  description: "开始处理"
  next:
    next_node:
      condition: ""
```
无 inputs/outputs。

---

#### end-event（结束节点）
流程结束标记。

```yaml
end_node:
  type: "end-event"
  description: "结束"
```
无 inputs/outputs/next。

---

#### llm-router（LLM问答节点，原名prompt）

```yaml
llm_node:
  type: "llm-router"
  description: "LLM处理"
  inputs:
    prompt_template: "请根据${input_question}回答"
    prompt_template_name: ""
    model: ""
    modelGroup: ""
    capability: ""
    is_stream: false
    result_with_think: true
    model_params:
      enable_thinking: true
    enableTranslation: false
    translation_config:
      translation_type: large_model
      outbound_type: sl_en
      translation_prompt: ""
      translation_result_check: false
  outputs:
    result: ${llm_completion}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| prompt_template | string | 是 | LLM输入prompt模板，优先级：prompt_template > prompt_template_name > 系统预设 |
| prompt_template_name | string | 否 | prompt模板名，prompt_template为空时生效 |
| model | string | 否 | 模型名称 |
| modelGroup | string | 否 | 模型路由分组 |
| capability | string | 否 | 能力项 |
| is_stream | bool | 否 | 是否流式输出，默认false |
| result_with_think | bool | 否 | 是否包含think标签，默认true |
| model_params | Map | 否 | 模型扩展参数，透传 |
| enableTranslation | bool | 否 | 小语种翻译开关 |
| translation_config | Object | 否 | 翻译配置：translation_type/ outbound_type/translation_prompt/translation_result_check |

outputs：自定义key绑定 `${llm_completion}`

---

#### restful（RESTful API调用节点）

```yaml
api_node:
  type: restful
  description: "查询接口"
  inputs:
    api_name: weather_query
    api_group: ""
    fm_extract_parameter: false
    is_long_api: false
    retry_times: "3"
    retry_wait_time: "5"
    intervals: "10"
    overtime: "300"
    singleOvertime: "30"
    model: ""
    open_reflection: false
  outputs:
    elementVariables: ${api_response}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| api_name | string | 是 | 要执行的API名称 |
| api_group | string | 否 | API分组，用于API查找 |
| fm_extract_parameter | bool | 否 | 是否用LLM提取参数，默认false |
| is_long_api | bool | 否 | 是否长任务，默认false |
| stream_type | string | 否 | SSE流式模式开关，仅支持"sse"；启用后通过CLIP subscribe原语流式调用，流式事件实时上报，最终聚合结果作为`api_response`输出。与批处理（batchInputDataItem）和长轮询（is_long_api）互斥 |
| retry_times | int | 否 | API异常重试次数 |
| retry_wait_time | int | 否 | 重试等待间隔(秒) |
| intervals | int | 否 | 轮询间隔(秒) |
| overtime | int | 否 | 长任务整体超时(秒) |
| singleOvertime | int | 否 | 单次请求超时(秒)，最大300 |
| model | string | 否 | 模型名称 |
| open_reflection | bool | 否 | 监督反思开关，默认false |

outputs子字段：
- output_parser：结果展示方式
- show_title/type/data：见通用output_parser

中间数据子步骤：`"PARAM_EXTRACT"` / `"API_CALL"`

---

#### user-check（用户干预选择节点）

```yaml
user_check_node:
  type: "user-check"
  description: "请选择参数"
  inputs:
    tips: "请选择城市"
    action_type: choice
    options:
      - "北京"
      - "上海"
  outputs:
    user_check_result: ${user_check_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| tips | string | 是 | 用户交互提示文本 |
| action_type | string | 是 | 交互方式："choice"(选择)或"input"(输入) |
| options | list | 否 | 选项列表(action_type=choice时) |

outputs：`user_check_result` → `${user_check_result}`

---

#### param-extract（参数提取节点）

```yaml
param_node:
  type: "param-extract"
  description: "提取参数"
  inputs:
    prompt_template: "提取以下参数..."
  outputs:
    city: ${param_response}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| prompt_template | string | 是 | LLM输入模板（仅支持内置或直接内容） |

outputs：自定义key绑定 `${param_response}`

中间数据子步骤：`"PROCESS_DETAIL"`

---

#### python（Python脚本调用节点）

```yaml
python_node:
  type: "python"
  description: "执行脚本"
  inputs:
    script: "print('hello')"
    extra_param: ${input_question}
  outputs:
    python_result: ${python_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| script | string | 是 | Python脚本内容（用户确保安全） |
| *(其他key)* | any | 否 | 作为python脚本输入参数 |

outputs：`python_result` → `${python_result}`（单个print=string，多个print=list，默认String，用json.dumps传Object）

中间数据子步骤：`"PROCESS_DETAIL"`

---

#### parallel-gateway（并行网关）

至少一个next条件满足，多个满足时并行执行。

```yaml
parallel_node:
  type: "parallel-gateway"
  description: "并行执行"
  inputs:
    join_node: "end_node"        # 可选，显式 join 节点 ID；不指定时默认解析为各分支公共 end_node
    join_on_failure: "wait"      # 可选，wait（默认，等待所有分支，至少一个正常返回即成功）或 break（首个分支失败立即终止其余分支）
    join_timeout: "120"          # 可选，汇聚等待超时秒数，默认 600
  next:
    branch_a:
      condition: ""
    branch_b:
      condition: ""
```

inputs（可选）：

- `join_node`：显式 join 节点 ID，覆盖默认 end_node 解析。
- `join_on_failure`：分支异常时的汇聚策略。`wait`（默认）等待所有分支返回，至少一个分支正常返回即判定成功，全部分支失败才失败；`break` 任一分支异常则节点立即失败并终止其他分支。
- `join_timeout`：汇聚等待超时时长（秒），默认 600。

无 outputs。

---

#### exclusive-gateway（排他网关）

仅允许一个条件满足（与并行网关区别：并行允许多个并行执行）。

```yaml
exclusive_node:
  type: "exclusive-gateway"
  description: "排他选择"
  next:
    branch_a:
      condition: "${type == 'A'}"
    branch_b:
      condition: "${type == 'B'}"
```

无 inputs/outputs。

---

#### sub-recipe（子流程调用节点）

```yaml
sub_node:
  type: "sub-recipe"
  description: "调用子Recipe"
  inputs:
    recipe_name: "sub_recipe_name"
    inputMapping:
      alarm_id: ${alarm_id}
    outputMapping:
      diag_result: ${outputs.diag_result}
    is_node_record_with_recipe_result: false
  outputs:
    recipe_result: ${recipe_result}
    diag: ${diag_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| recipe_name | string | 是 | 子Recipe名称 |
| inputMapping | object | 是 | 父变量到子Recipe inputVariables的显式映射，值为 `${var}` 模板 |
| outputMapping | object | 否 | 子Recipe outputVariables到父节点binding scope的显式映射；省略时不回写额外输出 |
| is_node_record_with_recipe_result | bool | 否 | node_record_info是否更新recipe_result，默认false（MAE-CN场景自动true） |

outputs：自定义key绑定 `${recipe_result}`（子Recipe answer节点输出，map结构）、`${sub_recipe_result}`（执行摘要）、`${node_record_info}`（节点执行记录），以及通过 `outputMapping` 映射的子流程中间节点输出

---

#### display-content（文本显示节点）

无需处理时直接返回特定文本。25.1仅支持text类型。

```yaml
display_node:
  type: "display-content"
  description: "提示"
  inputs:
    tag: REJECT
  outputs:
    fmsg: "当前问题不在能力范围内"
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| tag | string | 否 | 标签，"REJECT"时chat更新为拒绝级别 |

outputs：自定义key直接写文本值

---

#### question-rewriting（问题改写节点）

```yaml
rewriting_node:
  type: "question-rewriting"
  version: "27.0.0"
  description: "问题改写
  inputs:
    context_round: "2"
    answer_splicing: false
    dialogue_state: false
    question_rewriting_prompt_name: ""
    dialogue_state_prompt_name: ""
    question_rewriting_prompt: ""
    dialogue_state_prompt: ""
    model: ""
    clarification_strategy: Complete
    domain: ""
    question_rewriting_single_prompt: ""
    question_rewriting_single_prompt_name: ""
  outputs:
    rewritten_input_question: ${rewritten_input_question}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| context_round | int | 否 | 上下文轮数，默认4，最大9 |
| answer_splicing | bool | 否 | 是否拼接答案，默认true |
| dialogue_state | bool | 否 | 是否对话状态识别，默认true |
| question_rewriting_prompt_name | string | 否 | 改写prompt名(pub注册)，优先级：prompt > prompt_name > 系统预设 |
| dialogue_state_prompt_name | string | 否 | 对话状态prompt名 |
| question_rewriting_prompt | string | 否 | 改写prompt内容 |
| dialogue_state_prompt | string | 否 | 对话状态prompt内容 |
| model | string | 否 | 模型名称 |
| clarification_strategy | string | 否 | 澄清策略，默认Complete(新流程) |
| domain | string | 否 | 域名(新流程) |
| question_rewriting_single_prompt | string | 否 | 单轮改写prompt(新流程) |
| question_rewriting_single_prompt_name | string | 否 | 单轮改写prompt名(新流程) |

outputs：`rewritten_input_question` → `${rewritten_input_question}`（不返回用户，仅作为下一节点输入）

中间数据子步骤：`"TOPIC_IDENTIFY"` / `"MULTI_ROUND_REWRITE"`

---

#### agent（多Agent协作节点）

```yaml
agent_node:
  type: agent
  description: "调用智能体"
  inputs:
    agent_name: ${agent_name}
    recipe_name: ${recipe_name}
    input_question: ${agent_input_question}
  outputs:
    child_chat_id: ${child_chat_id}
    agent_result: ${agent_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| agent_name | string | 是 | Agent名称，找不到系统报错 |
| recipe_name | string | 否 | Recipe名称，找不到报错；不提供时AgentCore搜索：boot-recipe→system-bootrecipe→recipe→knowledge QA |
| input_question | string | 否 | 输入问题，默认input_question |

outputs：`child_chat_id`(子chatId), `agent_result`(执行结果)

---

#### tool_choice（工具选择节点，集成API召回+选择+参数提取）

```yaml
choose_api:
  type: "tool_choice"
  description: "FunctionCall方式召回工具"
  inputs:
    rag_index:
      - domain: ""
        scene: ""
        index_name: "netkbcnccn250225hnsw"
        priority: "1"
    query: ${input_question}
    filter:
      kn_ne_version: ""
      kn_ne_type: ""
    rank_topN: "1"
    vs_topN: "10"
    es_topN: "10"
    open_reflection: false
  outputs:
    tool_choice_result: ${tool_choice_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| rag_index | List\<Object\> | 是 | 知识库索引配置(读取前2条)，子字段见下方 |
| query | string | 是 | 查询问题，支持模板拼接 |
| filter | Object | 否 | 过滤条件 |
| rank_topN | int | 否 | 重排知识条数，默认1，最大10 |
| vs_topN | int | 否 | 向量召回topN，默认10，范围[1,20] |
| es_topN | int | 否 | 文本召回topN，默认10，范围[1,20] |
| open_reflection | bool | 否 | 监督反思开关，默认false |

rag_index子字段：domain, scene, index_name(优先于domain+scene), priority(int,越高优先级越高,默认0)

outputs：`tool_choice_result` → LLM返回tool_calls结果，格式：`{"id":"call_xxx","type":"function","function":{"name":"api_name","arguments":"..."}}`

中间数据子步骤：`"RAG_RECALL"` / `"RATING"` / `"MACHINE_ANALYSIS"`

---

#### tool（工具调用节点）

```yaml
flow:
  type: "tool"
  description: "工具调用"
  inputs:
    tool_name: "code"
  outputs:
    result: ${tool_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| tool_name | string | 是 | 工具名：flow(目标分解)/code(目标生成)/flow_code(作文转代码)/execute_code(执行代码)/react(复杂任务规划react模式)/nl2gremlin(NL2Gremlin执行) |

outputs：`result` → `${tool_result}`

中间数据子步骤：`"PROCESS_DETAIL"`

---

#### intent-recognition（意图识别节点）

```yaml
intent_node:
  type: "intent-recognition"
  description: "意图识别"
  version: "27.0.0"
  inputs:
    prompt_template: "..."
    prompt_template_name: ""
    index_name: "111"
    open_multi_round: false
  outputs:
    intent_recognition_result: ${intent_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| prompt_template | string | 否 | LLM prompt，优先级：prompt_template > DB prompt > 系统预设 |
| prompt_template_name | string | 否 | prompt模板名 |
| index_name | string | 否 | 知识服务索引名(type=api时返回最多3个api_name) |
| open_multi_round | bool | 否 | 是否启用多轮意图，默认false |

outputs：
- `intent_result` → 意图识别结果
- `intent_type` → HandleClearIntent/HandleUnsupportedIntent/HandleFuzzyIntent/HandleMissingParameterIntent/ConsultKnowledge
- `intent_list` → 意图列表

未识别时返回 `["Other"]`。vsScore>99直接返回意图列表，否则调用LLM。

中间数据子步骤：`"RAG_RECALL"` / `"LLM_REASONING"`

---

#### guardrail_check（安全护栏校验节点）

```yaml
guardrail_node:
  type: guardrail_check
  description: "安全校验"
  inputs:
    guardrail_content: ${guardrail_content}
    guardrail_type: question
    guardrail_params: ""
    ingores:
      - topics
  outputs:
    guardrail_result: ${guardrail_result}
    guardrail_response: ${guardrail_response}
  next:
    recipe_execute:
      condition: "${guardrail_result == true}"
    exception_node:
      condition: "${guardrail_result == false}"
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| guardrail_content | string/list | 是 | 输入内容（原始Q/改写Q/上一节点输出），必须为list/string否则报错 |
| guardrail_type | string | 是 | 校验类型：question/answer/topic/privacy，映射到护栏服务原子API |
| guardrail_params | string | 否 | 可配置的API参数，AgentCore仅透传不做类型校验 |
| ingores | list | 否 | 忽略项 |

outputs：
- `guardrail_result` → true/false(是否被拦截)
- `guardrail_response` → 护栏返回信息(JSON结构)

---

#### data-analysis（机器数据分析节点）

```yaml
analysis_node:
  type: "data-analysis"
  description: "数据分析"
  inputs:
    tool_type: ipython
    prompt_template_name: "xyl_prompt_01"
    prompt_template: "20瓦是多少dBm？仅给出工具"
  outputs:
    summary_result: ${llm_completion}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| tool_type | string | 是 | 工具类型：ipython |
| prompt_template | string | 否 | prompt模板 |
| prompt_template_name | string | 否 | prompt模板名 |

outputs：自定义key绑定 `${llm_completion}`

中间数据子步骤：`"MACHINE_ANALYSIS"` / `"CODE_ACT"`

---

#### delay-gateway（延时/定时节点）

```yaml
delay_node:
  type: "delay-gateway"
  description: "延时"
  inputs:
    delay_time: "15"
  outputs:
    msg: "执行delay-gateway节点结束"
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| delay_time | string | 是 | 等待时间 |

---

#### interrupt-gateway（中断节点）

```yaml
interrupt_node:
  type: interrupt-gateway
  description: "中断"
  inputs:
    interrupt_condition: ""
  outputs:
    msg: "执行interrupt节点结束"
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| interrupt_condition | string | 是 | 中断条件，条件满足时中断停止执行，通过唤醒API调用恢复 |

---

#### translation（翻译节点）

```yaml
translation_node:
  type: translation
  description: "翻译"
  inputs:
    translation_type: large_model
    translation_input: ${input_question}
    translation_direction: inbound
    translation_prompt: ""
    translation_prompt_name: ""
    from: zh
    to: en
  outputs:
    infer_result: ${llm_completion}
    input_language: ${llm_completion.input_language}
    output_language: ${llm_completion.output_language}
    translation_result: ${llm_completion.text}
  next:
    display_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| translation_type | string | 是 | large_model/small_model |
| translation_input | string | 是 | 翻译输入 |
| translation_direction | string | 否 | inbound(小语种→英语，默认)/outbound(英语→小语种) |
| translation_prompt | string | 否 | 自定义翻译prompt |
| translation_prompt_name | string | 否 | 翻译prompt模板名 |
| from | string | 否 | 源语言(small_model时必填) |
| to | string | 否 | 目标语言(small_model时必填) |

outputs：
- 大模型入站(无自定义prompt)：input_language, output_language, translated_result
- 大模型出站(无自定义prompt)：translated_result
- infer_result → `${llm_completion}` (LLM原始输出，用于自定义处理)

---

### 5.2 RAG相关节点

#### knowledge-search（知识检索节点）

```yaml
rag_knowledge_recall:
  type: "knowledge-search"
  description: "知识搜索"
  inputs:
    rag_index:
      - domain: "DME"
        scene: "数据查询"
        index_name: "PETAL"
        index_type: "OUTER"
        priority: "0"
        vs_topN: "2"
        es_topN: "3"
    query: ${input_question}
    filters:
      key: [a, b]
    rank_topN: "1"
    vs_topN: "7"
    es_topN: "8"
    recall_condition:
      vs_score: ""
      es_score: ""
      rerank_score: ""
    enable_query_rewrite: "true"
  outputs:
    alarm_case: ${knowledge_search_result}
  next:
    llm_task:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| rag_index | List\<Object\> | 是 | 索引配置(读取前2条)，子字段见下方 |
| query | string | 是 | 查询问题，支持模板拼接 |
| extensions | List\<String\> | 否 | 精确文本匹配 |
| filters | Object | 否 | 过滤条件 |
| rank_topN | int | 否 | 重排条数，默认1，最大10 |
| vs_topN | int | 否 | 向量召回topN，默认10，范围[1,20]，各索引vs_topN优先 |
| es_topN | int | 否 | 文本召回topN，默认10，范围[1,20]，各索引es_topN优先 |
| recall_condition | Object | 否 | 分数过滤(25.1已废弃)：vs_score/es_score/rerank_score(AND逻辑)，支持>、<、=及范围如[0.2,0.9] |
| enable_query_rewrite | bool | 否 | 是否分解查询，默认false |

rag_index子字段：domain, scene, index_name(优先于domain+scene), index_type, priority(int,默认0), vs_topN[1,20], es_topN[1,20]

outputs：自定义key绑定 `${knowledge_search_result}` (List\<String\>)

中间数据子步骤：`"RAG_RECALL"` / `"RATING"`

---

#### api-choice（API选择节点）

```yaml
api_choice_01:
  type: "api-choice"
  description: "API选择"
  inputs:
    open_api_recall: "true"
    open_api_knowledge_recall: "true"
    rag_index:
      - domain: ""
        scene: ""
        index_name: "default"
        index_type: "KNOWLEDGE"
        priority: "1"
    query: ${input_question}
    rank_topN: "5"
    vs_topN: "10"
    es_topN: "10"
    recall_condition:
      vs_score: ""
      es_score: ""
      rerank_score: ""
    top1_choice_prompt: ""
    model_params:
      enable_thinking: true
    open_reflection: false
  outputs:
    api_name: ${api_name}
  next:
    task_restful:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| rag_index | List\<Object\> | 是 | 索引配置，子字段同knowledge-search |
| open_api_recall | bool | 否 | 启用Rag API召回，默认false；true=Rag N选topN→LLM topN选1；false=直接LLM N选1(需top1_choice_prompt) |
| open_api_knowledge_recall | bool | 否 | API召回返回知识，默认false(需open_api_recall=true)；两者同时开启时做2次召回(API索引+知识索引) |
| top1_choice_prompt | string | 条件 | LLM N选1 prompt，open_api_recall=false时必填 |
| model_params | Map | 否 | 模型扩展参数，透传 |
| query | string | 是 | 查询问题 |
| extensions | List\<String\> | 否 | 精确匹配 |
| rank_topN | int | 否 | 默认5，最大10 |
| vs_topN | int | 否 | 默认10，[1,20] |
| es_topN | int | 否 | 默认10，[1,20] |
| recall_condition | Object | 否 | 分数过滤 |
| open_reflection | bool | 否 | 监督反思开关 |

outputs：
- `api_name` → 选择的API名 `${api_name}`
- `recall_result` → API召回原始数据(List\<Object\>，预留)

中间数据子步骤：`"RAG_RECALL"` / `"RATING"` / `"LLM_REASONING"`

---

#### recipe-choice（Recipe选择节点）

```yaml
rag_recipe_recall_01:
  type: "recipe-choice"
  description: "Recipe选择"
  inputs:
    rag_index:
      - domain: ""
        scene: ""
        index_name: "yh_knowledge"
        priority: "0"
    query: ${input_question}
    filter:
      recipe_ne_version: ""
      recipe_ne_type: ""
    extensions: ${alarm_reason}
    rank_topN: "5"
    vs_topN: "10"
    es_topN: "10"
  outputs:
    recipe_name: ${recipe_name}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| rag_index | List\<Object\> | 是 | 索引配置，子字段同knowledge-search |
| query | string | 是 | 查询问题 |
| filter | Object | 否 | 过滤条件(recipe_ne_version, recipe_ne_type) |
| extensions | List\<String\> | 否 | 精确匹配 |
| rank_topN | int | 否 | 默认1，最大10 |
| vs_topN | int | 否 | 默认10，[1,20] |
| es_topN | int | 否 | 默认10，[1,20] |

outputs：
- `recipe_name` → Recipe名 `${recipe_name}`
- `recall_result` → Recipe召回原始数据(List\<Object\>，预留)

中间数据子步骤：`"RAG_RECALL"` / `"RATING"`

---

#### knowledge-qa（知识问答节点）

```yaml
rag_knowledge_qa:
  type: "knowledge-qa"
  description: "告警案例推荐"
  loop:
    loop_cardinality:
    loop_completion_condition:
    loop_input_data_item: ${alarm_reason}
    loop_element_variable: reason
  inputs:
    rag_index:
      - domain: "云核"
        scene: "通用"
        index_name: "yh_knowledge"
        index_type: outer
        priority: "3"
    query: "查询${alarmId}告警案例"
    rank_topN: "1"
    vs_topN: ""
    es_topN: ""
    recall_condition:
      vs_score: ""
      es_score: ""
      rerank_score: ""
    model_params:
      enable_thinking: true
  outputs:
    alarm_case_list: ${knowledge_search_result}
    knowledge_qa: ${knowledge_qa_result}
    output_parser:
      loop_element_variable: knowledge
      llm_summery_prompt: "请对案例做摘要，参考内容：\n ${knowledge}"
      loop_result:
        loop_result_type: Map
        loop_result_key: ${reason}
        loop_result_value: ${knowledge_qa_result}
  next:
    end_node:
      condition: ""
```

| inputs参数 | 类型 | 必填 | 说明 |
|-----------|------|------|------|
| rag_index | List\<Object\> | 是 | 索引配置，子字段同knowledge-search |
| query | string | 是 | 查询问题，支持模板拼接 |
| extensions | List\<String\> | 否 | 精确匹配 |
| rank_topN | int | 否 | 默认1，最大10 |
| vs_topN | int | 否 | 默认10，[1,20] |
| es_topN | int | 否 | 默认10，[1,20] |
| recall_condition | Object | 否 | 分数过滤 |
| model_params | Map | 否 | 模型扩展参数，透传 |

outputs：
- 自定义key → `${knowledge_search_result}` (知识检索结果List\<String\>)
- 自定义key → `${knowledge_qa_result}` (LLM摘要结果List\<String\>)
- output_parser：
  - loop_element_variable：遍历知识列表临时变量名(默认"knowledge")
  - llm_summery_prompt：LLM摘要prompt(含${knowledge}占位符，不配置则用预设prompt)
  - loop_result：loop_result_type(Map/List)，Map时需loop_result_key+loop_result_value

中间数据子步骤：`"RAG_RECALL"` / `"RATING"` / `"LLM_REASONING"`

---

## 六、关键字/保留字完整列表

**重要：** 产品集成编排Recipe时，字段名不得与以下关键字同名。

### 全局关键字

| 名称 | 说明 |
|------|------|
| ai_agent_kw_task_id | 系统内置任务ID变量名 |
| conversationId | 系统内置会话ID变量名 |
| chatId | 系统内置聊天ID变量名 |
| input_question | 用户问题 |
| rewritten_input_question | 改写后用户问题(多轮融合) |
| chat_recipe_context | 同会话前序轮次recipe信息(含步骤信息) |
| local_language_key | 当前语言环境 |
| local_date_time | 当前时间，格式yyyy-MM-dd HH:mm:ss |
| global_vars | 全局参数，存储各步骤参数 |
| options | 聊天界面输入options |
| api_response | Restful节点API返回体 |
| extracted_api_params | API参数提取结果 |
| schema_version | 版本控制 |
| output_result | LLM问答输出 |
| prompt_template | prompt模板 |

### 节点局部关键字

| 名称 | 适用节点 | 说明 |
|------|---------|------|
| inputs | 所有 | 节点输入定义 |
| outputs | 所有 | 节点输出定义 |
| next | 所有 | 下一节点定义 |
| current_node | 所有 | 当前节点定义 |
| show_title | 所有(outputs下) | 是否显示节点标题 |
| show_content | 所有(outputs下) | 是否显示节点内容 |
| show_aigc | 所有(outputs下) | 是否显示AIGC，默认false |
| output_parser | 所有 | PIU及显示控制定义，支持message_level |
| type | 所有(PIU) | PIU数据类型 |
| data | 所有(PIU) | PIU数据内容 |
| erReqHeaders | 所有 | 请求头 |
| fm_extract_parameter | restful | 是否用LLM提取参数 |
| api_group | restful | API分组 |
| api_name | restful | API名称 |
| is_long_api | restful | 是否长任务 |
| stream_type | restful | SSE流式模式开关，值为"sse"时启用，与批处理/长轮询互斥 |
| retry_times | restful | 长任务重试次数 |
| retry_wait_time | restful | 重试等待时间 |
| intervals | restful | 长任务轮询间隔 |
| overtime | restful | 长任务轮询超时 |
| request_header | restful | API请求头 |
| recipe_name | sub-recipe | 子Recipe名称 |
| recipe_result | sub-recipe | 子Recipe执行结果(map结构) |
| prompt_template | llm-router | LLM输入模板 |
| llm_completion | llm-router | LLM输出 |
| groovy_result | groovy | Groovy执行结果 |
| script | groovy/python | 执行脚本 |
| param_name | param-extract | 参数名 |
| param_response | param-extract | 参数提取响应体 |
| loop | knowledge-qa等 | 循环节点标识 |
| loop_cardinality | loop | 循环次数 |
| loop_completion_condition | loop | 循环结束条件 |
| loop_input_data_item | loop | 循环输入数据列表 |
| loop_element_variable | loop | 循环元素key |
| knowledge_search_result | RAG节点 | 知识召回结果key(List) |
| recall_result | RAG节点 | 召回原始结果key(List，预留) |
| rag_index | RAG节点 | RAG索引配置key |
| index_name | RAG节点 | RAG索引名称key |
| priority | RAG节点 | 索引优先级key |
| domain | RAG节点 | 索引域key |
| scene | RAG节点 | 索引场景key |
| query | RAG节点 | 知识库Q文本参数key |
| rank_topN | RAG节点 | 重排条数参数key |
| vs_topN | RAG节点 | 向量召回topN参数key |
| es_topN | RAG节点 | 文本召回topN参数key |
| recall_condition | RAG节点 | 召回条件key |
| es_score | RAG节点 | 文本召回分数配置key |
| vs_score | RAG节点 | 向量召回分数配置key |
| rerank_score | RAG节点 | 重排分数配置key |
| top1_choice_prompt | api-choice | N选1 Prompt key |
| open_api_recall | api-choice | 启用API召回 |
| extensions | recipe-choice | 精确匹配key |
| llm_summery_prompt | knowledge-qa | LLM摘要prompt |
| loop_result | loop | 循环节点结果 |
| loop_result_type | loop | Map/List |
| loop_result_key | loop | 循环结果key |
| loop_result_value | loop | 循环结果value |
| knowledge_qa_result | knowledge-qa | 知识QA输出 |
| knowledge | knowledge-qa | 遍历知识临时变量key |
| intent_result | intent-recognition | 意图识别结果 |
| open_multi_round | intent-recognition | 是否启用多轮意图，默认false |
| guardrail_content | guardrail_check | 护栏校验输入内容 |
| guardrail_type | guardrail_check | 校验类型(question/answer/topic/privacy) |
| guardrail_params | guardrail_check | 可配置API参数 |
| guardrail_result | guardrail_check | 校验结果(true/false) |
| guardrail_response | guardrail_check | 护栏返回信息 |
| user_check_result | user-check | 用户反馈结果 |
| tool_choice_result | tool_choice | 工具选择结果 |
| tool_name | tool | 工具名称 |
| tool_result | tool | 工具调用结果 |

---

## 七、推荐问题配置

### 7.1 Recipe节点recommends字段

与inputs同层级，配置当前聊天推荐问题。缓存10分钟。

```yaml
display_content:
  type: "display-content"
  inputs:
  outputs:
    msg: "执行recipe"
  recommends:
    - "推荐问题1"
    - "推荐问题2"
  next: ...
```

### 7.2 意图识别节点推荐问题

执行流中存在intent-recognition节点且推荐问题开关为true时，基于pub注册场景和意图识别结果获取推荐问题，异步执行，同样缓存10分钟。

### 7.3 Display节点Reject标签

display-content节点inputs配置`tag: REJECT`时，chat更新为拒绝级别。

### 7.4 推荐问题优先级

1. **conversationId存在时**：从会话列表获取缓存推荐问题，无论是否为空直接返回
2. **仅chatId存在时**：
   - 优先级1：Recipe节点缓存推荐问题，取最后N条
   - 优先级2：不足topN时取意图识别节点推荐问题（缓存key存在但无结果则等3秒重试1次）
   - 优先级3：仍不足topN时用纯LLM推荐→护栏过滤→LLM翻译
   - 任一步骤填满topN即提前返回

---

## 八、节点中间数据记录

| 节点类型 | 中间数据内容 | 子步骤名枚举 |
|---------|------------|------------|
| api-choice | RAG召回输入/输出/耗时, 重排结果, LLM推理结果 | RAG_RECALL, RATING, LLM_REASONING |
| restful | 参数提取输入/输出/耗时(有提取过程时), API调用参数/输出/耗时 | PARAM_EXTRACT, API_CALL |
| recipe-choice | 双路召回结果, 重排结果 | RAG_RECALL, RATING |
| knowledge-search | 双路召回结果, 重排结果 | RAG_RECALL, RATING |
| knowledge-qa | 双路召回结果, 重排结果, LLM推理结果 | RAG_RECALL, RATING, LLM_REASONING |
| question-rewriting | 主题识别输入/输出/耗时, 多轮融合输入/输出/耗时 | TOPIC_IDENTIFY, MULTI_ROUND_REWRITE |
| llm-router | 拼装完参数的prompt | PROCESS_DETAIL |
| python | 入参对象 | PROCESS_DETAIL |
| tool | 入参对象 | PROCESS_DETAIL |
| param-extract | 拼装完参数的prompt | PROCESS_DETAIL |
| data-analysis | 机器分析prompt, Python代码及入参 | MACHINE_ANALYSIS, CODE_ACT |
| tool_choice | 召回结果, 重排结果, 机器分析结果 | RAG_RECALL, RATING, MACHINE_ANALYSIS |
| intent-recognition | 召回结果, 模型推理结果 | RAG_RECALL, LLM_REASONING |

中间数据结构示例：
```yaml
query: "RAG_RECALL"
message: {"query":"问题内容","rankTopN":10,"ragIndexes":[...]}
content: "召回内容"
```

---

## 九、完整样例

```yaml
name: demo_recipe
description: demo desc
domain: NAIE
scene: demo
type: boot-recipe
version: 1.1.0
expandFields:
  recipe_ne_version: 1.0
  recipe_ne_type: xxx
nodes:
  start_node:
    type: "start-event"
    description: "开始处理您的问题"
    next:
      ext_api:
        condition: ""
  ext_api:
    type: restful
    description: 查询天气接口
    inputs:
      api_name: weather_query
    outputs:
      elementVariables: ${api_response}
    next:
      last_llm:
        condition: ${elementVariables[0] == "晴"}
      end_node:
        condition: ${elementVariables[0] != "晴"}
  last_llm:
    type: llm-router
    description: 总结天气，给出建议
    inputs:
      llm_type: NetGPT
      prompt_template: "请根据天气状态：${elementVariables}，和用户的问题：${input_question}，给出出行建议。"
    outputs:
      result: ${llm_completion}
    next:
      end_node:
        condition: ""
  end_node:
    type: "end-event"
    description: "this is a end node."
```
