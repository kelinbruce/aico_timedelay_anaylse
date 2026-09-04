---
sources:
  - AGENTS.md
  - package.json
  - frontend/agent-web/package.json
last-verified: 2026-09-01
---

# 验证门禁与验证命令

修改代码后必须通过的验证路径。没有可重复验证路径的任务不得视为完成。

## 后端验证命令

在仓库根目录运行：

| 命令 | 用途 | 何时必须通过 |
|---|---|---|
| `npm run build` | 编译检查 | 每次修改 |
| `npm test` | 完整测试套件 | 每次修改 |
| `npm run test:contract` | 契约测试 | 涉及 contract/port/Record 变更时 |
| `npm run lint:architecture` | 架构边界 lint | 涉及跨包依赖变更时 |
| `npm run test:smoke` | 冒烟测试 | 快速验证 |
| `npm run test:e2e:alpha` | Alpha 内核门禁 | 涉及 runtime lifecycle/concurrency/cancellation |
| `npm run test:e2e:release` | 完整 e2e release 门禁 | 发布前 |
| `npm run test:release` | 全量发布验证 (build+test+contract+release+lint) | 发布前 |

### Vitest 配置文件

| 配置 | 用途 |
|---|---|
| `vitest.config.ts` | 主测试配置 |
| `vitest.config.architecture.ts` | 架构边界测试 |
| `vitest.config.channel-web.ts` | Web Channel 测试 |
| `vitest.config.contract.ts` | 契约测试 |
| `vitest.config.release.ts` | 发布测试 |
| `vitest.config.smoke.ts` | 冒烟测试 |

## 前端验证命令

在 `frontend/agent-web/` 运行：

| 命令 | 用途 | 何时必须通过 |
|---|---|---|
| `npm run build` | TypeScript + Vite 构建 | 每次前端修改 |
| `npm test -- ...` | 前端单元测试 | 每次前端修改 |
| `npm run build:vite:modes` | 多宿主模式构建 | 涉及 artifact/宿主模式/静态托管 |
| `npm run test:e2e -- ...` | Playwright E2E | 涉及浏览器用户旅程 |

**注意**：只改文档时可按影响范围裁剪，但必须说明未运行项。

## OpenSpec 验证

```bash
openspec validate --all --strict
```

新增或修改 OpenSpec change 后必须运行。

## Push 前强制门禁

Push 代码前**必须**加载并使用仓内 `.agents/skills/nextagent-code-review/SKILL.md`（`$nextagent-code-review`）进行模型语义检视。

### 检视覆盖范围

1. Frozen core contract
2. Architecture boundary（含 frontend/browser ownership 和多宿主一致性）
3. Minimal kernel non-regression
4. Security
5. OpenSpec consistency
6. Clean Code
7. 受影响前端 build/test/e2e 证据

### 检视结论

| 结论 | 含义 | 行动 |
|---|---|---|
| PASS | 无问题 | 可以 push |
| PASS WITH FOLLOW-UP | P2 问题有明确 follow-up plan | 可以 push |
| BLOCKED | P0 或 P1 问题 | **禁止 push**，必须修复后重新检视 |

**禁止**：以静态扫描工具（ESLint、dependency-cruiser）或测试套件替代模型检视。

## 特定场景必须补的测试

| 修改范围 | 必须补的测试类型 |
|---|---|
| Runtime lifecycle | characterization/contract/architecture 测试 |
| Concurrency | 同上 |
| Cancellation | 同上 |
| Retry/edit | 同上 |
| Terminal commit | 同上 |
| Streaming | 同上 |
| Gateway persistence | 同上 |
| Sandbox | 同上 |
| Security | 同上 |
| Agent scope | 同上 |
| Owner scope | 同上 |

## 测试目录结构

```
tests/
├── architecture/     # 60+ 架构边界测试文件
│   # 强制包依赖规则、边界约束、日志安全、scope 隔离
├── contract/         # 50+ 契约测试文件
│   # 验证 port interface、schema conformance、gateway contract
├── e2e/
│   ├── alpha-kernel-gate/     # 最小内核门禁
│   ├── p1-p2-scenario-gate/  # P1/P2 联合场景门禁
│   ├── product-journey/      # 产品旅程测试
│   ├── release-package/      # 发布包验证
│   ├── security/             # 安全门禁
│   └── resilience/           # 可靠性门禁
├── agent-kernel/     # Agent 内核测试
├── capability-source-configuration/ # 能力源配置测试
├── fixtures/         # 测试 fixture
├── helpers/          # 测试 helper
├── harnessbench/     # HarnessBench 评测
├── smoke/            # 冒烟测试
└── manual/           # 手动测试脚本
```

## Commit 规范（建议但不强制）

- Conventional Commits：`type(scope): description`
- 单一职责：一个 commit 只做一件事
- Message 必须反映完整 scope
- 禁止模糊中文短消息（如"打包修改"、"部署配套修改"）
- 跨 3+ package 的 commit 必须有清晰 cross-cutting theme，否则应拆分

## Task 勾选标准

- 必须有实际验证命令、测试结果或明确 code review 检查点
- 不得只用"测试通过"概括完成
- 禁止项、边界逃逸、非法依赖等 negative case 必须被测试或命令实际触发并断言失败
- OpenSpec task 不得部分完成
- 编码前对照 proposal、design、spec、tasks，确认关键约束都有对应实现或明确延期说明
