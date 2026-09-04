## Why

Agent 开发者已经通过 Skill + Bash 调用 `clipc`。这类调用经常需要在 `--params.header` 中携带当前用户身份，但模型无法可靠获得可信的 `X-Subject-Id` 和 `X-Display-Name`；让用户或模型手工填写，既容易出错，也会把身份来源从可信执行上下文降级为不可信输入。

当前 Bash Tool 只会把部分身份信息注入进程环境变量，不会把身份写入 `clipc --params.header`。因此 Skill 作者无法用一个稳定、安全的约定把当前用户带给 `clipc`。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 当前 active Skill 通过 `metadata.extension.api_header_params` 明确声明 `X-Subject-Id` 和/或 `X-Display-Name` 时，Bash Tool 能从可信执行上下文自动注入 `X-Subject-Id` 和 `X-Display-Name` 到 `--params.header`。
- `X-Subject-Id` 来自 `identityContext.subjectId`，`X-Display-Name` 来自 `identityContext.displayName`。
- 模型或用户传入的同名字段必须被可信值覆盖。
- 不注入 `tenantId`，也不引入 `Agent-Tenant-ID`。
- 不改变 Bash Tool 的既有命令解析、沙箱边界和执行语义。

**非目标：**

- 不修改 CLIP-backed Tool、ApiCall Tool 或其他内置 Tool 的身份注入行为。
- 不新增通用 shell 变量展开或通用身份插值机制。
- 不支持租户维度；如后续需要 `tenantId`，必须另开 change。
- 不改变 `clipc` 自身的参数语法或网络调用语义。

## What Changes

- 修改 Bash Tool：当可解析的 executable 是 `clipc`、当前 active Skill 的 `api_header_params` 明确声明对应身份 header、且 `--params` 后续值是 JSON object 时，在提交 sandbox 前把可信 `X-Subject-Id` 和 `X-Display-Name` 合并进该 JSON object 的 `header` 字段。
- 保留 `--params` 中其他字段和 `header` 中其他键，不重排、不删除。
- 不注入 `tenantId`，不生成 `Agent-Tenant-ID`。
- 模型提供的 `X-Subject-Id` 或 `X-Display-Name` 不得覆盖可信执行上下文中的值。
- 当 `--params` 缺失或不是 JSON object 时，不合成身份参数，保持既有 Bash 命令行为。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.3 命令执行工具`：Bash 调用 `clipc` 时可依赖 runtime 注入可信用户身份，而不需要模型或用户提供身份值。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.5 执行命令和脚本` → `specs/command-script-tools/spec.md`
  - 功能边界：Bash Tool 在已 opt-in 的 `clipc` 调用的 `--params.header` 中注入可信 `X-Subject-Id` 和 `X-Display-Name`，并阻止模型覆盖这两个身份字段。
  - 系统质量属性：安全、可测试性。
  - 映射说明：`command-script-tools` 是本次修改的 canonical spec。

## 影响范围（Impact）

- Agent 开发者编写 Skill 时，可以通过 Bash + `clipc` 稳定携带当前用户身份，不需要让模型或用户提供身份值。
- Bash Tool 的模型可见说明需要补充该约定，避免模型试图手工填写身份字段。
- 受影响代码集中在 `agent-capability` 的 Bash Tool 实现；需要补充针对 `clipc` 参数注入、同名字段覆盖、非 `clipc` 命令不注入、无 `--params` 不注入的测试。
- 不影响前端、公共 Web API、持久化契约或配置默认值。
