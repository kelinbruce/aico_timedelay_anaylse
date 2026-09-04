## 1. Spec

- [x] 1.1 新增 `app-config-schema` spec，固定 startup-only 的配置校验与冻结触发机制。
  来源：spec requirement "App composition configuration is validated and frozen before ready state"；design 1
- [x] 1.2 明确 framework/runtime config、app composition config、Agent package config 的 ownership 分层。
  来源：spec requirement "Configuration ownership stays split across framework, app composition, and Agent package layers"；design 2
- [x] 1.3 明确首版稳定配置组：`deployment`、`paths`、`identity`、`channel`、`hostedAgent`、`modelProfiles`、`capabilityProviders`、`gateway`。
  来源：spec requirement "App composition schema exposes a stable first-release group baseline"；design 3
- [x] 1.4 明确 app-internal 配置对象收敛策略：`RawDefaultSystemConfig` 只作为源配置输入，`DefaultSystemConfig` 作为启动期验证后的唯一完整配置事实，health/release 只消费最小安全投影 `ConfigValidationEvidence`；并明确本 change 不新增 `agent-contracts/configuration`。
  来源：spec requirement "Configuration artifacts have explicit safe shapes and lifecycle semantics"；design 6
- [x] 1.5 明确 safe config error、blocked、degraded-ready 和显式 diagnostics 边界。
  来源：spec requirement "Safe configuration failures and diagnostics are explicit"；design 8

## 2. Design

- [x] 2.1 写清 ready 前同步校验、active/inactive branch 判定和 freeze-before-ready 的固定顺序。
  来源：spec requirement "Validation follows a deterministic rule order"；design 1
- [x] 2.2 写清 active critical branch、inactive branch、disabled entry、non-critical active entry 的不同处理规则。
  来源：spec requirement "Degradation and blocking rules are explicit and fail-closed"；design 4
- [x] 2.2a 固定 criticality 来源：由对应配置组 owning schema 明确定义，不允许 validator 临时猜测；固定本 change 拥有的 mandatory top-level group 最小 shape。
  来源：spec requirement "Validation follows a deterministic rule order"；design 3、4
- [x] 2.3 写清 app configuration 与 Agent assembly、model profile、capability provider、gateway selection、health/readiness、release qualification 的接入关系。
  来源：spec requirement "Configuration flow integrates with downstream composition and release gates"；design 7
- [x] 2.4 写清哪些行为明确不在范围内：runtime hot reload、请求期重读配置、用户可见消息、副作用写路径。
  来源：spec requirement "App composition configuration is restart-scoped, not hot-reloaded implicitly"；design 5

## 3. Implementation

- [x] 3.1 基于现有 `packages/agent-app/src/config/component-config.ts`、`validation.ts` 和 `system-config.ts` 扩展首版稳定配置组、active/inactive branch 校验、safe issue 和 readiness 判定；不创建第二套 loader/validator。
  验证：配置单元测试覆盖完整、降级和阻断路径；`npm run build`。
  来源：spec requirements "App composition schema exposes a stable first-release group baseline"、"Validation follows a deterministic rule order"
- [x] 3.2 在 `agent-app` 内实现 restart-scoped validated configuration state，并在 app composition/ready publication 前完成；完整 `DefaultSystemConfig` 不从 `agent-contracts` 导出。
  验证：bootstrap integration test 断言 ready 前已冻结 validated config，architecture/contract negative test 断言下游 package 不接收完整 `DefaultSystemConfig` 或读取源配置。
  来源：spec requirements "App composition configuration is validated and frozen before ready state"、"Successful validation produces immutable configuration artifacts"
- [x] 3.3 按唯一映射派生并接入下游：Agent assembly -> `AgentAssemblyRegistry`；model -> 由 `DefaultSystemConfig.modelProfiles` 构造的 restart-scoped `ModelProfileRegistry`；gateway -> app-composed gateway port；capability -> capability catalog/provider registry；`agent-app` readiness publisher/release input builder -> `ConfigValidationEvidence`；实际 candidate startup 仅向 package/E2E handoff 暴露 opaque `configValidationEvidenceRef`，release input builder 负责解引用。
  验证：composition integration tests；source/architecture assertion 断言不存在 public catch-all config object、替代投影、health/release 重复 config evidence shape，且 package/E2E/qualification 不解析或复制 `ConfigValidationEvidence`。
  来源：spec requirement "Configuration flow integrates with downstream composition and release gates"

## 4. Validation

- [x] 4.1 覆盖正常路径：本地 deployment 使用完整 active branch，系统进入 `READY` 并产出冻结快照。
  来源：spec requirement scenario "Local startup reaches READY with one viable active path"；design 场景 1
- [x] 4.2 覆盖边界路径：存在 inactive remote branch 或 disabled entry，但当前 active branch 仍可成立。
  来源：spec requirement scenario "Inactive branch failure remains non-blocking"；design 场景 4
- [x] 4.3 覆盖失败路径：缺少 mandatory group、ownership 越界、无 viable enabled model profile、active secret reference 不可解析时进入 `BLOCKED`。
  来源：spec requirement scenario "The only viable active model path fails and blocks startup"；design 场景 3
- [x] 4.4 覆盖降级路径：schema 明确定义的 non-critical active entry 被剔除但剩余 viable set 成立，系统进入 `DEGRADED_READY` 并保留 safe diagnostics。
  来源：spec requirement scenario "Invalid fallback-only active entry yields DEGRADED_READY"；design 场景 2
- [x] 4.5 覆盖安全路径：所有 config diagnostics、readiness outputs 和 safe errors 均不暴露 raw secret、raw path 或 framework-native exception。
  来源：spec requirement scenario "Invalid active secret reference blocks startup safely"；design 5
- [x] 4.6 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-app-config-schema --strict`。
  来源：AGENTS.md 验证门禁
