## 1. Spec

- [x] 1.1 新增 `gateway-configuration` spec，固定 gateway adapter selection、per-entry deploymentMode、provider resolve 和冻结语义。
  来源：spec requirement "Gateway configuration is loaded and stabilized during startup"；design 黑盒目标
- [x] 1.2 明确 local / remote gateway adapter 的启动期选择边界，以及 provider 支持性 / bindings 完整性的校验边界。
  来源：spec requirement "Gateway entries are selected independently by deployment mode"；design 边界
- [x] 1.3 明确上层模块只能消费 gateway ports 和冻结快照，不得读取 adapter 私有配置。
  来源：spec requirement scenario "Adapter composition happens after startup"；design 边界
- [x] 1.4 明确 gateway section 只向 app-level config result 贡献 diagnostics，不创建第二套全局 readiness 产物。
  来源：spec requirement scenario "Downstream module needs remote dependency access"；design 边界
- [x] 1.5 明确 adapter selection 是 per-port 静态部署配置锁定：local / remote gateway 共享接口、同时存在，仅 configured selected adapter 生效，运行时不动态切换或回退。
  来源：spec requirement "Adapter selection is a static per-port deployment decision"；design 黑盒目标

## 2. Design

- [x] 2.1 写清启动期读取、校验、冻结 gateway 配置的固定顺序。
  来源：design 实现流程、核心判断逻辑
- [x] 2.2 写清 `GatewaySelectionSnapshot`、`GatewayEndpointSnapshot` 和 gateway section diagnostics contribution 的语义和消费方。
  来源：design 状态/产物契约
- [x] 2.3 写清 selected entry 校验失败阻断和 safe diagnostics contribution 的边界。
  来源：design 失败处理
- [x] 2.4 写清该 change 与 `app-config-schema`、`secret-configuration-boundary`、model provider、capability source、dependency readiness 后续 change 的职责切分。
  来源：design 与相邻 change 的边界

## 3. Validation

- [x] 3.1 覆盖 local gateway 正常启动样例，以及省略 gateway section 时默认 local 的兼容样例。
  来源：design 验收样例 正常路径
- [x] 3.2 覆盖 local product deployment 中 remote gateway entry 仍被 selected、并交由 remote provider resolve 的样例。
  来源：spec requirement "Gateway entries are selected independently by deployment mode"；design 验收样例 正常路径
- [x] 3.3 覆盖 selected gateway entry 对应 missing / unsupported provider 的失败样例。
  来源：design 验收样例 失败路径
- [x] 3.4 覆盖 gateway identifier 重复、adapter kind 重复和 selection 失败诊断的验证样例。
  来源：design 验收样例 失败路径
- [x] 3.5 覆盖同一 gateway port configured selected adapter 生效、另一个不进入调用路径，以及选定 adapter 不可用时不自动回退的样例。
  来源：spec requirement scenario "No runtime dynamic fallback"；design 验收样例 失败路径

## 4. Gateway Provider SPI

- [x] 4.1 定义 `GatewayProvider` / `GatewayProviderCreateInput` / `GatewayBindings` 契约，并明确放置在 `agent-contracts/gateway`。
  来源：spec requirement "Gateway providers are injected through trusted app composition"；design 状态/产物契约
- [x] 4.2 明确 `GatewayBindings` 只能暴露稳定 gateway ports、bindings readiness 和 safe close lifecycle，不得暴露 adapter 私有 client、SDK 类型、连接池、raw endpoint、raw credential 或原始 provider config。
  来源：spec requirement "Gateway providers are injected through trusted app composition"；design `GatewayBindings`
- [x] 4.3 明确 `GatewayProvider.deploymentMode` 必须与 frozen gateway selection 的 `deploymentMode` 匹配，否则 startup fail closed。
  来源：spec requirement "Gateway registry resolves selected providers per gateway entry"；design 核心判断逻辑

## 5. App Composition Injection

- [x] 5.1 定义 `createNextAgentApp({ gatewayProviders })` / `createComposedApp({ gatewayProviders })` 为 trusted composition input。
  来源：spec scenario "Local entrypoint injects local provider"；design 与相邻 change 的边界
- [x] 5.2 定义 `GatewayRegistry` resolve 规则：按 selected entry `deploymentMode` 分组选择 provider，并在 provider 缺失、重复或 deploymentMode 不匹配时阻断 ready。
  来源：spec requirement "Gateway registry resolves selected providers per gateway entry"；design 实现流程
- [x] 5.3 明确 `agent-app` core composition 只 import SPI type，不 import local / remote concrete provider factory；local entrypoint / package runner 负责注入 provider。
  来源：spec requirement "Gateway providers are injected through trusted app composition"；design Local / remote product entrypoints
- [x] 5.4 明确 provider `create(input)` 失败或返回 invalid bindings 时阻断 ready，且不得回退到 local provider。
  来源：spec scenario "Provider create fails"；design 失败处理

## 6. Entrypoint And Packaging Blackbox

- [x] 6.1 定义官方 local entrypoint：`@nextagent/agent-platform-gateway-local/entrypoints/local` import `createLocalGatewayProvider()` 并注入。
  来源：spec scenario "Local entrypoint injects local provider"；design Local / remote product entrypoints
- [x] 6.2 定义 remote entrypoint 模型：外仓 entrypoint import vendor remote provider 并注入 `createNextAgentApp({ gatewayProviders })`。
  来源：spec scenario "Remote entrypoint injects vendor remote provider"；design Local / remote product entrypoints
- [x] 6.3 定义 package candidate evidence / startup proof / readiness proof 必须记录 selected provider id、deployment mode、gateway snapshot ref 和 bindings readiness ref。
  来源：spec requirement "Gateway capability evidence covers provider and bindings readiness"；design 输出与副作用
- [x] 6.4 覆盖 remote entrypoint 缺 remote provider、provider 不匹配、provider create 失败的黑盒阻断样例。
  来源：spec scenarios "Provider is missing"、"Provider deployment mode does not match selection"、"Provider create fails"
- [x] 6.5 覆盖 local entrypoint 和外仓 remote entrypoint 的黑盒启动验收样例。
  来源：design 验收样例 正常路径

## 7. Validation

- [x] 7.1 补 contract tests：`GatewayProvider` SPI shape、`GatewayBindings` 不泄漏私有实现。
  来源：design 质量属性设计 安全 / 可维护性
- [x] 7.2 补 composition tests：`agent-app` core composition 通过注入 provider resolve bindings，且不依赖具体 provider factory。
  来源：design 验证映射 provider 由 entrypoint 注入且 `agent-app` 只依赖 SPI
- [x] 7.3 补 startup negative tests：缺 provider、重复 provider、mode mismatch、create failure 不回退。
  来源：design 验证映射 provider create bindings 成功后才 ready
- [x] 7.4 补 packaging / release evidence tests：startup proof 记录 provider / deployment mode / bindings readiness，并为 remote 黑盒 proof 固定同形字段。
  来源：spec requirement "Gateway capability evidence covers provider and bindings readiness"
- [x] 7.5 补 architecture tests：`agent-app` core composition 不 import local / remote gateway provider factory。
  来源：design 验证映射 provider 由 entrypoint 注入且 `agent-app` 只依赖 SPI

## 8. On-Demand Gateway Bindings

- [x] 8.1 扩展 `GatewayProviderCreateInput`，提供 provider 按 selected gateway entry 创建 bindings 所需的 safe runtime context。
  来源：spec requirement "Gateway configuration owns provider selection and bindings handoff"
- [x] 8.2 local provider 根据 selected adapter kind 按需创建 sqlite stores、sandbox 和 scheduled-maintenance bindings；RAG 保持 agent-aware app composition 路径。
  来源：design 核心实现策略；agent scope 边界
- [x] 8.3 `agent-app` 优先消费 provider 返回的 config-owned bindings，缺失 provider 时保留既有 local fallback。
  来源：spec scenario "Adapter composition happens after startup"
- [x] 8.4 补 contract tests 覆盖 selectedEntries 只创建被配置选中的 bindings。
  来源：design 验证映射 provider create bindings 成功后才 ready

## 9. Core Gateway Package Decoupling

- [x] 9.1 `agent-app` core composition 不再 import concrete local / remote gateway package；local defaults 只由 local entrypoint / testing harness 注入。
  来源：spec requirement "Gateway providers are injected through trusted app composition"；design Local / remote product entrypoints
- [x] 9.2 `agent-app` 不再依赖 `agent-platform-gateway-remote` package；remote provider、SkillHub remote access 和 workflow fetch gateway 通过结构化 SPI / option 注入。
  来源：spec scenario "Remote entrypoint injects vendor remote provider"
- [x] 9.3 将 sync local fallback 从 core composition 移到 trusted local entrypoints / tests，core 缺少 provider bindings 或 fallback factory 时 fail fast。
  来源：design 核心实现策略 provider create bindings 成功后才 ready
- [x] 9.4 补 architecture tests 固定 `create-app.ts` 不依赖 concrete gateway package imports。
  来源：design 验证映射 provider 由 entrypoint 注入且 `agent-app` 只依赖 SPI

## 10. Entrypoint Ownership Target State

- [x] 10.1 将官方 local app entrypoint 从 `agent-app` package export 迁移到 `agent-platform-gateway-local/entrypoints/local`。
  来源：用户目标态；spec scenario "Local entrypoint injects local provider"
- [x] 10.2 在 `agent-platform-gateway-remote` 只提供 remote provider / adapter implementation reference，不导出 app entrypoint；外仓 remote entrypoint 显式注入完整 remote bindings / factories。
  来源：用户目标态；spec scenario "Remote entrypoint injects vendor remote provider"
- [x] 10.3 更新 architecture policy：只允许 local gateway package 的 `src/entrypoints/**` 和 public testing wrapper 依赖 `agent-app`，remote gateway package 作为 implementation reference 不依赖 app。
  来源：design Key Constraints；architecture boundary

## 11. Per-Entry Provider Resolution

- [x] 11.1 将 gateway provider resolve 从 deployment-level 唯一 provider 调整为按 selected entry `deploymentMode` 分组 resolve。
  来源：spec requirement "Gateway registry resolves selected providers per gateway entry"；用户目标态 remote package 可承载 sandbox/RAG/SkillHub，local 与 remote provider 同时注入
- [x] 11.2 合并多个 provider 返回的 `GatewayBindings`，并校验 merged bindings 覆盖全部 selected adapter。
  来源：spec scenario "Local and remote providers are both selected"
- [x] 11.3 补 contract tests 覆盖 local sqlite + remote sandbox/RAG/SkillHub 混合选择，以及缺失 provider / missing binding fail closed。
  来源：spec scenario "Local and remote providers are both selected"；failure handling

## 12. Remote Gateway Implementation Reference

- [x] 12.1 调整 `agent-platform-gateway-remote` 的 `createRemoteGatewayProvider`，支持通过显式 options 注入 stores、sandbox、RAG retrieval、scheduled maintenance 等完整 `GatewayBindings` 参考实现。
  来源：spec scenario "Remote entrypoint injects vendor remote provider"；用户目标态 remote package 支撑二次开发
- [x] 12.2 remote reference provider 只返回 selected entries 对应 bindings；未选中的 binding 不进入调用路径，selected adapter 缺 binding 时返回 BLOCKED readiness。
  来源：spec requirement "Gateway providers are injected through trusted app composition"；failure handling
- [x] 12.3 补 remote package tests 和 README，固定该 package 只作为二开实现参考，不导出 app entrypoint。
  来源：design Local / remote product entrypoints；architecture boundary

## 13. Developer Documentation

- [x] 13.1 在 `docs/developer` 补 remote gateway 开发指南，说明外仓如何开发 `GatewayProvider`、如何配置 gateway binding selection、如何通过 remote entrypoint 注入并启动。
  来源：spec scenario "Remote entrypoint injects vendor remote provider"；用户目标态 remote package 支撑二次开发

## 14. External Remote Gateway Module Reference

- [x] 14.1 将仓内 `agent-platform-gateway-remote` 调整为外仓可复制的 module 参考结构，拆分 provider、bindings 和 adapter 参考实现。
  来源：spec scenario "Remote entrypoint injects vendor remote provider"；用户目标态 remote package 在外仓开发
- [x] 14.2 补 remote package tests 覆盖 sandbox、RAG、scheduled maintenance adapter facade 与 selected binding assembly。
  来源：spec requirement "Gateway providers are injected through trusted app composition"；design Concrete local / remote gateway provider packages

## 15. Deployment Entrypoint Launcher

- [x] 15.1 package manifest 记录 LOCAL / REMOTE deployment entrypoint map，`bin/nextagent-start` 读取 `default-system.yaml` 的 `deployment.mode` 后只选择 manifest 声明的启动入口。
  验证：`tests/local-runtime-package.test.ts` 覆盖 LOCAL 通过 `startRuntimePackage()` 分发到 local startup path。
- [x] 15.2 REMOTE deployment 缺少 manifest-declared remote entrypoint 时 startup fail closed，且不得 fallback 到 LOCAL entrypoint。
  验证：`tests/local-runtime-package.test.ts` 覆盖 `deployment.mode: "REMOTE"` 且 manifest 无 REMOTE entrypoint 时写入 `deployment-entrypoint-missing` startup proof。

## 16. Remote Deployment Package Composition

- [x] 16.1 补充外部 remote deployment package 提供 entrypoint，并同时注入 `agent-platform-gateway-local` provider 与 vendor remote provider 的流程测试。
  验证：`tests/contract/gateway-configuration-contracts.test.ts` 覆盖 `deployment.mode: "REMOTE"` 下 local sqlite entry 由 local provider 创建、remote sandbox/RAG entry 由 remote provider 创建。
- [x] 16.2 补充仅 vendor remote gateway package 提供 entrypoint 的流程测试，并覆盖缺少 local provider 时 fail closed。
  验证：`tests/contract/gateway-configuration-contracts.test.ts` 覆盖 remote package 自身拥有 entrypoint 时同样必须注入完整 provider 集，以及 remote entrypoint 未注入 local provider 时阻断启动。

## 17. Remote Gateway Package Startup E2E

- [x] 17.1 构建临时 runtime package，模拟配套 gateway-remote package 提供 REMOTE manifest entrypoint，并通过 `startRuntimePackage()` 验证真实启动、startup proof 和 HTTP readiness。
  验证：`tests/local-runtime-package.test.ts` 动态写入 `vendor/gateway-remote-entrypoint.mjs`，该 entrypoint 使用 public package imports 装配 local provider + vendor remote provider，`deployment.mode: "REMOTE"` 选择 REMOTE entrypoint 后服务启动并返回 gateway readiness proof。
- [x] 17.2 构建临时 runtime package，并在 package-local `node_modules` 下生成 `@nextagent/agent-remote-deployment` 包，验证 manifest REMOTE entrypoint 使用 package specifier 时从 candidate package root dependency graph 解析。
  验证：`tests/local-runtime-package.test.ts` 覆盖 `@nextagent/agent-remote-deployment` package entrypoint 依赖 `@nextagent/agent-platform-gateway-remote`，无需让 `agent-app` 静态依赖 concrete local / remote gateway package。

## 18. Merged Workspace Remote Deployment

- [x] 18.1 仅保留 `@nextagent/agent-remote-deployment` 作为根 `packages/` workspace package，remote gateway 实现合并到 `@nextagent/agent-platform-gateway-remote`，覆盖 remote 相关代码合并到当前仓后一并编译打包的场景。
  验证：`npx tsc -b packages/agent-remote-deployment` 覆盖 workspace package 可独立编译。
- [x] 18.2 `@nextagent/agent-remote-deployment` 提供 manifest 可声明的 `startRemoteRuntimePackage(packageRoot)` 标准启动 entry，按 package config 装配 local provider + remote provider，并按需加载 remote binding endpoint。
  验证：`tests/architecture/gateway-provider-injection.test.ts` 固化 deployment package export 标准 entry；`npx tsc -b packages/agent-remote-deployment` 覆盖 entry 可编译。
  验证：`tsconfig.json` 和 `package-lock.json` 纳入 vendor deployment workspace package，`tests/architecture/gateway-provider-injection.test.ts` 固定 deployment 包依赖 `agent-app` / local provider / `agent-platform-gateway-remote`，不再存在独立 vendor gateway workspace package。

## 19. Deployment Config Entrypoint Override

- [x] 19.1 `default-system.yaml` 支持 `deployment.deploymentEntrypointRefs` 指定 LOCAL / REMOTE startup entry，runtime package launcher 以 config entry 覆盖或补充 manifest entry。
  验证：`tests/local-runtime-package.test.ts` 覆盖 REMOTE entry 只写入 config sample、不通过 `stageLocalRuntimePackage({ deploymentEntrypointRefs })` 传入，也能通过 `startRuntimePackage()` 启动 remote package。
