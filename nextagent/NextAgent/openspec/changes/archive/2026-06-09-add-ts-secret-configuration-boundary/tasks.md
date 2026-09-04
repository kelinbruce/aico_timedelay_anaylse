## 1. Spec And Design

- [x] 1.1 固定唯一边界：`agent-app` 主责；app-config 独占最终 readiness、criticality 和 viable set；本 change 不新增跨 package secret artifact 或 `agent-contracts` contract。
  来源：spec requirements "Owning schemas define secret validation scope"、"Secret validation output stays app-internal and narrow"
- [x] 1.2 固定唯一 resolver 路径：一个 app-composed resolver 同时用于 ready 前 active-reference 校验和 adapter/provider 注入。
  来源：spec requirement "One app-composed resolver serves validation and runtime injection"
- [x] 1.3 固定 secret-safe 输出限制，禁止完整 reference、路径、raw value 和 native error 进入可见输出。
  来源：spec requirement "Secret-derived outputs never expose secret material or reference paths"

## 2. Implementation

- [x] 2.1 基于现有 `packages/agent-app/src/config/validation.ts` 与 owning schema 输入，增加 app-internal credential validation input 和 safe issue contribution；不创建第二套 loader、validator、readiness enum 或 secret snapshot。
  验证：unit tests 覆盖 required/active/inactive、grammar 和 safe issue shape；`npm run build`。
  来源：spec requirements "Owning schemas define secret validation scope"、"Secret validation output stays app-internal and narrow"
- [x] 2.2 扩展现有 `packages/agent-app/src/config/env.ts` resolver，使 active `env:` / `file:` reference 可解析性失败统一映射为不含值、完整 reference、路径或 native error 的安全失败。
  验证：resolver unit tests 覆盖 missing、empty、unreadable、unsupported 和 unsafe native error。
  来源：spec requirements "Active references are resolvable before startup completes"、"Secret-derived outputs never expose secret material or reference paths"
- [x] 2.3 在现有 `packages/agent-app/src/config/system-config.ts` 和 app-config validation 汇总路径中，于 ready 前校验 active references，并将 safe issue contribution 合并进 `DefaultSystemConfig.configEvaluation` 的 safe diagnostics；最终 readiness 由 app-config 判定。
  验证：bootstrap/app-config integration tests 覆盖 success、blocked/degraded contribution 和 inactive branch。
  来源：spec requirements "Active secret references are validated before ready"、"Owning schemas define secret validation scope"
- [x] 2.4 保留并收紧 `packages/agent-app/src/composition/create-app.ts` 的 resolver 注入路径，确保启动校验与 credential consumer 注入复用同一 resolver 实例；不得新增第二 resolver 或下游源配置读取。
  验证：composition integration test 断言 resolver identity 和调用路径；architecture negative test 断言不存在 alternative resolver/source-config read。
  来源：spec requirement "One app-composed resolver serves validation and runtime injection"
- [x] 2.5 将当前 model `credentialRef` 产品路径接入上述验证；gateway、capability provider 和 local auth 的产品接入由各自 owning change 使用同一规则实施，本 change 不添加占位实现或公共契约。
  验证：现有 model composition/provider tests。
  来源：spec requirements "Product credentials use the frozen SecretReference grammar"、"Secret validation output stays app-internal and narrow"

## 3. Safety And Architecture Validation

- [x] 3.1 增加负向测试，断言 config diagnostics、readiness、release evidence、log、trace、metric、audit、safe error 和 stream 不包含 raw secret、完整 reference、文件路径、文件内容、环境变量值或 native error。
  来源：spec requirement "Secret-derived outputs never expose secret material or reference paths"
- [x] 3.2 增加 architecture/contract negative test，禁止 `SecretUsageSnapshot`、`SecretReadinessState`、共享 `SecretValidationResult`、公共 secret snapshot export、第二 resolver 路径和下游源配置读取。
  来源：spec requirements "One app-composed resolver serves validation and runtime injection"、"Secret validation output stays app-internal and narrow"
- [x] 3.3 增加 transient-value 验证，断言 resolved secret 不进入冻结配置、共享缓存、持久化或模型上下文。
  来源：spec requirement "Resolved secrets remain transient"

## 4. Validation

- [x] 4.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
- [x] 4.2 运行 `openspec validate add-ts-secret-configuration-boundary --strict` 与 `openspec validate --all --strict`。
