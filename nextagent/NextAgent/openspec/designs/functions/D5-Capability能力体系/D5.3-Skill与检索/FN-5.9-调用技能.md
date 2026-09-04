# FN-5.9 调用技能

> 能力域 D5 Capability 能力体系 · 子域 [D5.3 Skill 与检索](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-5.6](../../../features/D5-Capability能力体系/D5.3-Skill与检索/F-5.6-Skill系统.md) |
| 主规格 | `skill-tool` |
| 接口 | 能力调用端口（技能工具） |

## 描述

模型通过技能工具调用技能，支持内联和分叉执行，并可用 canonical `toolChoice` 受治理地调整同一 request/run 后续模型步骤。`Skill.args` 只承载业务 task data，不改变可信 runtime 执行治理。

## 前置条件

- 技能在当前请求范围内可用。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 技能标识 | 是 | 要调用的技能 |
| 调用参数 | 是 | 技能输入；`args` 接受满足既有 JSON envelope 边界的业务 task data，任意字段名都不因名称本身被全局拒绝 |
| 执行模式 | 否 | 内联或分叉 |

## 输出

技能执行结果。

## 处理过程

1. 系统校验技能可用性和权限。
2. 系统将 `args` 作为 task data 校验，并只从可信 runtime context、policy 和受治理 metadata 推导实际 timeout、child budget、provider selection 等执行治理；不从 `Skill.args` 读取执行控制。
3. 按内联或分叉模式执行技能。
4. Skill 配置使用规范模型标识，不通过名称反查产生第二套模型身份。
5. Skill metadata 的封闭 model options 只接受 canonical `toolChoice: AUTO | NONE | REQUIRED` 等已批准字段；省略时不覆盖，非法值安全失败。
6. 返回执行结果。

## 结果

- 正常：返回执行结果。
- 技能不可用：安全失败。
- 调用超时：安全失败。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 执行模式 | `inline`、`fork` | `skill-tool`：`Skill tool is the model-facing Skill execution entry` |
| `args` 边界 | UTF-8 JSON 最多 8,192 bytes，最大嵌套深度 8；产品配置只能收紧 | `skill-tool`：`Skill tool is the model-facing Skill execution entry` |
| `args` 字段名规则 | 任意字段名均不因名称本身被全局拒绝，且不覆盖可信执行治理 | `skill-tool`：`Skill args 不按字段名承担执行治理` |
| 调用结果 | 每次 Skill 调用在成功、降级、失败、超时或取消后恰好产生一个相关终态结果 | `skill-tool`：`Skill tool is the model-facing Skill execution entry` |
| 后续模型 Tool 选择 | 未声明时不覆盖；声明时只接受 `AUTO | NONE | REQUIRED`，不接受 named-tool object 或 provider-native alias | `skill-tool`：`Skill tool is the model-facing Skill execution entry` |
| Skill 披露承载 | 披露 section 由 builtin `SYSTEM_PROMPT` 模板的 `skill_disclosure` builder-owned section 承载（dynamic 区），heading 恰为 `### Available skills` 与 `### How to use skills`，列表格式 `- <skill-name>: <safe description>`；Agent 可覆盖该 section，覆盖仍受 Skill tool 可见性门控约束 | `skill-tool`：`Skill tool is the model-facing Skill execution entry` |
| inline Skill 正文承载位置 | 正文通过同一 `structuredPayload.body`（`<skill_content>` envelope）传输，`generatedMessages` 为空，不再经单独 hidden generated message 重复传输；普通会话内容与过程投影不展示 `structuredPayload.body` | `skill-tool`：`Inline Skill 正文必须保持单一隐藏注入` |
| inline body 编码兜底 | inline body 边界检查 MUST 拒绝含 `U+FFFD` 的 canonical body，返回 `EXECUTION_FAILED`（`category=VALIDATION`），不注入 hidden context，不暴露 raw body 或字节证据 | `skill-tool`：`Skill Inline Body Rejects Replacement Character` |
| 非 agentic 分派 | `extension._naie_agentic_loop_flag="false"` 时 Skill tool 仍加载 body 解析 API 命令但不注入 body、不做 resource projection，返回 `nonAgenticApiCall: true` 信号；`"true"` 或缺失时走现有 inline 路径 | `skill-tool`：`Skill Tool Non-Agentic Dispatch` |
