## Why

电信网络问题描述和业务结果经常包含 IP 地址，Skill 作者也需要在操作说明中表达认证、令牌和凭据相关内容。当前系统会改写最终回答中的内网 IP，并可能因为 Skill 正文包含看似真实的认证或凭据值而拒绝加载，导致网络诊断证据失真，或使合法 Skill 无法执行。现有安全策略评审已经确认，这两类业务内容不应在对应内容边界接受额外限制，因此需要把系统行为收敛到该评审结论。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 最终用户可以在业务问题和回答中看到未经 IP 专项脱敏改写的 IPv4/IPv6 文本。
- Agent 开发者可以在 Skill 正文中使用 Auth、Authorization、Token、Credential、Password、Secret 和 API key 相关术语或值，而不会仅因此被拒绝加载。
- Agent 开发者可以在 Skill 正文中引用常见业务目录 `/tmp/`，不会仅因该路径文本被解释为宿主路径泄漏。
- 其他既有边界检查和敏感信息保护保持不变。

**非目标：**

- 不放宽日志、metric、trace、audit、safe error、配置、provider 调用或其他非业务内容边界的 credential/token 保护。
- 不允许 Skill 正文伪造或逃逸 `<skill_content>` wrapper，也不放宽来源授权、descriptor/body 一致性、文本编码、正文非空、大小预算、控制字符或 source-private path 检查。
- 不改变 CLIP `TOOL_STRUCTURED_DELTA`、Skill manifest metadata、Skill 参数或 Capability 结果 metadata 的校验策略。
- 不新增策略开关、例外配置或兼容分支。

## What Changes

- **BREAKING**：最终 client-visible 内容中的 IP 地址不再因 IP 形态被 `system.output-redaction-guard` 替换；其他终态敏感模式仍按既有策略处理。
- **BREAKING**：已授权 Skill 的 canonical markdown body 不再因 Auth、Authorization、Token、Credential、Password、Secret 或 API key 术语及其值被额外拒绝；正文仍必须通过所有非凭据内容边界检查。
- **BREAKING**：Skill Content 中的 `/tmp/` 路径不再作为 raw host path 命中项；其他受保护宿主绝对路径仍维持既有 safe failure。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.6 Skill 系统`：Agent 开发者可在合法 Skill 正文中表达认证和凭据类业务说明，不因内容关键词或值形态导致 Skill 加载失败。
- `F-10.1 扩展生命周期钩子`：最终用户可依赖终态输出保留业务 IP 事实，钩子的其他内容保护保证不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.9 调用技能` → `specs/skill-tool/spec.md`
  - 功能边界：已授权 Skill 的 canonical markdown body 只接受结构、来源和注入边界校验，不对 Auth、Authorization、Token、Credential、Password、Secret 或 API key 相关内容实施额外拒绝。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：canonical spec。
- `FN-10.1 注册和执行钩子` → `specs/lifecycle-hook-execution/spec.md`
  - 功能边界：终态输出保护不再把 IP 地址作为脱敏命中项，其他既有终态内容保护不变。
  - 系统质量属性：安全、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 最终回答和 Skill inline load 的可观察结果发生变化；公共 API、stream envelope、runtime contract 和配置 shape 不变。
- 受影响验证包括 Skill Tool inline body 测试、system output redaction guard 测试及相关开发者文档。
