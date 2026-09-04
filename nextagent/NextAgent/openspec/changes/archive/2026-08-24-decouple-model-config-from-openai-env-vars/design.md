## 设计范围

| Function | 目标变化 | 涉及 delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | `openai-compatible` 的 `baseUrl` 由必需改为 optional；`baseUrl` 缺省时服务启动成功并进入 `DEGRADED_READY`，相关模型目录项为 `UNAVAILABLE`；raw config 不得隐式注入 `OPENAI_*` env 名 | `specs/model-invocation-contract/spec.md`（MODIFIED）、`specs/local-runtime-package/spec.md`（MODIFIED） | FN-4.1 调用模型 |

## 存量 Requirement 迁移方案

本 change 不跨 spec 迁移 Requirement。`local-runtime-package` 的 `Local runtime package is a user-runnable platform artifact` Requirement 原位 MODIFIED，仅更新用户运行前置条件与未配置模型时的可观察启动行为；`model-invocation-contract` 承载模型目录与调用失败语义。

## FN-4.1 调用模型

### 目标与规范依据

proposal 目标：出厂默认配置不绑定 `OPENAI_API_KEY`/`OPENAI_BASE_URL`；`openai-compatible` 的 `baseUrl` 与 `credentialRef` 可缺省（模板），真实接入参数由服务构建/部署 overlay 注入；代码不硬编码这两个 env 名；本地未配置模型时服务可启动并明确提示，而不是启动失败。

设计约束：本地无 overlay 时服务必须进入 `DEGRADED_READY`，模型目录条目为 `UNAVAILABLE`，模型调用返回安全 model-unavailable failure；系统不得回落 fake/test/no-op provider 或默认 endpoint。

本 Function 的目标 Requirements：

- canonical spec：`model-invocation-contract`
- MODIFIED `全局模型目录提供安全模型配置`
- MODIFIED `Agent App system config 使用 canonical model/provider 配置`
- 触及 legacy spec `local-runtime-package`（MODIFIED `Local runtime package is a user-runnable platform artifact`）

### 当前实现

- `packages/agent-app/config/default-system.yaml` 的 `modelProfiles` 含 `openai-compatible` 父项，`baseUrl: env:OPENAI_BASE_URL`、`credentialRef: env:OPENAI_API_KEY`、子项 `modelId: env:OPENAI_MODEL_NAME`。
- `packages/agent-app/src/config/validation.ts`：`openai-compatible` 的 `baseUrl` 为必需，缺失或非 http URL 会产生阻止 ready 的 issue；`credentialRef` 为 optional 但存在时必须是 `env:`/`file:` 并可解析。`modelProfiles` 为空或没有 accepted profile 时产生 `APP_CONFIG_NO_VIABLE_MODEL` 并阻止 ready。
- `packages/agent-app/src/assembly/agent-assembly-compiler.ts`：Agent assembly 从 `modelProfiles` 派生或校验 `modelIds`，要求非空且必须存在于 `systemConfig.modelProfiles`。
- `packages/agent-model/src/catalog/model-catalog.ts`：已支持 `UNAVAILABLE` 目录项和 `MODEL_INFORMATION_UNAVAILABLE | MODEL_NOT_FOUND | MODEL_INFORMATION_AMBIGUOUS | CONTEXT_WINDOW_INVALID` 原因；Gateway 信息不可用时应用可保持 ready，assembly 可引用不可用模型。
- `packages/agent-app/src/config/env.ts` 导出无人引用的 `credentialEnvNames`。
- `packages/agent-app/src/testing.ts` 读取 `OPENAI_MODEL_NAME`/`OPENAI_BASE_URL` 做 profile override。
- `packages/agent-app/src/local-runtime-package/index.ts` 为 `openai-compatible` 注入 `baseUrl: 'env:OPENAI_BASE_URL'`。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| `baseUrl` 缺失不阻止启动 | 缺失即 `BLOCKED` | 需把缺失从配置错误改为 provider 未配置降级 |
| 未配置模型在目录中可见且不可调用 | 无该目录状态 | 需新增 `MODEL_PROVIDER_NOT_CONFIGURED` unavailable reason |
| 无 viable 模型时服务可启动 | `APP_CONFIG_NO_VIABLE_MODEL` 阻止 ready | 需将该场景转为 `DEGRADED_READY` 的 warning evidence |
| Agent assembly 可引用未配置模型 | assembly 只要求模型存在于配置 | 保留配置项即可复用现有引用校验 |
| 出厂默认不绑定 OPENAI_* env | 绑定 `env:OPENAI_BASE_URL`/`env:OPENAI_API_KEY` | 修改默认配置并清理代码注入逻辑 |

### 修改方案

**1. 配置校验：区分“未配置”与“配置非法”**

provider access 状态分类：

| 父项状态 | baseUrl | credentialRef | 配置校验结果 | 模型目录结果 |
|---|---|---|---|---|
| `openai-compatible` 已配置 | 合法 http/https URL | 存在且可解析，或缺失(no-credential) | 通过 | 按现有规则解析，可 `AVAILABLE` |
| `openai-compatible` 未配置 | 缺失 | 任意 | 通过，产生 `APP_CONFIG_MODEL_PROVIDER_NOT_CONFIGURED` warning evidence | `UNAVAILABLE`，`unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED` |
| `openai-compatible` 配置非法 | 存在但非法 URL | 存在但 grammar 非法或不可解析 | 阻止 ready | 不发布可用模型 |
| `model-gateway` 正常 | 缺失（必须） | optional | 通过 | 按现有规则解析 |
| `model-gateway` 配置非法 | 存在（禁止） | grammar 非法 | 阻止 ready | 不发布可用模型 |

`credentialRef` 缺失本身仍表示 no-credential，不把 provider 判为未配置；只有 `baseUrl` 缺失触发 `MODEL_PROVIDER_NOT_CONFIGURED`。

对无 viable 模型的处理：
- 若原因是 `openai-compatible` 缺 `baseUrl`，`APP_CONFIG_NO_VIABLE_MODEL` 不再阻止 ready。
- 对每个未配置父项产生 `APP_CONFIG_MODEL_PROVIDER_NOT_CONFIGURED` warning（`affectsReadiness=false`），`DefaultSystemConfig.configEvaluation.readinessState` 因此为 `DEGRADED_READY`。
- `modelProfiles` 保持父项和子项，Agent assembly 仍可引用这些 `modelId`。
- 若配置完全没有 `modelProfiles`，仍按现有 schema/配置错误处理，不纳入本降级语义。

**2. 模型目录：新增静态不可用原因**

- 在 `ModelUnavailableReason` 和 `ModelCatalogEntrySchema` 中新增 `MODEL_PROVIDER_NOT_CONFIGURED`。
- `ModelCatalogSource` 增加最小静态不可用能力，或等价地在 `configured-model-runtime.ts` 对未配置父项生成 `UNAVAILABLE` catalog source。
- 未配置条目不提供 `ResolvedModelConfiguration`，不触发 provider model-information 查询，不影响其他条目。
- 模型选择命中未配置条目时返回不可用；调用请求收到安全 model-unavailable failure，不尝试 fallback 或默认 endpoint。

**3. 出厂默认配置**

`packages/agent-app/config/default-system.yaml` 移除 `openai-compatible` 父项的 `baseUrl` 和 `credentialRef` 字段；保留 `providerId`、`models`、子项 `modelId: env:OPENAI_MODEL_NAME` 和推理参数。`OPENAI_MODEL_NAME` 是可选覆盖；当 provider 未配置且该变量缺失时，配置解析使用安全占位模型名 `default-model`，避免 Agent assembly 因未解析 env reference 阻止启动。本地无 overlay 启动结果为：
- 服务启动成功；
- readiness 为 `DEGRADED_READY`；
- 诊断提示模型 provider 未配置；
- 相关模型目录项为 `UNAVAILABLE`；
- 模型调用安全失败。

**4. 代码清理**

- 删除 `env.ts` 的死代码 `credentialEnvNames`。
- `testing.ts` 移除 `OPENAI_BASE_URL` 读取与 baseUrl override；`OPENAI_MODEL_NAME` override 保留。需要真实 provider 的测试改为显式 fixture/overlay 配置 `baseUrl` 与 `credentialRef`。
- `local-runtime-package/index.ts` 移除 `baseUrl: 'env:OPENAI_BASE_URL'` 注入，直接镜像源配置；`modelId: 'env:OPENAI_MODEL_NAME'` 保留。
- `configured-model-runtime.ts` 只需为未配置父项生成静态 `UNAVAILABLE` catalog source；provider invocation registry 可继续按 `providerId` 注册，未配置模型不会产生成功调用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `全局模型目录提供安全模型配置` | 未配置模型保留在目录中为 `UNAVAILABLE`；服务 `DEGRADED_READY`；模型调用安全失败 | 本地无 overlay 启动成功、目录不可用、调用不落 fake provider |
| 可维护性 | `Agent App system config 使用 canonical model/provider 配置` | 出厂配置与代码不再硬编码 `OPENAI_API_KEY`/`OPENAI_BASE_URL` | source-level 断言产品路径无残留引用 |

## 跨 Function 协作与端到端流程

启动时 app configuration validation 将未配置父项转为 warning evidence；agent assembly 继续从 `systemConfig.modelProfiles` 读取模型引用；configured model runtime 为这些模型生成 `UNAVAILABLE` 目录项。请求执行时模型选择观察到 `UNAVAILABLE` 并返回安全失败，runtime 不启动 provider execution。

## 验证策略（Verification Strategy）

- **contract/unit**：配置校验三态行为——未配置（缺 `baseUrl`）为 warning + `DEGRADED_READY`；配置非法（非法 URL/credential grammar）为 blocked；已配置为通过。断言 readiness、issue code、evidence 和 profiles 保留，不断言私有实现细节。
- **contract**：无 overlay 的内置默认配置启动成功且 `DEGRADED_READY`；相关目录项 `UNAVAILABLE` 且 reason 为 `MODEL_PROVIDER_NOT_CONFIGURED`；模型调用返回安全 model-unavailable failure。
- **contract**：混合配置中未配置 `openai-compatible` 不影响 viable `model-gateway` profile 进入目录并可调用。
- **architecture/negative**：产品代码不硬编码 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 作为配置生成或 override 来源；断言范围排除测试 fixture、迁移脚本和文档。
- **local-runtime-package contract**：随包配置未注入接入参数时启动成功、进入 `DEGRADED_READY`、模型调用安全失败。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：修改（`全局模型目录提供安全模型配置`、`Agent App system config 使用 canonical model/provider 配置`）
- `openspec/specs/local-runtime-package/spec.md`：修改（`Local runtime package is a user-runnable platform artifact` Scenario）
- `openspec/designs/architecture/local-runtime-packaging.md`：更新用户配置面与未配置模型启动行为
- `openspec/designs/architecture/configuration-boundary.md`：如引用出厂默认 env 绑定则更新
- 其他长期基线：无

## 风险与取舍（Risks / Trade-offs）

- **BREAKING 迁移影响**：依赖出厂默认读取 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 的部署在未迁移 overlay 前模型不可用，但服务仍可启动并得到明确降级诊断。
- **可用性语义变化**：`DEGRADED_READY` 表示应用可服务，但不承诺模型可用；调用方必须消费安全失败而不是假设启动成功即可推理。
- **契约扩展**：新增 `ModelUnavailableReason` 枚举值是公共 catalog contract 变化，需要 schema/contract 测试同步。

- **并行 change 冲突**：`Agent App system config 使用 canonical model/provider 配置` Requirement 同时被 `add-configurable-implicit-reasoning-start` 和 `raise-default-model-timeout-300s` 修改。本 change 的 MODIFIED delta 已合并这两个 change 的目标态（`reasoningTextMode` optional field 与 `timeoutMs=300000`），但归档顺序仍需协调：若其他 change 后归档，其 delta 必须反向合并本 change 的 `baseUrl` optional、`MODEL_PROVIDER_NOT_CONFIGURED` 和 env 名清理语义，否则会覆盖丢失。

## 待确认问题（Open Questions）

无。本地未配置模型时启动成功并进入 `DEGRADED_READY` 已由需求方确认。
