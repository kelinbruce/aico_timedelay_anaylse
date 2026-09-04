# local-runtime-package Delta

## MODIFIED Requirements

### Requirement: 本地 release 包仅在包配置中阶段化开发者诊断默认值

backend-capable 的本地 release 包 SHALL 仅在包候选内部阶段化开发者诊断默认值。`pack:release` SHALL 将 `developer-hook-trace` plugin 声明加入打包的配置样例，并将匹配的 hook 激活加入打包的默认 Agent。这些生成的包默认值 SHALL NOT 变更仓库源 Agent 定义或非打包的本地开发默认值。

#### Scenario: Developer hook trace 默认值仅限本地 package staging
- **WHEN** 本地 `pack:release` 阶段化一个 backend-capable 包
- **THEN** 打包的 `config/default-system.yaml` MUST 声明本地 `developer-hook-trace` plugin 路径
- **AND** 打包的 `agents/default-agent/agent.yaml` MUST 激活 trace hook
- **AND** 仓库内建的默认 Agent 源 MUST 不被打包改动。
