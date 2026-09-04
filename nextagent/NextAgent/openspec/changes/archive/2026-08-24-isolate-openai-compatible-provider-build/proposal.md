## Why

平台集成方在确定使用 `model-gateway` 时，仍必须在发布产物中携带 OpenAI-compatible provider 的调用实现和对应 SDK 依赖。当前模型 runtime assembly 静态引用该 provider 实现，导致即使运行配置只选择 `model-gateway`，构建产物也无法物理排除 OpenAI-compatible 调用代码。这增加了供应链审计面、澄清成本和误配置风险，也违背 provider 可插拔的架构边界。

现在处理的必要性：模型调用公共契约已经 provider-neutral，OpenAI-compatible 只是可选 provider 实现。确定 provider 模式的服务构建应能生成不含该实现和 SDK 的产物；若部署配置与产物能力不匹配，必须启动前 fail closed，而不是静默降级或运行期才发现缺件。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 默认 `backend-only` 与 `with-frontend` 产物保持现状：仍可配置和使用 `openai-compatible` provider，公共调用契约不变。
- OpenAI-compatible provider 调用实现从通用模型 runtime assembly 中物理隔离，只通过显式 provider registration 注入。
- 新增 `model-gateway-only` 构建模式：TypeScript gateway-only project 不把 OpenAI-compatible provider 调用实现纳入编译输入，产物也不包含该实现和 `@ai-sdk/openai-compatible` SDK。
- `model-gateway-only` 产物遇到 `openai-compatible` model profile 时必须在启动/自检前 fail closed，并给出安全诊断；配置只含 `model-gateway` 且可信启动装配提供唯一 Model Gateway provider 时保持正常启动。
- 构建排除必须可由 package 产物和架构测试验证，不允许只靠约定或文档说明。

**非目标：**

- 不改变默认 provider 模式，不把出厂默认配置切换为 `model-gateway`。
- 不新增 provider 类型、不改变 `ModelInvocationRequest`、`ModelFinalResult`、model catalog 或 stream contract 的字段和语义。
- 不恢复 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL` 配置绑定；`OPENAI_MODEL_NAME` 保持既有可选模型名覆盖。
- 不实现运行期动态安装 provider 或根据配置自动下载/加载 provider。
- 不改变 `model-gateway` provider 自身的调用语义和 Model Gateway 透传规则。

## What Changes

### 修改

- 模型 runtime 只消费显式注入的 provider registration；通用 assembly 不再静态依赖 OpenAI-compatible provider 实现。
- 默认服务装配注入 OpenAI-compatible provider registration；`model-gateway-only` 装配不注入该 registration，并拒绝 `openai-compatible` 配置。
- 新增 `model-gateway-only` 打包模式。该模式保留现有 package profile 的后端/前端形态，但额外声明模型 provider 构建能力；gateway-only TypeScript project 排除 OpenAI-compatible provider 调用文件，打包产物继续排除该文件与 `@ai-sdk/openai-compatible` 依赖。
- `model-gateway-only` 产物配置不兼容时，启动与 package self-check 都必须 fail closed；不得发布可用性误导的 catalog，也不得把失败推迟到首次模型调用。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无

### 修改的 Function

- `FN-4.1 调用模型` → `specs/model-invocation-contract/spec.md`
  - 功能边界：模型 provider runtime 能力成为启动装配事实；`model-gateway-only` 服务在配置 `openai-compatible` 时 fail closed，公共调用契约保持不变。
  - 系统质量属性：可维护性、可靠性/恢复、可测试性
  - 映射说明：canonical spec `model-invocation-contract`；本次触及的 legacy spec `local-runtime-package`（构建产物与 self-check 语义）

## 影响范围（Impact）

- 构建和运维人员可为确定的 `model-gateway` 部署选择 `model-gateway-only` 产物，减少不必要的 provider SDK 和调用代码。
- 默认本地包、默认服务启动和已配置 OpenAI-compatible 端点的行为不回归。
- `agent-model` 需要公开 OpenAI-compatible registration 的独立入口；`agent-app` 只做配置加载、依赖注入和组合，不承载 provider 调用逻辑。
- 受影响测试覆盖 provider registration 注入、缺失 registration 的 fail-closed 行为、默认模式回归、产物排除和 package self-check。
