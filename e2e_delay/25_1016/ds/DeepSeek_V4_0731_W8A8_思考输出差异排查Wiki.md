# DeepSeek V4 0731 W8A8：0.18 与 0.30 思考输出差异排查 Wiki

整理日期：2026-10-20

状态：日志与本地代码已核对；根因尚未通过同一输入的服务端对照实验最终确认。

## 1. 问题与当前结论

现象：10 月 16 日的模型请求已经包含顶层 `enable_thinking: false` 和 `thinking: {"depth":"OFF"}`，响应仍返回非空 `reasoning`。但 8 月 12 日的旧日志连这些关闭参数都没有，也没有 `chat_template_kwargs`，成功响应却没有非空推理文本。

当前最符合证据的解释是：**升级后 DeepSeek V4 模板的默认思考行为发生变化，而 AICOService 网关没有把关闭开关传入 `chat_template_kwargs`，使新服务仍可能采用默认开启行为。**

这个解释由两类证据支持：

- 本地网关实现只输出顶层关闭参数，未构造 `chat_template_kwargs`；新日志确实呈现这个请求结构。
- 上游 vLLM 确实存在“未指定模板思考开关时，由默认关闭改为默认开启”的变更，v0.30.0 已包含该逻辑。

**尚未确认的部分**：未直接读取用户旧 0.18 镜像内的实际 tokenizer/补丁代码，也未完成同一请求在两个服务或同一服务不同参数下的受控实验。因此不能把上述解释表述为已经完成线上验证的唯一根因。

## 2. 环境信息与证据边界

| 项目 | 旧环境 | 新环境 | 信息来源 |
|---|---|---|---|
| 权重 | DeepSeek V4 0731 W8A8 | DeepSeek V4 0731 W8A8 | 用户确认 |
| vLLM Ascend | 0.18 | 0.30 | 用户确认 |
| 服务启动参数 | 用户说明两次相同，包含工具调用解析配置 | 同左 | 尚未取得两次完整启动命令 |
| 成功请求的模型名称 | `DeepSeek-V4-Flash-W8A8` | `dsv4` | 日志 |
| 响应中的服务指纹 | 未提供可对应的版本指纹 | `vllm-0.30.0-tp8-ep-87e3dc35` | 新日志流式响应 |

模型名称可以是服务别名，名称不同本身不能证明权重不同。服务启动参数相同，也不保证不同版本下未显式指定的默认行为相同。

本地代码来自工作区源码及复制的 AICOService 运行包，未与当时运行中的 Pod 做 checksum 核对。代码与日志结构一致，是定位证据，但不能代替部署一致性验证。

## 3. 日志来源与统计口径

| 文件 | 记录数 | 用途 |
|---|---:|---|
| [旧日志 dsv4_2_aico.jsonl](../../../aico_timedelay_test_report/1_deepseek_old/dsv4_2_aico.jsonl) | 212 | 8 月 12 日请求与原始响应 |
| [新原始日志 vllm_requests_20261016_100327.jsonl](../ds的回放数据/vllm_requests_20261016_100327.jsonl) | 142 | 10 月 16 日请求、原始 SSE/JSON 响应 |
| [新合并日志 vllm_requests_20261016_100327_merged.jsonl](../ds的回放数据/vllm_requests_20261016_100327_merged.jsonl) | 142 | 聚合后的响应展示 |

统计以原始日志为准：

1. 按 JSONL 的物理行解析请求记录，区分 HTTP 成功与失败。
2. 对 SSE 逐个解析 `data:` 事件，跳过 `[DONE]`；对 JSON 响应直接读取 `choices[].message`。
3. 同时检查 `reasoning` 和 `reasoning_content`，避免因版本字段名变化而漏计。
4. “非空推理”指至少一个相关字段有非空文本；`null`、空字符串、字段缺失均不计为非空。
5. 检查正文中的 `<think>`、`</think>`，辅助排查推理文本是否混入正文；没有标签不能单独证明服务端未进行思考生成。

### 3.1 旧日志

- 共 212 条，194 条 HTTP 200，18 条 HTTP 404。
- 18 条失败请求使用 `model: "dsv4"`，返回 ``The model `dsv4` does not exist.``，不纳入成功输出比较。
- 194 条成功请求均使用 `DeepSeek-V4-Flash-W8A8`，均为流式请求。
- 194 条均没有非空 `reasoning` 或 `reasoning_content`。
- 原始 SSE 中 `reasoning_content` 共出现 5,701 次，值全部为 `null`。
- 194 条成功响应正文均未发现 `<think>`、`</think>` 标签。

首条成功记录位于旧文件第 19 行，`proxy_request_id` 为 `ec238787-083b-46f5-be84-487713b5e8d1`。

**结论范围**：可以确认旧日志没有返回非空推理文本；仅凭响应不能证明服务端完全没有生成或过滤过推理内容。

### 3.2 新日志

142 条请求全部 HTTP 200，可按请求结构分为三组：

| 分组 | 请求数 | 关键参数 | 返回非空推理的请求数 |
|---|---:|---|---:|
| 流式 Agent 请求 | 86 | `max_tokens=2048`，顶层关闭，无模板参数 | 66 |
| 非流式追问预测请求 | 28 | `max_tokens=1024`，顶层关闭，无模板参数 | 28 |
| 带模板关闭参数的规划请求 | 28 | `max_tokens=10000`，含 `chat_template_kwargs.enable_thinking=false` | 0 |
| 合计 | 142 | — | 94 |

前两组合计：114 条没有模板参数的请求中，94 条返回非空推理，20 条没有。

第三组的 `stream` 字段未传；响应为非流式 JSON。该组还包含 `temperature=0.1`、`top_p=0.7`、`timeout="120"`、`verify_ssl="false"`。

**限制**：这三组的任务、提示词和其他参数并不相同。“带模板关闭参数的 28 条都没有推理”支持模板开关有效的方向，但不是严格的单变量实验。

### 3.3 截图对应请求：排除日志合并新增推理

新日志第 1 条：

- `proxy_request_id`：`24412f25-1c93-498f-8318-ebea901a2797`
- 用户问题：查询 `SZ2-26B_BTS5900-12727880` 基站的电子下倾角。
- 原始 SSE 有 180 个可解析 JSON 事件，其中 166 个包含 `reasoning` 字段。
- 拼接后的推理文本长度为 2,192 个字符，与合并日志中对应的 `message.reasoning` 完全相同。

因此，截图中的非空 `reasoning` 已经存在于上游原始响应，合并文件只是将其聚合。

## 4. 旧、新普通 Agent 请求的差异

本节只比较旧日志 194 条成功请求与新日志 86 条流式 Agent 请求。

| 参数 | 旧日志 | 新日志 |
|---|---|---|
| `model` | `DeepSeek-V4-Flash-W8A8` | `dsv4` |
| `max_tokens` | 2048 | 2048 |
| `temperature` | 0.2 | 0.2 |
| `top_p` | 1 | 1 |
| `stream` | `true` | `true` |
| `tool_choice` | `"auto"` | `"auto"` |
| `stream_options` | `{"include_usage":true}` | 未传 |
| `thinking` | 未传 | `{"depth":"OFF"}` |
| `enable_thinking` | 未传 | `false` |
| `enable_reasoning_parser` | 未传 | `true` |
| `chat_template_kwargs` | 未传 | 未传 |

其他输入差异：

- 旧请求系统提示词为 14,934 字符；新 Agent 请求为 37,909 字符，加入了更复杂的路由和分类约束。
- 工具定义由 16 个变为 19 个。
- 提取出的首轮用户问题中，旧日志有 60 个不同问题，新日志有 30 个；两组没有完全相同的文本。

因此两份日志不能单独证明是哪一个请求参数导致了差异。尤其不能说“旧请求带了正确的模板开关，所以没有推理”——旧请求并没有带。

## 5. AICOService 与 NextAgent 的配置位置

### 5.1 AICOService：`model-gateway` 路径没有注入模板参数

运行包 default-system.yaml:47（本地运行包路径：`/Users/zhangfan/project/aico_timedelay_report/aico_struct_code/aicoservice@27.68.169/config/default-system.yaml:47`） 配置 `providerId: "model-gateway"`。

请求组装位于 gateway-provider.js:117（本地运行包路径：`/Users/zhangfan/project/aico_timedelay_report/aico_struct_code/aicoservice@27.68.169/node_modules/@nextagent/agent-platform-gateway-remote/dist/model/gateway-provider.js:117`） 的 `GatewayModelInvocationService.buildRequestBody()`：

```js
const enableThinking = request.thinking?.depth !== 'OFF';
const enableReasoningParser =
  process.env.ENABLE_REASONING_PARSER !== 'false';
```

返回体包含：

```js
...(request.thinking !== undefined ? { thinking: request.thinking } : {}),
enable_thinking: enableThinking,
enable_reasoning_parser: enableReasoningParser,
```

该函数没有构造 `chat_template_kwargs`。`complete()` 与 `stream()` 均使用它。

这里还明确了两个默认值：

- `thinking.depth` 不是 `OFF`（包括缺失）时，顶层 `enable_thinking` 为 `true`。
- 环境变量 `ENABLE_REASONING_PARSER` 不是字符串 `"false"` 时，顶层 `enable_reasoning_parser` 为 `true`。

这些是应用网关生成的请求字段，不能直接等同于 vLLM 启动参数。仍需核对下游网关是否转换这些字段。

### 5.2 AICOService：WATT_PLEX 的 RESTful 调用显式传参

| 调用阶段 | 生成参数 | 传入 RESTful 节点 |
|---|---|---|
| 协商规划 `call_nego_plan_llm` | WATT_PLEX.yaml:1586（本地运行包路径：`/Users/zhangfan/project/aico_timedelay_report/aico_struct_code/aicoservice@27.68.169/agents/aico-agent-m/zh_CN/recipes/WATT_PLEX.yaml:1586`） | WATT_PLEX.yaml:1608（本地运行包路径：`/Users/zhangfan/project/aico_timedelay_report/aico_struct_code/aicoservice@27.68.169/agents/aico-agent-m/zh_CN/recipes/WATT_PLEX.yaml:1608`） |
| 执行 `call_exec_llm` | WATT_PLEX.yaml:2108（本地运行包路径：`/Users/zhangfan/project/aico_timedelay_report/aico_struct_code/aicoservice@27.68.169/agents/aico-agent-m/zh_CN/recipes/WATT_PLEX.yaml:2108`） | WATT_PLEX.yaml:2134（本地运行包路径：`/Users/zhangfan/project/aico_timedelay_report/aico_struct_code/aicoservice@27.68.169/agents/aico-agent-m/zh_CN/recipes/WATT_PLEX.yaml:2134`） |

脚本显式生成：

```python
"chat_template_kwargs": {"enable_thinking": False},
"enable_thinking": False,
```

RESTful 节点再引用脚本输出：

```yaml
chat_template_kwargs: ${classify_result.chat_template_kwargs}
enable_thinking: ${classify_result.enable_thinking}
```

这只影响对应 recipe 节点，不会自动覆盖 Agent 的其他模型调用。本地 recipe 中的模型名称和其他参数也不一定与当时日志完全一致，不能仅凭结构相似认定每条请求的实际运行来源。

### 5.3 NextAgent：`openai-compatible` 路径会自动注入

[openai-compatible-provider.ts:153](../../../nextagent/NextAgent/packages/agent-model/src/providers/openai-compatible/openai-compatible-provider.ts#L153) 读取 `request.thinking?.depth`，并在 `transformRequestBody` 中执行：

```ts
...(thinkingDepth === 'OFF'
  ? { chat_template_kwargs: { enable_thinking: false } }
  : {}),
```

workflow 节点的配置入口可以是：

```yaml
inputs:
  model_params:
    enable_thinking: false
```

[shared.ts:671](../../../nextagent/NextAgent/packages/agent-workflow/src/nodes/shared.ts#L671) 将布尔值 `false` 转成 `thinking: { depth: 'OFF' }`。最终是否注入模板参数，仍取决于实际选中的 provider。

**不能把 `openai-compatible` 的行为套用到 `model-gateway`。** AICOService 使用的网关代码未包含上述注入逻辑，这正是两个路径的关键差别。

## 6. 版本变化的公开证据

### 6.1 已确认：上游改变过默认思考模式

[vLLM PR #50580](https://github.com/vllm-project/vllm/pull/50580) 于 2026-08-04 合并，说明此前默认进入 chat 模式，修改后在未指定 thinking 和 effort 时默认开启思考并采用 high effort。

可核对的 [v0.20.1 tokenizer 源码](https://github.com/vllm-project/vllm/blob/v0.20.1/vllm/tokenizers/deepseek_v4.py#L29-L32) 中，`thinking` 和 `enable_thinking` 默认均为 `False`，两者取逻辑或后决定模式。

[v0.30.0 tokenizer 源码](https://github.com/vllm-project/vllm/blob/v0.30.0/vllm/tokenizers/deepseek_v4.py#L27-L32) 则在两个开关均未提供时显式设置 `thinking_enabled = True`。

这里读取的是传入模板的 kwargs，不能将 HTTP 顶层同名字段自动视为已经传入模板。

### 6.2 未确认：旧 0.18 镜像的精确实现

v0.20.1 源码用于证明早期上游实现，不是用户旧 0.18 镜像源码的替代品。[Ascend 0.18 的 DeepSeek V4 部署文档](https://docs.vllm.ai/projects/ascend/en/v0.18.0/tutorials/models/DeepSeek-V4-Flash.html) 使用专门的 `deepseekv4` / `deepseekv4-a3` 镜像，因此应以实际镜像中的代码与补丁为准。

旧日志没有返回推理文本，与早期默认关闭行为一致；但尚未直接确认旧镜像采用哪次提交，不能仅凭 `0.18` 版本号断言其全部内部实现。

## 7. 当前假设及可信边界

| 假设或判断 | 当前状态 | 依据 / 限制 |
|---|---|---|
| 合并脚本凭空生成了截图中的推理 | 已排除该截图样本 | 原始 SSE 拼接与合并值完全相同 |
| 旧日志只是字段名称不同，实际上有推理 | 已排除非空字段漏计 | 同时核查两种字段，旧值全空 |
| 新服务采用默认开启，而顶层关闭参数未进入模板 | 最符合现有证据的根因假设 | 新版源码、网关代码与日志一致；缺同输入实测和旧镜像代码 |
| `enable_reasoning_parser: true` 直接导致模型开始思考 | 尚无证据 | 它确实是新增字段，但识别、转换及具体作用尚未实测 |
| 仅因启动参数变化导致现象 | 无当前支持 | 用户确认启动参数相同；完整命令尚未独立核对 |
| 提示词、工具与问题变化影响输出 | 存在混杂因素 | 两批输入不同，不能量化其贡献 |

需要修正的早期表述：不能仅以“缺少 `chat_template_kwargs`”解释全部差异，因为旧日志也缺少它。更完整的解释需要同时包含**服务版本默认值变化**和**关闭参数未映射到模板**。

## 8. 建议处理方式（尚未执行）

### 8.1 服务端设置默认关闭

如果希望先不修改 AICOService，可在现有启动命令中新增或合并以下配置：

```bash
--default-chat-template-kwargs '{"thinking": false, "enable_thinking": false}'
```

保留现有工具调用和推理解析参数。相关片段可为：

```bash
--tokenizer-mode deepseek_v4 \
--enable-auto-tool-choice \
--tool-call-parser deepseek_v4 \
--reasoning-parser deepseek_v4 \
--default-chat-template-kwargs '{"thinking": false, "enable_thinking": false}'
```

这是默认配置，不是禁止客户端开启思考的强制策略。请求中的模板参数可覆盖默认值；如启动命令已有其他默认模板设置，应合并而非直接丢弃。机制见 [vLLM 0.30 服务端默认模板参数文档](https://docs.vllm.ai/en/v0.30.0/features/reasoning_outputs/#server-level-default-chat-template-kwargs)。

### 8.2 请求级显式关闭

在实际发往模型服务的 JSON 中，与 `model`、`messages` 同级加入：

```json
{
  "chat_template_kwargs": {
    "thinking": false,
    "enable_thinking": false
  }
}
```

0.30 的 DeepSeek V4 模板中两个开关按逻辑或判断，显式将两者设为 `false` 可以避免另一个默认开关仍为 `true`。

对于 AICOService 的普通模型调用，修复落点是 `GatewayModelInvocationService.buildRequestBody()` 对 `thinking.depth === 'OFF'` 的映射。应修改其源代码并重新构建部署；本 Wiki 只记录定位，不直接修改运行包。

### 8.3 不建议仅删除 `--reasoning-parser`

必须区分：

- `--tool-call-parser`：工具调用解析。
- `--reasoning-parser`：推理内容解析。
- 模板中的 `thinking` / `enable_thinking`：控制思考模式。

移除推理解析器不能保证关闭思考生成，推理文本可能进入正文或由其他输出路径处理，也不能据此保证降低 token 消耗与时延。应以模板关闭开关控制生成模式。解析器与模板配置的区别见 [vLLM 0.30 Reasoning Outputs](https://docs.vllm.ai/en/v0.30.0/features/reasoning_outputs/)。

## 9. 验证方案与验收条件

目前尚未重启服务、修改生产配置、重放请求或执行下面的实验。

### 9.1 固定输入进行单变量对照

使用截图对应的同一条请求，固定 `messages`、`tools`、模型、采样参数和输出上限；每组保存实际进入服务端的请求体与原始响应。

| 组别 | 请求变化 | 验证目的 |
|---|---|---|
| A | 删除顶层 `thinking`、`enable_thinking`、`enable_reasoning_parser`，不传模板参数 | 在当前服务上模拟旧日志的开关缺省结构 |
| B | 保留新日志中的三个顶层字段，不传模板参数 | 复现当前现象 |
| C | 在 B 基础上只删除 `enable_reasoning_parser` | 判断该请求字段是否改变行为 |
| D | 在 B 基础上加入两个模板开关均为 `false` | 验证显式关闭是否生效 |
| E | 服务端增加默认关闭配置，使用 B 请求 | 验证仅修改启动配置能否覆盖当前应用请求 |

如旧服务仍可用，再用相同输入比较旧、新服务；服务别名只做必要映射。重复少量样本，避免把单次模型输出差异当作因果证据。

### 9.2 检查内容

- 核查最终请求体，确认中间网关没有丢弃或覆盖 `chat_template_kwargs`。
- 同时核查 `reasoning`、`reasoning_content` 以及 `content` 中是否有推理文本，不能只检查字段是否消失。
- 如部署支持，检查渲染后的 prompt 或 tokenizer 输出，直接确认进入 chat 还是 thinking 模式。
- 验证普通回答和 `tool_calls` 均正常，包含多轮工具调用后的回答。
- 记录实际可用的 completion token、reasoning token 和耗时指标。缺失指标不得当作零，也不预先承诺性能收益。

完成上述验证后，再把“当前根因假设”更新为“已验证根因”，并记录镜像 tag/digest、启动命令、请求 ID 和结果。

## 10. 本次核对的文件指纹

用于识别统计对应的文件版本，不代表运行环境或镜像校验：

```text
dsv4_2_aico.jsonl
SHA256 6b2a436cf2e4741cdb60cf3e4209e8815860e62fffadcccfa7745ae2a42cc877

vllm_requests_20261016_100327.jsonl
SHA256 6c0351bc7519b0f5be45250a75783af11b6ea2fbcd79985138a1ed69f5af1270

vllm_requests_20261016_100327_merged.jsonl
SHA256 094877083a68780c2578a53396f3f08d9de39739d6183db8e2acb6182590f222
```
