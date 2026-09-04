# developer-hook-trace-logging Delta

## MODIFIED Requirements

### Requirement: 本地运行时打包包含带本地 release 默认激活的 developer hook trace 产物

本地运行时打包 SHALL 在 `config/plugins/developer-hook-trace/` 下包含生成的 `developer-hook-trace` plugin 产物。

对于 backend-capable 的本地 `pack:release` 候选包，打包 SHALL 在打包的 `config/default-system.yaml` 样例中使用 `nextAgent.system.plugins[]`（带 `path: "plugins/developer-hook-trace"` 和 `required: true`）声明 `developer-hook-trace`。打包 SHALL 还在打包的 `agents/default-agent/agent.yaml` 中为支持的 raw loop boundary 阶段激活 `developer-hook-trace.loop-raw-boundary`。

该默认激活仅限 package-staging 范围。打包 MUST NOT 修改仓库内建的默认 Agent 源定义，MUST NOT 改变非打包开发启动的默认值，并且 MUST NOT 默认启用 `context-monitor`。

#### Scenario: 打包的 backend-capable 运行时包含 developer hook trace 默认配置
- **WHEN** 本地 `pack:release` 阶段化一个 backend-capable 包
- **THEN** 候选包 MUST 包含 `config/plugins/developer-hook-trace/plugin.json`
- **AND** 候选包 MUST 包含 `config/plugins/developer-hook-trace/index.js`
- **AND** 打包的 `config/default-system.yaml` MUST 声明 `nextAgent.system.plugins[]` 条目 `{ pluginId: "developer-hook-trace", path: "plugins/developer-hook-trace", required: true }`
- **AND** 打包的 `agents/default-agent/agent.yaml` MUST 激活 `developer-hook-trace.loop-raw-boundary`
- **AND** 打包 MUST NOT 修改源 `packages/agent-core/src/builtin-agents/default-agent/agent.yaml`。
