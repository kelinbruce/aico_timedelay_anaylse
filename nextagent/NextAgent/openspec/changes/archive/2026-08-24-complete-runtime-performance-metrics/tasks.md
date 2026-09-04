## 1. `FN-7.5 采集指标`

- [x] 1.1 为模型 terminal-only 次数、token 分布、output token rate、timeout 与 flow-control 建立目标行为测试。
  来源：`FN-7.5` + “模型性能指标必须按终态调用提供次数、分布和生成速率” + “异常指标必须使用唯一权威终态分类”。
  结果：先运行新增断言得到 6 failed / 22 passed，确认 started 重复计数和目标 metric 缺失；实现后 `npx vitest run packages/agent-observability/tests/metrics-registry.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts packages/agent-observability/tests/local-metric-history-exporter.test.ts` 为 3 files / 40 tests passed。

- [x] 1.2 为 request usage 完整聚合、终态次数、异常终止与缺失 usage 省略建立 mapper/projector 目标行为测试。
  来源：`FN-7.5` + “对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布”。
  结果：变更前新增 request aggregate/abnormal counter 断言失败；实现后上述 observability 定向命令 40 tests passed，并覆盖 duplicate terminal event 与 replay-without-accepted。

- [x] 1.3 为 execution-state transition 建立 runtime characterization，覆盖 normal enter/leave、pre-execution terminal、pending/resume 和 listener throw。
  来源：`FN-7.5` + “并发按每次执行态转换采样” + “未执行的终态 run 不伪造排队时间”。
  结果：变更前 listener 断言无 transition；实现后 `npx vitest run packages/agent-runtime/tests/cancel-terminal-content.test.ts packages/agent-runtime/tests/workflow-pending-resume-durable.test.ts packages/agent-runtime/tests/workflow-pending-input-timeout-resume.test.ts` 为 3 files / 14 tests passed，listener throw 不改变 terminal 结果。

- [x] 1.4 为 descriptor-owned 多量纲 unit、boundaries、min/max 聚合建立目标行为与 negative tests。
  来源：`FN-7.5` + 系统质量属性“性能/容量” + “非秒数直方图必须使用量纲匹配的固定聚合”。
  结果：变更前 7 个 unit/boundary/exporter 断言失败；实现后 observability 定向命令 40 tests passed，descriptor 非空、有限、非负、严格递增约束通过，`npm run build -w @nextagent/agent-observability` 退出码 0。

- [x] 1.5 扩展单一 metric descriptor inventory 与 SDK view，使新增 counters/histograms 使用规范 labels、units、boundaries 和 `recordMinMax`，且 official HTTP instrument 路径不变。
  来源：`FN-7.5` + “Metric inventory 必须声明来源、标签和增强需求”。
  结果：descriptor/instrument 测试通过（29 descriptors、14 counters、15 histograms）；`npx vitest run --config vitest.config.release.ts tests/agent-kernel/runtime-metrics.test.ts` 为 1 file / 7 tests passed；observability build 退出码 0。

- [x] 1.6 修改 model/request/anomaly metric projection 与 timeline request usage accumulator，使 terminal-only、公式、完整性和唯一异常分类产生规范 samples。
  来源：`FN-7.5` 的 model、request、异常 Scenarios。
  结果：observability 定向命令 40 tests passed；`npx vitest run packages/agent-observability/tests` 为 14 files / 92 tests passed；缺失或非法速率/usage 输入只省略对应 sample。

- [x] 1.7 将 runtime `executingRuns` 的真实 set/delete 收敛到唯一 helpers 并发布 metrics-agnostic transition，保证 normal、pending-input、cancel、terminal 与 recovery 路径正确且 listener non-blocking。
  来源：design “Runtime execution-state 使用窄 typed handoff”。
  结果：runtime 定向命令 14 tests passed；`npx vitest run packages/agent-runtime/tests` 为 29 files / 219 tests passed；`npm run build -w @nextagent/agent-runtime` 退出码 0。

- [x] 1.8 在 app composition 将 runtime transition 通过 typed adapter 投递到既有 projector host，由 MetricsProjector 产生 queued duration 与 concurrency samples。
  来源：design “Runtime execution-state 使用窄 typed handoff”与“保留与明确不修改的边界”。
  结果：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts packages/agent-app/tests/metrics-exporter-composition.test.ts` 为 2 files / 7 tests passed；`npm run lint:architecture` 为 50 files / 308 tests passed，dependency-cruiser 0 violation。

- [x] 1.9 同步开发者 metrics 清单，说明 histogram 查询、并发采样、界面首字边界、导出路径与 official HTTP owner。
  来源：proposal “目标与非目标”“影响范围”。
  结果：开发文档逐项对齐 29 个 `METRIC_DESCRIPTORS`；`rg -n "web_request_total|web_request_duration_seconds|local log sink|metric_diagnostic" docs/developer/22-observability-metrics.md` 无匹配。

- [x] 1.10 执行 `FN-7.5` 定向回归，确认既有 request/model/capability/gateway/health/HTTP metrics、dedup、redaction 与 exporter lifecycle 无回归。
  来源：design “验证策略”“质量属性影响”。
  结果：observability 94 tests、runtime 219 tests、agent-kernel 7 tests、app trajectory/exporter 7 tests 全部通过；新增 normal/debug LOG 负向断言，确认 request terminal timeout 分类只供 metrics 消费；仅出现仓库既有 SQLite experimental/Fastify warning，无未处理 rejection。

## 2. Change 整体验证

- [x] 2.1 执行完整后端与 OpenSpec 门禁，确认目标 metrics 落地且 minimal kernel、contract、architecture 和 active change 全部无回归。
  来源：proposal “影响范围”；design “验证策略”。
  结果：`npm run build` 与最终 `npm run typecheck` 退出码 0；`npm test` 为 167 files / 2159 tests passed；`npm run test:contract` 为 49 files / 387 tests passed；`npm run lint:architecture` 为 50 files / 308 tests passed；`openspec validate complete-runtime-performance-metrics --strict` 通过；`openspec validate --all --strict` 为 296 passed / 0 failed。
  发布前 rebase 到 `origin/main@620c94cdd` 后复验：`npm run build`、387 个 contract tests、308 个 architecture tests 和 296 项严格 OpenSpec 校验通过；observability/runtime 定向回归 44 files / 315 tests、release 配置下 metrics/app 回归 3 files / 14 tests 通过。全量 `npm test` 的 metrics 影响范围无失败，但最新基线的 Skill body 行为变更仍有 2 个旧 `agent-core` 断言稳定失败；另一个未触达的日志压缩用例单独复跑通过。上述失败文件不在本 change diff 内，按外科手术边界不混入无关修复。

## 归档前更新基线检查（非实施任务）

归档流程再按 design 的“长期基线刷新计划”归并 stable spec、Function、Feature、architecture、modules 与 spec-to-design-map；检查长期文档没有重复定义同一指标行为、owner 或 acquisition boundary。
