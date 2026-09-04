## 背景与问题（Why）

当前运行日志在默认 safe/redaction 策略下，只稳定输出 `safeReasonCode`、低基数字段和有界 `safeSummary`。这满足了安全边界，但在本地排障场景下，运维和开发人员经常只能看到“请求失败了”或“某个边界降级了”，难以快速定位失败发生的阶段、已知安全上下文和受控诊断线索。

现有系统没有“关闭 safe”或“关闭 redaction”的正式配置入口，而直接放开 raw exception、stack、provider body、路径或凭据相关内容会破坏当前 observability 和 redaction 基线。对于本地 runtime，真实需求不是关闭 redaction，而是在保持 redaction 的前提下，通过受控配置输出更多安全诊断字段，提升排障效率。

因此需要在 `default-system.yaml` / `application.yaml` 配置面中增加一个稳定的 observability logging redaction mode：默认使用 `normal`；显式设置为 `debug` 时，保持 redaction 不变，但允许 structured log 输出更多经过治理的 safe 诊断字段，服务本地排障。

## 变更范围（What Changes）

- 在系统配置中新增 `observability.logging.redaction` 配置字段，可选值为 `normal` 和 `debug`；默认使用 `normal`，未配置时保持当前 normal 行为。
- 规定 `observability.logging.redaction=debug` 的语义不是关闭 safe/redaction，而是进入 safe debug 模式：
  - 继续执行统一 redaction policy；
  - 继续禁止 raw prompt、raw model output、tool args/result、stack、path、secret、credential、token、provider raw body 等进入日志；
  - 在 structured log 中扩展可输出的安全诊断字段，用于本地排障。
- 明确 debug 模式下允许增强的诊断范围必须来自已有可信 observation / safe error / diagnostic snapshot，不得新增旁路 logger 或绕过 `ObservabilityProjectorHost`。
- 明确 `default-system.yaml` 作为内置默认配置源需要补充该字段默认值，用户 `application.yaml` 可作为 overlay 覆盖。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `app-config-schema`: 增加 `observability.logging.redaction` 配置字段、默认值、overlay 规则和安全配置约束。
- `structured-logging`: 增加 debug 模式下的 structured log 输出语义，明确 normal/debug 两档行为，以及 debug 只能增强 safe 诊断字段。
- `redaction-policy`: 明确 debug 模式不会关闭 redaction，所有 debug 日志仍必须经过统一 redaction policy。

## 影响范围（Impact）

- 配置与启动期校验：
  - `packages/agent-app/config/default-system.yaml`
  - `packages/agent-app/src/config/component-config.ts`
  - `packages/agent-app/src/config/validation.ts`
  - system config overlay / freeze 路径
- observability 行为：
  - `packages/agent-observability` 的 structured logging projector、safe diagnostic 组装和必要的 debug-aware 投影逻辑
  - `packages/agent-app` 中 app composition 对 frozen config 的消费
- 测试：
  - app config validation tests
  - structured logging / redaction tests
  - local runtime package / config assembly tests（如涉及默认配置样例）
- 运维与本地排障：
  - 本地运行日志在 debug 模式下将包含更多安全诊断字段，但不会包含 raw 敏感内容

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/app-config-schema/spec.md`：修改，补充 `observability.logging.redaction=normal|debug` 配置、默认值和 overlay 规则。
- `openspec/specs/structured-logging/spec.md`：修改，补充 normal/debug 两档 structured log 行为和 debug 模式下允许的安全诊断增强。
- `openspec/specs/redaction-policy/spec.md`：修改，补充 debug 模式仍强制 redaction 的约束。

长期背景：
- `openspec/overview.md`：无

设计视图：
- `openspec/designs/architecture/observability-boundaries.md`：修改，补充 debug 模式与 observability/redaction 边界的关系。
- `openspec/designs/architecture/configuration-boundary.md`：修改，补充 `observability.logging.redaction` 的配置归属和 overlay 语义。
- `openspec/designs/modules/agent-observability.md`：修改，补充 debug 模式下的 safe diagnostic 投影职责。
- `openspec/designs/modules/agent-app.md`：修改，补充 app composition 对该配置的消费职责。
- `openspec/designs/adr/<id>.md`：无
- `openspec/designs/spec-to-design-map.md`：修改，补充相关 spec 到 design 的导航。

验证入口：
- app config validation tests
- structured log projector tests
- redaction policy tests
- config assembly / local runtime package tests
