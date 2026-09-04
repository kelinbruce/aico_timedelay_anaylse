## 设计决策（Decisions）

### 1. SDK 只提供插件定义和日志 entry 格式

`agent-plugin-sdk` 新增 `createDeveloperHookTracePlugin(options)`。该函数返回标准 `NextAgentPlugin`，并内置一个 observe-only lifecycle hook：

- `pluginId`: `developer-hook-trace`
- `hookId`: `developer-hook-trace.loop-raw-boundary`
- `kind`: `CUSTOM`
- `effects`: `["OBSERVE"]`
- `failureMode`: `CONTINUE`
- `supportedStages`: `BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`BEFORE_CAPABILITY_INVOKE`、`AFTER_CAPABILITY_RESULT`

SDK 不负责插件加载、不负责 Agent 激活、不读取 app config。调用方通过 `log(entry)` 传入日志 sink；SDK 同时提供 `createDeveloperHookTraceFileLogSink({ logDirectory })`，用于把 entry 写入调用方显式传入的 `logs` 目录。

### 2. 不新增 host external

本次不改 `HOST_EXTERNAL_INVENTORY`，避免没有 app loader 配套时出现不可用 external。插件构造函数通过普通 options 接收 sink，适合 SDK 使用方、测试 harness 或上层插件 packaging 复用。

### 3. observe-only 不影响请求真相

hook 的 log 调用包在 `try/catch` 内，sink 抛错时仍返回 `{ outcome: "PASS" }`。`enabled: false` 时不调用 sink，直接 PASS。

### 4. NDJSON 格式和可选文件 sink 都在 SDK 内

SDK 提供 `formatDeveloperHookTraceLogLine(entry)`，返回一行 JSON 加换行。SDK 也提供可选 file sink helper，默认文件名为 `developer-hook-trace.ndjson`，并限制 `logFile` 不能逃逸调用方传入的 `logDirectory`。SDK 不绑定仓库运行时路径，也不修改任何 app/runtime 配置。

### 5. SDK 提供正式 plugin artifact 写出 helper

SDK 在同一个 `developer-hook-trace` 子路径提供 `createDeveloperHookTracePluginArtifact(options)`，写出 loader 可消费的 `plugin.json + index.js`。该 helper 只写调用方传入的 `targetDirectory`，默认不覆盖已存在的 artifact 文件，`overwrite: true` 时允许重写。

生成的 `plugin.json` 使用：

- `pluginId`: `developer-hook-trace`
- `apiVersion`: `1.0`
- `main`: `./index.js`
- `artifactType`: `esm-bundle`
- `hostExternals`: `[]`

生成的 `index.js` 是 single-file ESM artifact，不包含 static import/export-from specifier，避免被现有 app plugin loader 的 bundle scan 拒绝。artifact 内的 hook 仍是 observe-only，并通过 hook `configSchema/configure` 支持 Agent activation 配置 `enabled`、`logDirectory` 和 `logFile`。这样正式生效路径仍使用现有系统配置和 Agent hook activation，不新增 app config 或 runtime 特例。

### 6. 本地 runtime 包默认预置 artifact 但不声明配置

`scripts/pack-local-runtime.mjs` 在 staging 本地 runtime candidate 时，默认调用 `createDeveloperHookTracePluginArtifact(...)` 写入 `config/plugins/developer-hook-trace/`。这只让 artifact 随包可用，不改变 `config/default-system.yaml` sample，不向 sample 注入 `nextAgent.system.plugins[]`，也不向默认 Agent 注入 `hooks[]`。

启用路径保持显式：用户需要在运行时配置中声明 `nextAgent.system.plugins[]`，并在目标 Agent `hooks[]` 激活 `developer-hook-trace.loop-raw-boundary`。

## 风险与取舍（Risks / Trade-offs）

- SDK-only 方案不能单独保证运行时一定启用插件，只能提供插件定义和可选 file sink。加载、激活和传入 `logs` 目录仍由调用方负责。
- artifact helper 只能生成可部署产物；本地 runtime 打包默认复制到 `config/plugins/developer-hook-trace/`，但是否在 `default-system.yaml` 声明插件、是否在目标 Agent `hooks[]` 激活，仍由调用方负责。
- 当前 `HookInput` 不包含 owner scope，也不包含 stage occurrence key；本次不扩展 contract，因此 entry 只记录现有可见的 session/request/run/agent/hook/boundary 字段。
