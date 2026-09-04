## 背景与问题（Why）

当前系统已经把 app composition 配置冻结、模型 profile 配置和 capability source 配置拆成独立 change，但 gateway adapter 本身仍缺少一套单独的目标规格来回答以下问题：

- 每个 gateway entry 到底选择 `local` 还是 `remote` gateway provider；
- local 与 remote provider 同时注入时，各自应承载哪些 selected entries；
- 远端依赖被 selected 但 provider / bindings 不完整时，系统如何阻断和留下安全诊断。

本 change 回答 gateway adapter selection 的字段语义、entry 判定规则、冻结 section 形态、`GatewayProvider` SPI、trusted provider 注入协议、local / remote entrypoint 装配协议，以及 package / startup evidence 中如何证明 gateway 能力已落地。它不重新拥有全局 configuration lifecycle，不重新定义 secret grammar 或全局 readiness 产物，也不拥有 vendor remote provider 的 endpoint / credential 等私有 access baseline。

如果没有这层统一规格，gateway 接入配置会分散到 model、capability、memory、channel 或具体 adapter 内部，导致：

- 启动期和请求期重复解释同一份 gateway 配置；
- 上层模块绕过 gateway port 直接依赖 adapter 私有字段；
- local/remote adapter 的选择边界漂移；
- 远端依赖缺失时出现静默失败或不一致的 unavailable 行为。

## 变更范围（What Changes）

- 新增 `gateway-configuration` capability。
- 定义 gateway adapter 选择与 gateway section 冻结边界：启动期同步读取、校验并冻结 gateway 配置；adapter selection 是 per-entry / per-port 静态部署配置锁定，local 与 remote gateway provider 共享同一 SPI，可在同一 app 中同时注入并分别承载不同 adapter，运行时不动态切换或回退。
- 定义 `GatewayProvider` / `GatewayBindings` SPI：`agent-app` core composition 只 import 稳定 SPI type，并通过 `createNextAgentApp({ gatewayProviders })` / `createComposedApp({ gatewayProviders })` 接收 trusted provider 实例。
- 定义 local / remote entrypoint 装配协议：官方 local entrypoint 由 `agent-platform-gateway-local/entrypoints/local` 拥有并注入 concrete local provider；remote entrypoint 由外部 vendor remote package 拥有并注入完整 remote provider / bindings / factories；仓内 `agent-platform-gateway-remote` 仅作为 remote provider / adapter implementation reference，不导出可启动 app entrypoint；`agent-app` core composition 不 import concrete local / remote provider factory，也不 export local / remote product entrypoint。
- 定义首版稳定配置关注点：adapter selection、per-entry deploymentMode、provider resolve、安全校验和 bindings readiness。endpoint / `baseUrl` / credential reference 等 vendor access baseline 不在本 change 范围，由具体 remote provider package 或后续 remote dependency change 定义。
- 提供兼容能力：source configuration 完全省略 `gateway` section 时，系统默认应用 sqlite gateway 配置，使单进程本地部署无需显式 gateway entry 即可启动。
- 定义稳定产物：`GatewaySelectionSnapshot`、`GatewayBindings` readiness proof 和 gateway section diagnostics contribution。
- 定义 selected gateway entry 的校验、provider 归属和 gateway entry unavailable 的显式表达边界。
- 明确 local provider 必须可完整支撑首版本地运行；remote provider 由外部 entrypoint 注入，可承载 SkillHub、RAG、sandbox 等 remote adapter。每个 gateway entry 按自身 `deploymentMode` resolve provider 并创建 bindings；任一 selected entry 缺 provider、provider 不支持或 bindings 不完整时 startup / package evidence 必须 fail closed，且不得回退到另一个 provider。

## Capability 影响（Capabilities）

### 新增 Capability

- `gateway-configuration`: 定义启动期如何读取、校验、冻结和暴露 gateway adapter 选择与接入配置，并为后续 platform gateway、capability source、model provider、memory / RAG、SkillHub 或 sandbox 相关 change 提供稳定输入。

### 修改的 Capability

- `app-config-schema`: 补充 gateway section 并入总配置冻结产物与总验证结果的要求。
- `local-runtime-release`: 补充“ready 前必须完成 gateway configuration validation / freeze”的要求。

## 影响范围（Impact）

- 受影响模块：
  - `modules/agent-app`
  - `modules/agent-platform-gateway-local`
  - `modules/agent-contracts`
  - `modules/agent-model`
  - `modules/agent-capability`
  - `modules/agent-memory`
  - `packages/agent-platform-gateway-local/entrypoints`
  - vendor remote app entrypoint packages
  - local runtime packaging / release evidence
  - `tests/contract`
  - `tests/integration`
- 受影响配置：
  - app composition 中的 `gateway` 配置组
  - gateway adapter selector
  - gateway provider selection（per-entry / per-port 静态锁定）
  - local / remote product entrypoint provider injection
- 受影响协作边界：
  - `agent-app` 负责 gateway 配置解释、校验、冻结、provider registry resolve、bindings readiness 和 ready gate 接入
  - local / remote gateway package entrypoint 负责 import concrete provider 并注入 `agent-app` core composition
  - local / remote gateway provider 只消费冻结产物和 create input，不重复读取原始配置
  - model / capability / memory / source 相关模块只能消费 gateway port 与冻结后的 selection baseline

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：

- `openspec/specs/gateway-configuration/spec.md`：新增

设计视图：

- `openspec/designs/architecture/configuration-boundary.md`
- `openspec/designs/contracts/platform-gateway-spi.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/modules/agent-platform-gateway-local.md`
- vendor remote provider / external remote entrypoint integration guide
- `openspec/designs/spec-to-design-map.md`

验证入口：

- gateway configuration contract tests
- bootstrap validation tests
- readiness / startup blocking integration tests
- provider injection / bindings readiness smoke tests
