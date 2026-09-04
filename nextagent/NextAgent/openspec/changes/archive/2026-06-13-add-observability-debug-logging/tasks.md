## 1. 配置模型与 frozen config

- [x] 1.1 在 `default-system.yaml`、config schema 和 frozen config 投影中新增 `observability.logging.redaction` 字段，取值仅允许 `normal|debug`，默认 `normal`，并允许 `application.yaml` overlay。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts tests/local-runtime-package.test.ts`
  来源：`app-config-schema` -> `App composition schema exposes a stable first-release group baseline`、`Built-in defaults and user application config compose into two frozen roots`；design 决策 1、决策 5
- [x] 1.2 为 `observability.logging.redaction` 增加负向校验，拒绝 `normal|debug` 之外的值，并固化“缺省即 normal 模式”的行为。
  验证：补充并运行 app config validation / config assembly tests，实际断言非法值启动失败、缺省值回落为 `normal`
  来源：`app-config-schema` -> `App composition schema exposes a stable first-release group baseline`；design 验证映射“默认 normal”

## 2. safe debug 日志投影

- [x] 2.1 在 `agent-app` 到 `agent-observability` 的组合边界中传递 frozen logging mode，并让 `StructuredLogProjector` 或其受控依赖区分 `normal/debug` 两档行为。
  验证：`npm test -- tests/agent-kernel/logging.test.ts`
  来源：`structured-logging` -> `Structured logs 必须从 observation 受控映射`；design 决策 3、决策 5
- [x] 2.2 实现 debug 模式下的 safe diagnostic allowlist 扩展，仅允许输出来自同一 `ObservabilityObservationEvent` 的 policy-approved safe 字段，不增加旁路 logger 或第二条 observation 流。
  验证：补充并运行 structured log projector tests，断言 debug 比 normal 多出 allowlisted safe 字段，且缺少这些字段时日志仍有效
  来源：`structured-logging` -> `Structured logs 必须从 observation 受控映射`；design 决策 4
- [x] 2.3 为 debug 模式增加负向安全验证，断言 redaction 仍然生效，raw prompt、raw provider body、stack、path、secret、credential、token 等内容不会因为 debug 模式进入日志。
  验证：`npm test -- tests/agent-kernel/redaction-policy.test.ts tests/agent-kernel/logging.test.ts`
  来源：`redaction-policy` -> `Redaction is enforced by the shared observation boundary`；design 决策 2

## 3. 回归验证与收尾

- [x] 3.1 运行与 observability/config 相关的目标回归，确认 normal/debug 行为、配置 overlay 和 redaction negative case 一致通过。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts tests/local-runtime-package.test.ts tests/agent-kernel/logging.test.ts tests/agent-kernel/redaction-policy.test.ts`
  来源：design 验证映射；proposal 影响范围中的配置、structured logging、redaction、local runtime package
- [x] 3.2 执行构建与规范校验，确认变更未破坏 workspace 构建和 OpenSpec 一致性。
  验证：`npm run build`、`openspec validate --all --strict`
  来源：proposal 影响范围；design 质量属性中的可维护性、可测试性

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/app-config-schema/spec.md`，提炼 `observability.logging.redaction=normal|debug` 的稳定配置契约。
- 同步 `openspec/specs/structured-logging/spec.md`，提炼 normal/debug 两档 structured log 行为。
- 同步 `openspec/specs/redaction-policy/spec.md`，提炼 debug 仍强制 redaction 的稳定约束。
- 按需更新 `openspec/designs/architecture/configuration-boundary.md` 和 `openspec/designs/architecture/observability-boundaries.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-observability.md` 和 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 logging mode 语义、redaction owner 或 config ownership。
