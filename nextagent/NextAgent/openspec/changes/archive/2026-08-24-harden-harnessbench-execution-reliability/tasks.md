## 1. FN-10.13 HarnessBench 评测

- [x] 1.1 增加 candidate 模型调用预算回归测试

  来源：候选模型调用与任务执行采用分层预算 — Scenario: 长模型调用在任务总预算内继续执行 / design §唯一实现方案
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/execution-reliability.test.ts` — 测试先因缺少可测试配置构造边界失败
  验证结果（2026-08-13）：首次运行 2 项均按预期失败，分别报告 `buildHarnessCandidateConfig is not a function` 与 `buildHarnessTaskEnvironment is not a function`。

- [x] 1.2 抽取并复用隔离 candidate 配置构造函数

  来源：候选模型调用与任务执行采用分层预算 / design §唯一实现方案
  验证：同一命令通过，且断言 `timeoutMs=300000`、adapter `timeout_sec=600` 与 terminal `--timeout-ms=600000`
  验证结果（2026-08-13）：定向测试通过；断言三层配置值分别为 `300000`、`600` 和 `600000`。

- [x] 1.3 增加本机 mock endpoint 环境覆盖回归测试

  来源：本机 mock endpoint 不依赖公网 tunnel — Scenario: 外部模板不得重定向标准评测 / design §唯一实现方案
  验证：同一命令在调用者环境预设外部模板时仍断言 `{local_url}`
  验证结果（2026-08-13）：预设 `https://external.invalid/{local_url}` 后，最终子进程环境仍为 `{local_url}`。

- [x] 1.4 抽取并复用 HarnessBench task 环境构造函数

  来源：本机 mock endpoint 不依赖公网 tunnel / design §唯一实现方案
  验证：同一命令通过，且标准执行路径使用受测构造函数
  验证结果（2026-08-13）：`runEvaluation` 复用受测的最终 task 环境构造函数，`runHarnessTask` 只附加当前 harness config 路径；定向测试 2/2 通过。

## 2. Change 整体验证

- [x] 2.1 新 change 严格校验

  验证：`openspec validate harden-harnessbench-execution-reliability --strict` — PASS
  验证结果（2026-08-13）：PASS。

- [x] 2.2 scoring change 语义元数据与全量 OpenSpec 校验

  验证：`openspec validate refine-harnessbench-scoring-denominator --strict` 与 `openspec validate --all --strict` — PASS
  验证结果（2026-08-13）：两个 change 严格校验通过；全量 260 项通过，0 项失败。

- [x] 2.3 HarnessBench 全量契约测试

  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` — 0 failed
  验证结果（2026-08-13）：9 个文件、38 项测试通过，0 项失败。

- [x] 2.4 运行提交范围语义检视

  验证：`nextagent-skill-review` 与 `nextagent-code-review` 均无 P0/P1/P2 阻断问题
  验证结果（2026-08-13）：按两项 skill 完成语义检视；修正预算边界表述、同步 `.d.mts` 声明并移除单次使用环境 helper 后，结论为 PASS，无剩余 P0/P1/P2 finding。
