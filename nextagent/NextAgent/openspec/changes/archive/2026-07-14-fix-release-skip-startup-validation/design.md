## 背景和现状（Context）

本地运行包由 `scripts/pack-local-runtime.mjs` 在 workspace 构建后暂存依赖并归档。当前成功条件只覆盖 `dist` 根目录存在，无法识别嵌套 export 文件遗漏；`skip` 会跳过发布 E2E gate，但没有独立的归档后可运行性验证。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让 `pack:release -- skip` 失败关闭地拒绝缺少 runtime export 的候选包。
- 用解压后的候选根执行正式 `nextagent-self-check`，验证 package-relative ESM resolution。
- 保持 `skip` 只跳过耗时的发布 E2E gate。

**非目标：**

- 不运行完整 release qualification、产品旅程 E2E 或常驻 HTTP 服务。
- 不修改 `agent-dev-workbench` 的生产排除边界。
- 不引入新的归档依赖或运行时 package profile。

## 设计决策（Decisions）

1. `scripts/pack-local-runtime.mjs` 是唯一 owner。`stageWorkspacePackage` 复制 package 后递归解析其 `package.json.exports`；仅校验 string target 与条件对象中的 `import`/`require` target。每个 target 必须是包内相对文件并在暂存目录存在。其他 exports 条件不增加推断规则。
2. `createPackageArchive` 成功后使用当前 target 的系统归档工具解压到由 `mkdtempSync` 创建的临时目录，再以当前 Node 执行 `bin/nextagent-self-check`。验证脚本从解压根解析路径，因而能覆盖本次 package-relative ESM 缺失。
3. 验证无论 `skipReleaseGateVerification` 是否为 true 均执行。`skip` 只控制 `verifyReleaseE2EGate` 调用。
4. 验证目录在成功或失败后清理；错误仅包含候选包相对路径、package 名称和子进程安全摘要，不输出配置内容、绝对路径或原始 stack。

未选择“仅从源码 `dist` 检查”方案，因为它不能证明复制和归档后的内容；未选择启动 HTTP 服务，因为 self-check 已足以验证模块闭包，且无需端口、凭据或异步清理。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 只执行候选包自带 self-check，不读取或打印 secret/config 内容；错误使用相对路径。 | 单测断言错误摘要；代码审查。 |
| 性能/容量 | 每次 pack 增加一次本地解压与短生命周期 Node 进程，不增加常驻资源。 | `pack:release -- skip` 实测。 |
| 可靠性/恢复 | 暂存 export 和解压 self-check 任一失败均使 pack 失败；临时目录 finally 清理。 | 单测与真实打包。 |
| 可维护性 | 完整性和归档验证均归打包脚本 owner，复用现有 self-check。 | 打包边界测试。 |
| 可测试性 | 注入 runner/临时目录相关 helper，分别模拟缺失 export、解压和 self-check 失败。 | Vitest focused tests。 |
| 审计/可追溯性 | 命令日志保留候选 id 与安全失败原因，不产生业务审计事实。 | 打包输出检查。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| runtime export 必须进入暂存包 | 1 | `fullstack-packaging-boundary.test.ts` 缺失嵌套 export 测试 |
| `skip` 不跳过解压 self-check | 2 | 打包脚本 orchestration 测试 |
| 解压包可以解析运行时模块 | 3 | `npm run pack:release -- skip` 后的实际 self-check |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/local-runtime-package/spec.md`。
- 架构和跨模块设计：`openspec/designs/architecture/local-runtime-packaging.md`。
- 模块设计和 ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [归档工具的跨平台差异] -> 复用 `resolvePackageTarget` 的平台分支，并为 Windows/Linux 维持显式解压命令。
- [self-check 覆盖不是完整业务服务 smoke] -> 保留 release E2E gate；本 change 只保证 `skip` 不放过可解析性和包根启动前置条件。
- [输出文件被占用] -> 打包开始前的 staging 清理失败直接报错，不覆盖已有 artifact。

## 迁移计划（Migration Plan）

无数据迁移。重新执行打包会生成符合新门禁的 artifact；旧 artifact 必须重新打包，不视为可用候选包。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/local-runtime-package/spec.md`：提炼 export 完整性和 `skip` 解压 self-check 行为。
- `openspec/designs/architecture/local-runtime-packaging.md`：提炼候选包验证顺序与 `skip` 边界。
- `openspec/designs/spec-to-design-map.md`：加入 focused packaging tests 与 extracted self-check。

## 待确认问题（Open Questions）

无。
