## 1. Gate 基础设施

- [x] 1.1 增加 `npm run test:e2e:release-package`，通过正式 package entrypoint 构建并启动隔离 candidate。
  验证：命令从 candidate root 启动，移除 workspace 源码后仍可执行。
  来源：spec requirement “Release package E2E 从实际候选产物执行”；design D1
- [x] 1.2 增加 candidate/profile/package/config/startup/health evidence report 和确定性清理；只捕获实际 candidate startup 产生的 opaque `configValidationEvidenceRef`，通过 `@nextagent/agent-app/release` mapper 生成 `HealthProof`，通过 `@nextagent/agent-app/packaging` 合并并校验 `PackageCandidateEvidence`；release smoke 不进入本报告。
  验证：report schema test；architecture/source assertion 断言 gate 不解析或复制 `ConfigValidationEvidence`、不复制 evidence DTO/schema/mapper/validator 且不使用 `agent-app` private path；执行后 candidate process 和临时目录均被清理。
  来源：spec requirement “Release package E2E 产出 qualification 可消费证据”
- [x] 1.3 将 release-package helper 限定为 candidate 生成/启动、HTTP/browser smoke、指定 public subpath evidence 组装和清理；不得复制 `pack()`、`qualify()`、health checker、配置 schema、evidence DTO/schema/mapper/validator 或 static hosting router。
  验证：code review 检查 helper 只调用正式 entrypoint、candidate 声明入口、`@nextagent/agent-app/release` 和 `@nextagent/agent-app/packaging`，不包含重复实现。

- [x] 1.4 维护唯一标准命令 `npm run test:e2e:release-package`，写出 machine-readable `ReleaseCheckResult`、权威 `PackageCandidateEvidence` 和 `HealthProof`；不定义 adapter API、generic payload、`outputRef` 或 release verdict。
  验证：command integration test 覆盖 passed、failed、timeout、报告缺失和 evidence mapping。
  来源：design D5

## 2. Release/Package E2E 用例

- [x] 2.1 实现 e2e-P0-19：非法 app/model/gateway/secret 配置 fail closed 且诊断安全；`ConfigReadinessState=BLOCKED` 的实际 candidate 不得完成 package evidence handoff。
  验证：`npm run test:e2e:release-package -- --grep e2e-P0-19`；断言 gate 保留实际 `configValidationEvidenceRef` 且不创建替代 config result。
  来源：spec scenario “非法配置阻断启动”
- [x] 2.2 实现 e2e-P0-20：health/readiness/metrics 在启动和就绪阶段状态正确。
  验证：`npm run test:e2e:release-package -- --grep e2e-P0-20`。
  来源：spec requirement “Release package E2E 验证启动、health 和 fullstack serving”
- [ ] 2.3 实现 e2e-P0-25：with-frontend 同一 server 提供前端/API/stream 且 route precedence 正确。
  验证：`npm run test:e2e:release-package -- --grep e2e-P0-25`。
  来源：spec scenario “Fullstack route precedence 正确”
- [ ] 2.4 实现 e2e-P0-26：candidate package 可安装启动，manifest/config/evidence 完整。
  验证：`npm run test:e2e:release-package -- --grep e2e-P0-26`。
  来源：spec scenario “实际候选产物通过”

## 3. Negative Gate 和收尾

- [x] 3.1 增加 workspace private path、dev server 和源码 fallback negative fixture，断言 gate 实际失败。
  验证：release-package gate negative test。
  来源：spec scenario “Workspace fallback 被拒绝”；design D4
- [x] 3.2 增加缺失 manifest/index、版本漂移、启动超时和静态 fallback 吞 API 的 negative fixture。
  验证：release-package gate negative test；每个失败原因有独立断言，允许共享 fixture harness 但不得只用一个综合坏包覆盖全部边界。
  来源：spec requirement “Release package E2E 验证启动、health 和 fullstack serving”；design D4
- [x] 3.3 运行本 change 和仓库门禁。
  验证：`npm run test:e2e:release-package`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-e2e-release-package-gate --strict`。
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/ts-e2e-release-package-gate/spec.md`。
- 更新 `openspec/designs/architecture/e2e-quality-gates.md`、`openspec/designs/modules/agent-app.md` 和 `openspec/designs/spec-to-design-map.md`。
