## Why

平台集成方接入部分 OpenAI-compatible 思考模型时，模型会从响应首字符直接输出推理文本，并只使用 `</think>` 标记推理结束。当前系统只识别原生 reasoning 字段或成对 `<think>...</think>` 文本，因此这类模型的推理会被投影为公开正文，Web 端缺少 thinking 过程并可能展示本应归入推理区域的内容。

该响应形态无法仅凭首个文本增量与普通非思考回答可靠区分。系统需要允许平台集成方在可信模型配置中显式声明该模型采用隐式 reasoning 起点，并在不改变其他模型默认行为的前提下完成一致归一化。

## 目标与非目标

**目标：**

- 平台集成方可以按模型显式启用隐式 reasoning 起点模式。
- 启用后，流式和非流式调用把首字符至 `</think>` 之前的文本归一化为 reasoning，把标签之后的文本归一化为公开 content。
- 未启用的模型继续使用原生 reasoning 字段或显式 `<think>...</think>` 行为，普通正文不被误判。
- 非法配置在模型目录发布前安全失败。

**非目标：**

- 不根据模型名称、文本内容或响应前缀自动推断模式。
- 不改变 Web stream、timeline、Agent Core 或模型调用公共结果的 provider-neutral shape。
- 不增加新的 provider 类型、reasoning 请求控制或模型输出回滚语义。
- 不修改 Model Gateway 的输出归一化行为。

## What Changes

- 扩展可信模型 profile 配置，允许 OpenAI-compatible 子 profile 选择隐式 reasoning 起点文本模式。
- 配置启用时，流式与非流式 OpenAI-compatible 响应使用同一 reasoning/content 分界语义。
- 保持未配置时的既有默认行为，并拒绝不支持该模式的 provider profile 配置。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.1 调用模型` → `specs/model-invocation-contract/spec.md`
  - 功能边界：可信模型配置可声明隐式 reasoning 起点；模型调用把该模型的 text-level reasoning 归一化为既有 provider-neutral reasoning/content 结果。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：canonical spec；本 change 串行依赖已完成的 `raise-default-model-timeout-300s`，并保留其默认超时目标态。

## 影响范围（Impact）

- 启用该模式的 OpenAI-compatible 模型会在 Web thinking 区域显示推理，并只把 `</think>` 之后的正文作为公开回答。
- 未配置模型、原生 reasoning 字段和显式 think 标签模型保持现有行为。
- 模型 profile 配置、配置校验、模型调用 contract tests 和 OpenAI-compatible adapter tests 需要覆盖新增模式。
- 开发者部署文档需要给出按模型启用示例，并明确字段缺失时保持默认显式模式且不会报错。
