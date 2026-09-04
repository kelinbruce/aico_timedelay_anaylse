## 背景与问题（Why）

`SecretReference` 已由 `agent-common` 冻结为 `env:` / `file:` 引用，当前 `agent-app` 也已经拥有配置读取、引用语法校验、`createAppCredentialResolver` 和 resolver 注入路径。但现有产品路径尚未统一保证 active credential reference 在 ready 前可解析，也未完整覆盖跨日志、trace、audit、metric、safe error 和 readiness 输出的泄漏负向验证。

本 change 基于现有路径补齐启动期 secret 校验与安全输出边界，避免 secret 问题延迟到首个请求才暴露，同时不创建第二套 readiness、配置 snapshot 或跨 package secret contract。

## 变更范围（What Changes）

- 在 `agent-app` 启动配置校验阶段识别 credential-bearing entries，并在 ready 前校验 active `SecretReference` 的语法与可解析性。
- 固定唯一 resolver 路径：`agent-app` 创建并注入同一个 resolver；启动校验使用该 resolver 验证 active reference，下游 adapter 继续通过注入 resolver 按需读取。
- 产出 app-internal secret validation contribution，由 `add-ts-app-config-schema` 汇总进 `DefaultSystemConfig.configEvaluation` 的 safe diagnostics，并由 `agent-app` 生成唯一 `ConfigValidationEvidence` 安全投影。
- 补齐 secret-safe diagnostics 与禁止泄漏的负向验证。
- 不新增 `SecretReadinessState`、`SecretUsageSnapshot`、公共 secret DTO 或第二条下游配置消费路径。

## Capability 影响（Capabilities）

### 新增 Capability

- `secret-configuration-boundary`：定义 active secret reference 的启动期可解析性校验、resolver 注入边界和 secret-safe 输出约束。

### 相邻 Capability 消费关系

- `app-configuration`：拥有最终 readiness、criticality、viable set 判定和安全配置 evidence 汇总。
- `model-provider-configuration`、`gateway-configuration`、`capability-provider-configuration`、local auth assembly：各自拥有 credential-bearing entry 及其窄投影；credential-consuming adapter 只通过 `agent-app` 注入的 resolver 解析窄投影中的 reference，不消费共享 secret snapshot。
- `redaction-policy` 与 observability changes：消费本 change 的禁止泄漏约束，不拥有配置读取、secret 校验或 readiness。

## 影响范围（Impact）

- 主要 owner：`agent-app`
- 主要写入模块：`packages/agent-app/src/config`、`packages/agent-app/src/composition`
- 必要接入模块：已有 resolver consumer 与相关测试；不改变其业务语义或公共契约
- 冻结契约：复用 `agent-common.SecretReference`，不修改 `agent-contracts`

## 非目标

- 不定义新 secret grammar、secret manager、加密 envelope 或密钥轮换。
- 不改变 provider SDK、gateway driver、capability provider 或 local auth 的业务协议。
- 不新增跨 package secret artifact、公共 resolver port 或 operator-facing secret snapshot。
- 不重新定义 app-config readiness、criticality、degradation 或 viable set。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：

- `openspec/specs/secret-configuration-boundary/spec.md`

设计视图：

- `openspec/designs/architecture/configuration-boundary.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/modules/agent-observability.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：

- bootstrap/config validator tests
- composition resolver injection tests
- secret-safe output negative tests
- architecture tests for forbidden source-config reads and secret snapshot exports
