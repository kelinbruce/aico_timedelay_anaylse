## Why

部署方和运维人员在接入 OpenAI-compatible 模型端点时，当前必须使用名为 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 的环境变量。这两个名称让人误以为系统只支持 OpenAI 官方服务，或必须使用 OpenAI 官方 endpoint；实际系统通过 OpenAI-compatible 协议接入任意兼容端点（包括电信内部模型网关、第三方兼容服务）。该命名产生的澄清成本在电信集成、跨团队交付和客户对接中反复出现。

产品出厂默认配置（`default-system.yaml`）将 `openai-compatible` provider 的 `baseUrl` 绑定为 `env:OPENAI_BASE_URL`、`credentialRef` 绑定为 `env:OPENAI_API_KEY`。这强制每个部署必须使用这两个带误导性的环境变量名才能让出厂配置生效，且使产品出厂配置与某一组固定环境变量名耦合，而非依赖配置本身。

现在处理的必要性：出厂配置应是一个可被服务构建/部署阶段填充真实接入参数的模板，而不是绑定特定环境变量名的事实来源；代码也不应硬编码 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 这两个环境变量名。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 出厂默认配置的 `openai-compatible` provider profile 不再绑定 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 环境变量引用；`baseUrl` 和 `credentialRef` 在出厂默认配置中缺省（作为模板），真实接入参数由服务构建/部署阶段在配置 overlay 中注入。
- `openai-compatible` provider 的 `baseUrl` 由必需改为可选；当 `baseUrl` 缺失时，该 provider profile 被视为“未配置”，其子模型在模型目录中为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`，不提供 resolved configuration。
- 当出厂默认配置未注入真实接入参数时，本地服务启动成功并进入 `DEGRADED_READY`，给出明确安全诊断提示模型 provider 未配置；模型目录中相关条目为 `UNAVAILABLE`，模型调用返回安全 model-unavailable failure。系统不静默降级、不回落 fake/test/no-op provider 或默认 endpoint。
- 代码不再硬编码 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 环境变量名作为配置生成或 override 来源。

**非目标：**

- 不改变默认模型 provider 模式：出厂默认仍为 `openai-compatible`，不改为 `model-gateway` 默认模式。
- 不重命名 `OPENAI_MODEL_NAME`：该变量名是两个 provider 模式通用的模型标识来源，本 change 不移除或重命名它。
- 不实现 openai-compatible 调用代码的物理隔离与构建时可插拔/可排除。该目标作为独立 OpenSpec change 推进，避免与配置解耦混入单一职责。
- 不修改模型调用契约的 provider-neutral 输入/输出、流式语义、超时/重试或 safe failure 边界。
- 不修改 secret reference grammar（仍只允许 `env:`/`file:` reference，不接受 raw secret）。

## What Changes

### 修改

- **BREAKING** 出厂默认配置移除 `openai-compatible` provider profile 的 `baseUrl: env:OPENAI_BASE_URL` 和 `credentialRef: env:OPENAI_API_KEY`，改为缺省。依赖出厂默认配置读取这两个环境变量的部署，改为在服务构建/部署 overlay 中提供 `baseUrl`（合法 http/https URL 字面量或 `env:`/`file:` reference）和 `credentialRef`（`env:`/`file:` reference）。
- **BREAKING** `openai-compatible` provider 的 `baseUrl` 从必需改为可选：当 `baseUrl` 缺失时该 provider profile 被视为“未配置”，其子模型在模型目录中为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`，不提供 resolved configuration。
- 当某 provider profile 因 `baseUrl` 缺失而未配置时，启动校验 MUST 产生不影响 readiness 的安全诊断（仅含相关 `providerId`、`modelId` 和安全 code）；即使配置中不存在其他 viable provider profile，应用也 MUST 保持 `DEGRADED_READY` 并可启动。
- 代码移除硬编码 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 环境变量名的配置生成与 override 逻辑；模型接入配置只从 `modelProfiles` 配置本身解析。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无

### 修改的 Function

- `FN-4.1 调用模型` → `specs/model-invocation-contract/spec.md`
  - 功能边界：`openai-compatible` provider 的 `baseUrl` 从必需改为可选；`baseUrl` 缺失时该 provider profile 的子模型为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`；应用保持 `DEGRADED_READY` 并以安全诊断提示模型 provider 未配置，模型调用返回安全 model-unavailable failure。
  - 系统质量属性：可靠性/恢复、可维护性
  - 映射说明：canonical spec `model-invocation-contract`；本次触及的 legacy spec `local-runtime-package`（用户运行前置条件 Scenario）

`secret-configuration-boundary` 的 `Product credentials use the frozen SecretReference grammar` Requirement 已声明 `credentialRef` 缺失时的 no-credential 语义由 `model-invocation-contract` 定义；本 change 在 `model-invocation-contract` 定义该未配置语义，不修改 `secret-configuration-boundary` 的 Requirement 文本或 grammar。

## 影响范围（Impact）

- **部署/运维**：依赖出厂默认配置读取 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 的现有部署需迁移为在服务构建/部署 overlay 中显式提供 `baseUrl` 和 `credentialRef`。出厂默认配置未注入接入参数时服务启动成功但为 `DEGRADED_READY`，模型调用不可用。
- **配置**：出厂 `default-system.yaml` 的 `modelProfiles` openai-compatible profile 去除 `baseUrl`/`credentialRef` 字段。
- `OPENAI_MODEL_NAME` 保留为可选模型名覆盖；当 provider 未配置且该变量缺失时，内置默认配置解析为安全占位模型名 `default-model`，服务仍进入 `DEGRADED_READY`。
- **代码**：移除配置加载中对 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 环境变量名的硬编码引用与 override 逻辑。
- **测试**：依赖出厂默认配置读取这两个环境变量的测试需改用显式 overlay 或测试 fixture 提供 `baseUrl`/`credentialRef`。
- **文档**：指导用户配置 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 的文档需更新为通过配置 overlay 提供 `baseUrl`/`credentialRef`。
