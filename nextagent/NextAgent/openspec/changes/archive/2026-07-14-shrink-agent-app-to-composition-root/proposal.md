## 背景与问题（Why）

`agent-app` 是 NextAgent TS 后端唯一 composition root，但当前实现和规划中已经混入了 memory extraction、workflow LLM prompt/model 适配、observability event shaping、health/readiness 业务判断、推荐问题服务等业务逻辑。这些逻辑超出了 composition root 的职责边界，使 `agent-app` 逐步变成跨模块业务实现聚合包。

这种膨胀会削弱现有架构不变量：业务 owner 难以维护自己的策略，新增 provider/capability/workflow/memory 行为时容易继续修改 `agent-app`，测试也会被迫通过 app composition 覆盖本应属于 owner package 的黑盒行为。现在需要把边界收紧为三个职责：配置加载、依赖注入、服务启动。

## 变更范围（What Changes）

- 收紧 `agent-app` 的目标职责：
  - 配置加载：读取、校验、冻结 app/system/Agent package 输入，产出 typed config、registry、assembly snapshot 和 safe diagnostic evidence。
  - 依赖注入：调用 owner package 的 public factory，把 frozen config projection、ports、registries、clock/logger、model/capability/gateway 等窄依赖注入进去。
  - 服务启动：注册 server/channel/health/ready gate，启动和停止 owner package 返回的 lifecycle handles、scheduler、worker、job。
- 明确 `agent-app` MUST NOT 实现 memory/workflow/context/model/capability/gateway/observability/session/channel 的业务策略、runtime path 行为或 domain output parsing。
- 将已在 `agent-app` 中出现的业务逻辑按 owner 边界迁出或替换为 owner package public factory：
  - memory extraction LLM strategy、candidate parsing、aging/revival 策略归 `agent-memory`。
  - workflow prompt/model/capability runtime adapter 归 `agent-workflow` 或 workflow-owned adapter。
  - runtime log 到 observation 的 shaping/mapping 归 `agent-observability`。
  - capability tool/provider business composition 和 sandbox/tool request preparation 归 `agent-capability`。
  - context summary/prompt/model selection helper 归 `agent-context-engine` 或 context-owned adapter。
  - model/gateway/capability health probe 业务检查归对应 owner package probe factory，`agent-app` 只组装 `HealthEvaluator`。
  - suggested/frequent question generation、prompt/output parsing、category question catalog、pin/high-frequency merge 和 association 排序归 `agent-session` 的 conversation-derived assist service；`agent-app` 只注入 `SuggestedQuestionPort` / `FrequentQuestionPort` 实现。
- 保留 `agent-app` 对 app-owned configuration、Agent package assembly/source selection、explicit plugin startup loading、product entrypoint/profile selection、server startup/shutdown 的 ownership，但这些路径不得夹带 request-time 或 domain policy。
- 不改变 public Web API、runtime command、stream event、gateway schema、model invocation contract、capability invocation contract 或 request lifecycle。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-backend-architecture`: 收紧 `agent-app` composition root 的职责边界，新增三职责和禁止项要求。

## 影响范围（Impact）

- 代码影响：
  - `packages/agent-app`: 收缩 composition 代码，仅保留 config、entrypoints、wiring、startup/shutdown、packaging/release 相关逻辑。
  - `packages/agent-memory`: 接收 memory extraction/aging/revival 相关策略 factory。
  - `packages/agent-workflow`: 接收 workflow LLM prompt/model/capability runtime adapter。
  - `packages/agent-observability`: 接收 runtime log/observation mapping factory。
  - `packages/agent-context-engine`: 接收 summary/prompt/model helper 或暴露 context-owned composition adapter。
  - `packages/agent-capability`: 接收 capability/tool/provider business composition 和 sandbox/tool request preparation。
  - `packages/agent-session`: 承接 `SuggestedQuestionPort`、`FrequentQuestionPort` 实现和分类问题 read model / helper；不新增或修改 `agent-contracts`。`agent-session` 只拥有 conversation-derived assist semantics，不拥有 Web route、runtime lifecycle、model provider implementation、capability lifecycle、context assembly 或 app config/resource loading。
  - `packages/agent-capability` public export surface: 移除当前 category question helper exports（如 `CategoryQuestionResourceDiscovery`、`computeQuestionHash`、`normalizeLocale` 及其相关 category question model/discovery types），避免 `agent-capability` 继续成为 question catalog semantics owner。
  - model/gateway/capability owning packages: 暴露当前 health probes 所需的窄 structural probe factory；`agent-observability` 继续拥有 `HealthEvaluator`，owner package 不依赖 `agent-observability` implementation。
  - 跨 owner 依赖影响：目标 owner package 只允许依赖自身实现、`agent-common`、owning `agent-contracts/*` subpath、必要第三方库或本包内定义的 structural callback/port。需要复用其它 implementation package 能力时，由 `agent-app` 在 composition 边界做 adapter，不在目标 owner 中 import 其它 implementation package。
- 测试影响：
  - 增加 owner package unit/contract tests。
  - 增加 app composition characterization tests，保证迁移前后 startup、availability、safe diagnostics 和 lifecycle handle 行为不变。
  - 增加 architecture/dependency tests，防止 owner package 反向依赖 `agent-app`，并防止 `agent-app` 再次承载业务算法。
- 运维影响：
  - 不改变配置文件、启动命令、端口、运行包 profile 或外部部署方式。
  - 启动日志、health/readiness 和 safe diagnostics 的用户可见语义保持兼容。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-backend-architecture/spec.md`: 更新 `agent-app` composition root 职责边界，加入配置加载、依赖注入、服务启动三职责和禁止项。

长期背景：
- `openspec/overview.md`: 无。

设计视图：
- `openspec/designs/architecture/ts-backend-architecture.md`: 更新 package responsibility 和 composition root 架构不变量。
- `openspec/designs/modules/agent-app.md`: 更新职责、非职责、核心设计落点和验证关注点。
- `openspec/designs/modules/agent-memory.md`: 若 memory strategy factory 迁入，补充相应 module 设计落点。
- `openspec/designs/modules/agent-workflow.md`: 若 workflow adapter 迁入，补充相应 module 设计落点。
- `openspec/designs/modules/agent-observability.md`: 若 observation mapping factory 迁入，补充相应 module 设计落点。
- `openspec/designs/modules/agent-context-engine.md`: 若 context adapter 迁入，补充相应 module 设计落点。
- `openspec/designs/modules/agent-capability.md`: 若 capability composition factory 迁入，补充相应 module 设计落点。
- `openspec/designs/modules/agent-session.md`: 补充 conversation-derived assist service ownership，包括 suggested/frequent question factory、question catalog helper 和外部依赖注入边界。
- `openspec/designs/adr/<id>.md`: 无。
- `openspec/designs/spec-to-design-map.md`: 更新 `ts-backend-architecture` 到 module design 的导航说明。

验证入口：
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
