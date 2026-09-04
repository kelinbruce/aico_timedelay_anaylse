## 1. Spec 和设计收敛

- [x] 1.1 补强 `local-runtime-package` spec，明确本地运行包 manifest 是 release candidate identity 的权威来源。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：Requirement: Local runtime package identifies the release candidate
- [x] 1.1a 补强 package manifest 最小 shape 和安全 ref 规则，覆盖 `candidateId`、`version`、`buildTime`、`entrypointRefs`、`configSampleRefs`、`layoutVersion`、`packageProfile`、`packageArchiveRef` 和 `evidenceRefs`，并禁止未脱敏绝对路径、临时构建路径、raw secret、provider payload、stack trace 或 adapter-private layout 泄漏。
  验证：package manifest contract tests 覆盖字段存在、`packageProfile` 枚举、safe ref 和 unsafe ref negative case；`with-frontend` 只作为 profile declaration 被保留，前端 artifact/hosting evidence 由 `fullstack-packaging-boundary` 覆盖。
  来源：Requirement: Local runtime package identifies the release candidate
- [x] 1.1b 补强 zip 交付 requirement，明确首版最终用户交付物是可分发 zip，zip 解压根目录即 candidate root；package validation、release/package E2E gate 和 release qualification 不得使用源码工作区、内部 staging 目录或开发 server 代替最终用户包。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：Requirement: Local runtime package is a user-runnable zip artifact
- [x] 1.2 补强运行包目录职责 requirement，固定 `bin/`、`config/`、`backend/`、`data/`、`logs/`、`run/`、`workspaces/`，禁止等价目录名或 manifest 自定义映射。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：Requirement: Local runtime package has a stable responsibility layout
- [x] 1.3 补强配置样例 requirement，明确配置样例必须满足 app configuration baseline 和 secret reference boundary。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：Requirement: Package configuration samples are startup-validatable
- [x] 1.3a 补强首版用户配置面 requirement，明确解压 zip 后首次启动只要求 Node.js runtime 和 `OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL` 三个环境变量；配置样例必须映射这些 env refs，缺失任一 env 时 fail closed，禁止回落 fake/test/no-op provider 或默认 endpoint。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：Requirement: Package configuration samples are startup-validatable
- [x] 1.4 补强 release qualification 接入 requirement，明确 package evidence 是 `harden-ts-local-runtime-release` 的 candidate 输入，不产生 verdict。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：Requirement: Package evidence feeds release qualification without replacing it
- [x] 1.4a 补强 mandatory package candidate evidence set，明确 manifest、layout check、`configValidationEvidenceRef`、startup proof 和 health/readiness proof 缺一则 candidate evidence handoff 无效；release smoke 不进入 package evidence；configuration-blocked candidate 无法产生 passed startup proof，但 package owner 不解引用 config evidence、不产生 release verdict。
  验证：release qualification candidate evidence tests 覆盖 mandatory evidence 缺失时 package handoff 被阻断且不输出 `QUALIFIED`、`QUALIFIED_WITH_DECLARED_DEGRADATIONS` 或 `BLOCKED`。
  来源：Requirement: Package evidence feeds release qualification without replacing it
- [x] 1.5 补强设计中的关键流程，明确 build candidate、manifest、layout check、config validation、release/package E2E 真实 startup/health evidence、release qualification handoff 和 stop cleanup 的顺序；release smoke 由 product-journey gate 独立拥有。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：design key flow

## 2. 运行包产物实现

- [x] 2.0 实现 zip package artifact 生成：以固定运行包目录为 zip 根目录，产出可分发 zip，并在 manifest 中记录安全的 `packageArchiveRef`；zip 解压目录必须能作为 candidate root 被 package validation 和 release/package E2E gate 使用。
  验证：zip artifact tests 解压产物并断言根目录包含 manifest、`bin/`、`config/`、`backend/`、`data/`、`logs/`、`run/`、`workspaces/`；package validation 从解压目录运行，不能从 staging/source workspace 读取缺失内容。
  来源：Requirement: Local runtime package is a user-runnable zip artifact
- [x] 2.1 实现本地运行包 manifest 生成，至少包含 candidate id、version、build time、entrypoint refs、config sample refs、layout version、package archive ref 和 evidence refs。
  验证：package manifest contract tests 断言字段存在、稳定、无 raw secret、无本地绝对路径泄漏。
  来源：Requirement: Local runtime package identifies the release candidate
- [x] 2.1a 实现 manifest ref 安全校验，确保 manifest refs 仅为 package-relative safe refs 或 opaque evidence refs。
  验证：package manifest negative tests 触发绝对路径、临时构建路径、adapter-private path、raw secret 和 provider payload fixture，并断言 safe validation failure。
  来源：Requirement: Local runtime package identifies the release candidate
- [x] 2.2 实现本地运行包 staging，生成固定 `bin/`、`config/`、`backend/`、`data/`、`logs/`、`run/`、`workspaces/` 目录和必要占位文件，且不把 adapter-private 路径暴露给上层模块。
  验证：package layout tests 断言目录职责、缺失目录失败、系统目录不被 workspace 默认指向。
  来源：Requirement: Local runtime package has a stable responsibility layout
- [x] 2.3 提供随包配置样例，并接入 startup configuration validation fixture；credential-bearing 字段只使用 grammar-valid、非敏感示例 `env:` / `file:` reference，禁止 reference 外占位。
  验证：startup config sample validation tests 覆盖 ready、degraded-ready、blocked、raw secret 和 `CHANGE_ME`/空值/`none` negative case。
  来源：Requirement: Package configuration samples are startup-validatable
- [x] 2.3a 将随包配置样例的 OpenAI provider credential、model name 和 base URL 映射到 `env:OPENAI_API_KEY`、`env:OPENAI_MODEL_NAME`、`env:OPENAI_BASE_URL`，并在启动 validation 中把缺失 env 判为 safe blocked configuration。
  验证：env configuration startup tests 覆盖三项 env 全部存在时进入 startup path、任一缺失时阻断、诊断不泄露 env value，且不会回退 fake/test/no-op provider 或默认 endpoint。
  来源：Requirement: Package configuration samples are startup-validatable
- [x] 2.4 实现本地单实例启动和停止入口，启动入口初始化必要目录并发布 health/readiness 可消费的启动证据。
  验证：local package startup/stop integration tests 覆盖首次启动、重复启动保护、正常停止和 `run/` 状态清理。
  来源：Requirement: Package entrypoints start and stop one local instance
- [x] 2.4b 实现可双击用户启动脚本及命令行等价启动方式；脚本必须从解压后的包根解析所有路径，不要求用户编辑 YAML，不依赖源码工作区、全局 npm workspace、开发 server、构建临时目录或启动时当前工作目录。
  验证：zip extraction double-click startup smoke tests 在临时解压目录中设置 `OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL` 后调用用户启动脚本并断言 health/readiness 可达；负向测试从不同当前工作目录启动仍使用包根路径，删除源码工作区引用后仍可运行。
  来源：Requirement: Local runtime package is a user-runnable zip artifact；Requirement: Package entrypoints start and stop one local instance
- [x] 2.4a 实现启动/停止负向路径处理，覆盖端口不可用、app artifact 缺失、startup configuration blocked、health/readiness proof 不可读、stale PID 和 stop 误杀保护。
  验证：startup/stop negative tests 断言失败只产生 safe startup proof failure；stale `run/` state 不被当作 active candidate；stop 只清理 `run/` 进程级状态且不删除 `config/`、`data/`、`logs/` 或 `workspaces/`。
  来源：Requirement: Package entrypoints start and stop one local instance
- [x] 2.5 明确 `with-frontend` profile 的 handoff：本 change 只输出 profile declaration 和基础 package evidence，不实现前端静态托管、route precedence、前端版本证据或 hosting manifest validation。
  验证：spec review / boundary check 确认这些 fullstack 细节只在 `refine-ts-fullstack-packaging-boundary` 中定义；`backend-only` package evidence 不依赖前端 artifact。
  来源：Requirement: Fullstack package profile is delegated to fullstack packaging boundary
- [x] 2.6 在唯一 owner `packages/agent-app/src/packaging/package-candidate-evidence.ts` 定义并实现 `PackageCandidateEvidence` TypeBox schema、TypeScript type、base evidence creation、execution evidence merge 和 handoff validation，并通过 `@nextagent/agent-app/packaging` public subpath 暴露；package validation 产出 manifest/layout base evidence，并接收 `add-ts-e2e-release-package-gate` 从实际 candidate 捕获的 `configValidationEvidenceRef` 与生成的 startup、health/readiness refs；不得复制 `ConfigValidationEvidence` shape 或合成真实执行成功证据。
  验证：candidate evidence contract tests 断言 pack、E2E gate 和 qualification 通过 public subpath 复用唯一 owner，不使用 private path、不复制 DTO/schema/validator；package validation 不生成虚假 startup/health 成功 refs；完整 evidence 可进入后续 qualification flow。
  来源：Requirement: Package evidence feeds release qualification without replacing it
- [x] 2.6a 将 manifest、layout check、`configValidationEvidenceRef`、startup proof 和 health/readiness proof 纳入 mandatory candidate evidence 校验；release smoke 由 product-journey gate 独立拥有；固定 ref 必须关联实际 candidate 且引用唯一 `ConfigValidationEvidence`，package validator 只校验 ref 存在与 candidate 关联。
  验证：candidate evidence contract tests 断言 mandatory evidence set 完整；缺少任一 mandatory ref、candidate 关联不一致、替代配置 evidence ref 或 configuration-blocked startup 无 passed startup proof 时 package evidence validation 阻断 handoff，且 package/E2E 不解引用 config evidence、不输出 release verdict。
  来源：Requirement: Package evidence feeds release qualification without replacing it

## 3. 安全和负向验证

- [x] 3.1 增加 secret negative tests，断言运行包配置样例或 manifest 中出现 raw secret、inline credential 或未允许 secret source 时失败。
  验证：secret/package safety tests 触发 raw secret fixture 并断言启动或 package validation 失败。
  来源：Requirement: Package configuration samples are startup-validatable
- [x] 3.2 增加 workspace boundary negative tests，断言 workspace 指向 `config/`、`data/`、`logs/`、`run/`、app artifact 目录或路径穿越时失败。
  验证：package layout negative tests 触发非法 workspace fixture 并断言 safe validation failure。
  来源：Requirement: Runtime directories remain separated by responsibility
- [x] 3.3 增加 diagnostics redaction tests，断言 package validation、startup proof 和 evidence refs 不输出 raw local path、raw credential、provider payload 或 stack trace。
  验证：diagnostic redaction tests 覆盖 package validation failure 和 startup failure。
  来源：Requirement: Package diagnostics are safe and non-authoritative
- [x] 3.4 增加 unsafe manifest ref negative tests，断言 manifest 中出现未脱敏绝对路径、临时构建路径、adapter-private path、raw secret、provider payload 或 stack trace 时 package validation 失败且 diagnostics safe。
  验证：package manifest safety tests 触发 unsafe ref fixtures 并断言 release qualification 不消费该 candidate。
  来源：Requirement: Local runtime package identifies the release candidate

## 4. 收尾验证

- [x] 4.1 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-local-runtime-package --strict`
  来源：全部 OpenSpec delta
- [x] 4.2 运行受影响的配置、启动、release qualification 和 package boundary 测试。
  验证：项目对应 package/layout/config/startup/release qualification test suites 全部通过；route precedence 测试由 `refine-ts-fullstack-packaging-boundary` 覆盖。
  来源：design verification map
- [x] 4.3 执行代码审查，确认本 change 没有重定义 app config schema、secret grammar、health/readiness 语义、release verdict、runtime lifecycle 或 gateway 业务语义。
  验证：code review 检查点；这些边界跨多个 owner，无法只靠单一单元测试覆盖。
  来源：design non-goals 和 boundary decisions

## 5. 平台产物分发补强

- [x] 5.1 补强 package manifest 和 pack flow，记录 `platform`、`arch`、`nodeVersion`，并按 OS/arch 输出 `nextagent-local-{datetime}-win32-x64.zip` 或 `nextagent-local-{datetime}-linux-x64.tar.gz`。
  验证：manifest contract tests 覆盖字段存在、支持平台、unsupported OS/arch fail closed；pack script tests 覆盖 Windows zip 和 Linux tar.gz 命名与压缩命令。
  来源：Requirement: Local runtime package is a user-runnable platform artifact

- [x] 5.2 完成不同 OS 下压缩与解压验证路径。
  验证：Windows 路径使用 PowerShell `Compress-Archive`/`Expand-Archive`，Linux 路径使用 `tar -czf`/`tar -xzf`；本机运行受影响测试和 OpenSpec strict validation。
  来源：Requirement: Local runtime package is a user-runnable platform artifact

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/local-runtime-package/spec.md`。
- 按需修改 `openspec/specs/local-runtime-release/spec.md`。
- 按需更新 `openspec/overview.md`。
- 新增或更新 `openspec/designs/architecture/local-runtime-packaging.md`。
- 按需更新 `openspec/designs/architecture/configuration-boundary.md`。
- 按需更新 `openspec/designs/modules/agent-app.md` 和 `openspec/designs/modules/agent-platform-gateway-local.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 app config schema、release verdict、runtime lifecycle、gateway adapter 语义或 fullstack 静态资源 route ownership。
