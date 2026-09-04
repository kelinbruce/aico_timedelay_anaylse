## ADDED Requirements

### Requirement: SDK 提供 developer hook trace plugin 定义

`agent-plugin-sdk` SHALL 提供一个 `developer-hook-trace` plugin 定义，且构造该 plugin 无需改动其他 package。该 plugin SHALL 贡献一个名为 `developer-hook-trace.loop-raw-boundary` 的 observe-only lifecycle hook。

该 hook SHALL 只支持 `BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`BEFORE_CAPABILITY_INVOKE` 和 `AFTER_CAPABILITY_RESULT`。该 hook SHALL NOT 返回 mutation，并 SHALL 使用 `failureMode: CONTINUE`。

#### Scenario: Developer hook trace plugin 暴露预期的 hook
- **WHEN** SDK 代码创建 developer hook trace plugin
- **THEN** plugin id MUST 为 `developer-hook-trace`
- **AND** 该 plugin MUST 暴露 hook `developer-hook-trace.loop-raw-boundary`
- **AND** 该 hook MUST 是 observe-only 并支持四个 loop boundary 阶段

### Requirement: SDK developer hook trace logging 归调用者所有

SDK plugin SHALL 接受调用者提供的 log sink。SDK SHALL NOT 更改 app config，也不要求新的 host external。SDK SHALL 提供一个 formatter，把一条 developer hook trace entry 转换为单行 NDJSON。SDK MAY 提供一个写入调用者提供的 `logDirectory` 的 file sink helper；该 helper MUST 把目标文件保持在调用者提供的目录之下。

每条 entry SHALL 至少包含 `event`、`hookId`、`stage`、`agentId`、`agentVersion` 和 `boundary`。当既有 `HookInput` 提供这些字段时，entry SHALL 还包含 `sessionId`、`requestId`、`runId`、`agentAssemblyRef`、`hookInvocationId` 和 `idempotencyKey`。

#### Scenario: Hook 通过调用者 sink 记录既有 raw boundary
- **WHEN** 该 hook 在一个受支持的阶段执行
- **THEN** 它 MUST 用一条 `DEVELOPER_HOOK_TRACE` entry 调用调用者提供的 sink
- **AND** 该 entry MUST 原样包含 hook boundary
- **AND** NDJSON formatter MUST 把该 entry 序列化为一行 JSON

#### Scenario: SDK file sink 写入调用者提供的日志目录之下
- **WHEN** 调用者以一个 `logDirectory` 创建 SDK file sink
- **THEN** 该 sink MUST 在该目录之下写入 NDJSON entry
- **AND** 它 MUST 拒绝逃逸该目录的 `logFile`

### Requirement: SDK developer hook trace logging 是 observe-only

SDK hook SHALL 不改变 request 真相。如果 plugin option 禁用了 logging，该 hook SHALL 返回 `PASS` 而不调用 sink。如果 sink 抛出异常，该 hook SHALL 捕获该错误并返回 `PASS`。

#### Scenario: 被禁用或失败的 sink 不影响 hook 结果
- **WHEN** logging 被禁用
- **THEN** 该 hook MUST 返回 `PASS` 而不写入 entry
- **WHEN** 调用者提供的 sink 抛出异常
- **THEN** 该 hook MUST 仍然返回 `PASS`

### Requirement: SDK 可以写出正式的 developer hook trace plugin artifact

`agent-plugin-sdk` SHALL 从 `developer-hook-trace` subpath 提供一个 helper，为 developer hook trace plugin 写出正式的本地 plugin artifact。该 artifact SHALL 由调用者提供的目标目录下的 `plugin.json` 和单文件 ESM `index.js` 组成。该 artifact manifest SHALL 使用 plugin id `developer-hook-trace`、API version `1.0`、`main: "./index.js"`、`artifactType: "esm-bundle"`，且不包含 host external。

生成的 `index.js` SHALL 贡献 hook `developer-hook-trace.loop-raw-boundary`，并且 SHALL 能通过既有 plugin loader 路径使用，而无需新增 app/runtime/config schema 变更。该 artifact hook SHALL 支持 `enabled`、`logDirectory` 和 `logFile` 的 activation config；`logFile` MUST 保持在 `logDirectory` 之下。除非调用者显式要求覆盖，否则当 artifact 文件已存在时该 helper SHALL 失败。

#### Scenario: SDK 写出 loader 兼容的 developer hook trace artifact
- **WHEN** SDK 代码在某个目标目录下创建 developer hook trace plugin artifact
- **THEN** 目标目录 MUST 包含 `plugin.json` 和 `index.js`
- **AND** `plugin.json` MUST 声明 `artifactType: "esm-bundle"` 和 `main: "./index.js"`
- **AND** 生成的 plugin MUST 暴露 `developer-hook-trace.loop-raw-boundary`
- **AND** 执行已配置的 artifact hook MUST 在配置的日志目录下写入 `DEVELOPER_HOOK_TRACE` NDJSON
- **AND** 不带 overwrite 再次运行 helper MUST fail closed

#### Scenario: 产品路径加载生成的 artifact 并写入 trace 日志
- **WHEN** 一个 app system config 声明了生成的 `developer-hook-trace` plugin artifact
- **AND** 目标 Agent 为 `BEFORE_MODEL_INVOKE` 激活 hook `developer-hook-trace.loop-raw-boundary`
- **WHEN** 一个 request 到达 model invocation 路径
- **THEN** app MUST 通过正常 plugin loader 加载生成的 artifact
- **AND** 被激活的 hook MUST 在配置的日志目录下追加一条 `DEVELOPER_HOOK_TRACE` NDJSON entry
- **AND** 该 request MUST 仍然成功完成

### Requirement: 本地 runtime 打包包含 developer hook trace artifact 但默认不激活

本地 runtime 打包 SHALL 在 `config/plugins/developer-hook-trace/` 之下包含生成的 `developer-hook-trace` plugin artifact。打包配置样例 SHALL NOT 为该 plugin 声明 `nextAgent.system.plugins[]`，并且打包 SHALL NOT 添加 Agent `hooks[]` 激活。

#### Scenario: 打包的 runtime 包含 artifact 但配置样例保持未激活
- **WHEN** 本地 runtime 打包组装一个 backend-capable package
- **THEN** 候选包 MUST 包含 `config/plugins/developer-hook-trace/plugin.json`
- **AND** 候选包 MUST 包含 `config/plugins/developer-hook-trace/index.js`
- **AND** `config/default-system.yaml` MUST NOT 为 `developer-hook-trace` 声明 `nextAgent.system.plugins[]`
- **AND** 默认 Agent MUST NOT 被修改为激活 `developer-hook-trace.loop-raw-boundary`
