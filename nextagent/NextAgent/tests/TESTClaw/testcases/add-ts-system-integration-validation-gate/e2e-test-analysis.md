# E2E Test Analysis

## 结论

本 change 的 TestClaw 独立门禁固定为 122 个 activated cases：

- 114 个从现有覆盖逐条同步：41 fixed gate + 49 backend E2E + 24 browser E2E；
- 3 个新增系统集成；
- 5 个新增跨边界 E2E；
- 分层结果为 3 INTEGRATION + 119 E2E。

“同步”不是引用源码报告。每个来源场景必须在 TestClaw 中拥有唯一 executionRef，并通过候选包或外部 packed package 的公共边界产生本次结果。

## 测试入口与退出

| 项 | 设计 |
|---|---|
| 主入口 | `npm --prefix tests/TESTClaw run test:system-integration` |
| 来源漂移入口 | `npm --prefix tests/TESTClaw run test:system-integration:sync` |
| 候选输入 | `NEXTAGENT_PACKAGE_ROOT` 或 TestClaw `target` |
| 外部包输入 | `NEXTAGENT_EXTERNAL_PACKAGES_ROOT` |
| 退出 | `report.json` + 进程退出码；全部 122 PASSED 才返回 0 |

## 测试类型判定

- `TC-SI-112..114` 是集成测试：从 packed package public exports 进入并跨 HTTP 或文件系统边界，不要求完整用户入口。
- 其余 119 个是 E2E：必须从候选进程的产品 API、transport 或浏览器入口进入。
- deterministic model fixture 允许稳定回答，但不能替代 transport、runtime、gateway、browser 或 filesystem 目标边界。

## 单 case 执行规则

`TC-SI-001..122` 每个 case 都在本 Function suite 中拥有独立执行文件。文件可以复用 TestClaw helper 和共享候选进程 fixture，但必须独立表达公共入口、前置条件、用户/系统可观察断言和失败边界；一个 executionRef、结果和 evidence 只能服务一个 `TC-SI-*`。

## 关键风险

| 风险 | 验证策略 |
|---|---|
| 源码测试被误当成通过证据 | negative test 拒绝 source report、private/testing import 和 source fallback |
| 114 场景映射漂移 | source-sync 对 41/49/24 精确计数和 identity 做双向校验 |
| remote packages 不在候选包 | 独立 external packages root；缺失显式 `UNAVAILABLE` |
| browser fixtures 与真实后端语义不同 | TestClaw 从候选后端获取 canonical truth；差异直接失败 |
| 大量场景导致资源污染 | run scope、随机端口、共享只读 fixture、逐 case evidence、finally cleanup |
| 安全数据进入导出边界 | canary 注入和 TestClaw 对外 stdout/stderr/evidence 全量扫描；候选 operational log 使用独立 restricted diagnostic root，只导出安全 reason/hash/ref |

## 验收矩阵

| 维度 | 通过条件 |
|---|---|
| 完整性 | case ids 恰好 `TC-SI-001..122` |
| 独立性 | 不读取源码测试结果，不导入 source/private/testing |
| 映射 | 114 个来源与 114 个 TestClaw cases 双射 |
| 系统集成 | `112..114` 全部通过 |
| E2E | `001..111` 与 `115..122` 全部通过 |
| 安全 | 报告、TestClaw 对外 stdout/stderr 和 evidence 无禁止内容；restricted diagnostic 不被复制并在 cleanup 删除 |
| 可恢复 | 连续运行互不污染，失败后无残留进程 |
| 可追踪 | source/spec → case → execution → result/evidence 双向可定位 |
