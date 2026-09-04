# FN-1.20 查看推荐问题

> 能力域 D1 会话与流式交互 · 子域 [D1.4 智能输入辅助](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.9](../../../features/D1-会话与流式交互/D1.4-智能输入辅助/F-1.9-智能问题推荐.md) |
| 主规格 | `question-recommendation` |
| 接口 | `POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions` |

## 描述

请求完成后，系统推荐下一步相关问题，帮助用户继续深入分析。

## 前置条件

- 用户已登录。
- 目标请求已完成。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话 ID |
| requestId | 是 | 已完成的请求 ID |

## 输出

```json
{
  "questions": [
    "切换失败的原因有哪些",
    "如何优化邻区配置",
    "切换成功率受哪些因素影响"
  ]
}
```

## 处理过程

1. 校验请求是否已完成。
2. 系统使用与主请求一致的受治理模型选择和提示词规则生成推荐问题。
3. 推荐处理保留与已完成请求的因果关联，但不重新打开或改变已完成请求。
4. 基于已完成请求的安全投影生成并返回推荐问题列表。
5. 推荐结果清洗在解析前依次移除完整思考块、未闭合开启标签及其后内容、最后一个大小写不敏感的孤立闭合标签及其之前全部内容，再执行 Markdown 围栏和叙述性文本清洗；孤立闭合标签之前无法与最终答案可靠区分的内容默认丢弃。
6. 推荐生成在组装 prompt 时，通过 `CapabilityDescriptionProvider` 从 agent-owned resource 文件 `agents/{agentId}/resource/capabilityDescription.md` 读取产品能力范围；文件存在时将内容作为 `{capability_description}` 填入 user message 的产品能力范围段，并在 system message 中增加产品能力范围选择规则；文件不存在或 Provider 未注入时省略该段，行为不变。

## 结果

- 正常：返回推荐问题列表。
- 请求未完成：返回空列表。
- 模型输出包含缺失开启标签的孤立闭合标签：只返回最后一个孤立闭合标签之后的有效问题；之后无有效问题时返回空列表。
- 当 `capabilityDescription.md` 存在时，推荐 prompt 包含产品能力范围上下文，推荐问题与 Agent 产品能力对齐；文件不存在时推荐结果与未提供该变量时完全一致。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 单次返回上限 | 最多 3 条；有效结果不足 3 条时返回实际数量 | `question-recommendation`：`Recommendation Output Parsing` |
| 生成前置状态 | 仅 `COMPLETED` 且 terminal commit 已完成的请求生成；`FAILED`、`CANCELED`、`SUPERSEDED` 返回空列表 | `question-recommendation`：`Terminal Status Guard` |
| 异常思考标签清洗 | 缺失开启标签的孤立闭合标签：以最后一个大小写不敏感的孤立闭合标签为边界，丢弃该标签及之前全部内容；之后无有效问题时返回空列表 | `question-recommendation`：`Recommendation Output Cleaning` |
| 产品能力范围数据源 | `agents/{agentId}/resource/capabilityDescription.md` agent-owned resource 文件；Provider 返回原文，不解析或转换 | `question-recommendation`：`Capability Description Provider` |
| 推荐问题功能开关 | effective `suggested-questions-enabled=false` 时跳过预计算、不发起 model invocation，REST 返回 200 + `{ questions: [] }`；`true` 时既有行为不变 | `question-recommendation`：`Suggested questions generation can be disabled` |
| Prompt 结构 | 职责分离的 system message（推荐任务、选择规则、输出格式）与非空 user message（当前用户问题与最终回答，按需含产品能力范围段和 Skill 段，缺失项用显式"未提供"占位或省略整段）；输出恰好三条单一意图、用户口吻、跟随会话语言的可追问问题，禁止"是否需要"等助手口吻 | `question-recommendation`：`Prompt Variable Resolution` |
| 产品能力范围填槽 | 非空时经 `escapeTemplateVariable` 转义后填入 user message 产品能力范围段，并触发 system message 选择规则；空或未注入时省略该段，行为不变 | `question-recommendation`：`Capability Description Resolution`、`Prompt Variable Resolution` |
| Provider 双模式 | LOCAL 模式 load-once 缓存不检测变化；REMOTE 模式 `statSync` 指纹（`path:size:mtimeMs`）变化时重新加载 | `question-recommendation`：`Capability Description Provider` |
