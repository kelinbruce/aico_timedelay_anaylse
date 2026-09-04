## 1. Spec

- [x] 1.1 新增 `model-provider-configuration` spec，固定 `modelProfiles[]` 字段和启动期冻结语义。
  来源：spec requirement "Model provider profiles are loaded and stabilized during startup"；design 黑盒目标
- [x] 1.2 明确当前不改 `agent-contracts` 时产品 enabled 配置只允许 `OPENAI` provider，多 provider 闭集扩展由后续 contract change 承接。
  来源：spec requirement "Supported provider kinds are a closed set"
- [x] 1.3 明确 `credentialRef` 只允许 `env:` 和 `file:`，并禁止 raw secret、`direct:`、`none` 进入产品配置。
  来源：spec requirement "Secret references are used instead of raw credentials"
- [x] 1.4 明确 fake/test provider 只用于测试和受控验证，不能进入产品配置。
  来源：spec requirement "Supported provider kinds are a closed set"

## 2. Design

- [x] 2.1 写清启动期读取、校验、冻结和 provider access selector 准备的固定顺序。
  来源：design 关键业务流程
- [x] 2.2 写清单一 `modelProfileRegistry` 的语义、内部 validated/enabled/fallback/route/evidence 索引，以及 selector 消费方。
  来源：spec requirement "Successful startup produces one stable runtime profile registry"；design 输入输出
- [x] 2.3 写清 fail-fast 与单 profile 剔除降级的边界，以及 evidence 要求。
  来源：spec requirement "Fail-fast and degrade-startup boundaries are explicit"；design 关键约束

## 3. Validation

- [x] 3.1 覆盖单 profile 正常启动样例。
  来源：spec requirement scenario "Startup reaches ready state"
- [x] 3.2 覆盖多 profile + fallbackEligible 样例。
  来源：spec requirement scenario "Startup reaches ready state"；design 典型用例
- [x] 3.3 覆盖 unsupported provider、duplicate `profileId`、缺失 secret reference、无 enabled profile 的失败样例。
  来源：spec requirement scenario "Unsupported provider kind is configured"；spec requirement "Validation follows deterministic rule order"；spec requirement scenario "All profiles are disabled"
- [x] 3.4 覆盖非关键 profile 被剔除但系统继续启动的降级样例。
  来源：spec requirement scenario "Secondary fallback profile is invalid"
## 4. TS 首版缺口补齐

- [x] 4.1 支持 `file:` credential reference 通过 app-composed resolver 受控读取，并保证缺失文件或空文件安全失败且不泄露路径；ready 前可解析性校验由 `add-ts-secret-configuration-boundary` 接入。
  来源：spec requirement scenario "File-backed secret reference"
- [x] 4.2 对 runtime profile registry、内部索引、provider access selector 输入、嵌套 `modelOptions` / `providerOptions` 和 validation evidence 执行递归冻结。
  来源：spec requirement "Successful startup produces one stable runtime profile registry"
- [x] 4.3 对 fallback-only profile 的非法 `credentialRef` 受控剔除输出脱敏 structured warning。
  来源：spec requirement "Fail-fast and degrade-startup boundaries are explicit"
- [x] 4.4 明确本 change 仅拥有 reference 语法校验和 fallback-only 非法语法剔除；active reference 的 ready 前可解析性校验与最终 readiness 由 `add-ts-secret-configuration-boundary` 和 `add-ts-app-config-schema` 接入。
  来源：spec requirement "Fail-fast and degrade-startup boundaries are explicit"

验证：2026-06-08 运行 `npm run build`、`npx vitest run tests/agent-kernel/config-assembly.test.ts`、`openspec validate add-ts-model-provider-configuration --strict`、`openspec validate add-ts-model-fallback-semantics --strict`、`git diff --check`；`tests/agent-kernel/config-assembly.test.ts` 覆盖 registry 递归冻结、file reference、fallback-only 剔除、脱敏 warning 和 provider option fail-closed；已移除 `ModelProfileRegistryState`，未保留产品路径未使用的平行 by-id registry artifact。
