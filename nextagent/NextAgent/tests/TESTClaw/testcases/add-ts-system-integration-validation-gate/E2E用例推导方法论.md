# E2E 用例推导方法论

## 第一性原则

一个 TestClaw E2E case 只有在回答以下问题后才成立：

1. 谁从哪个真实产品入口发起？
2. 哪些边界是该场景必须穿过的？
3. 最终由谁观察什么结果？
4. 哪个失败最可能被分段测试遗漏？
5. 如何证明结果来自本次候选包执行，而不是源码 fixture 或旧报告？

## 场景选择

- 当前 113 个来源场景：保持用户可观察目标不变，替换成候选包黑盒执行边界。
- 新增场景：只选择 docs Feature/Function/OpenSpec 与外部依赖汇总共同暴露的组合缺口。
- 重叠场景：可共享 setup，不共享 executionRef、assertion result 或 evidence。

## 用例模板

每个用例必须定义：

- `TC-SI-*`；
- 来源或 active Requirement/Scenario；
- Feature、Function、Requirement；
- candidate/external input；
- 真实入口和目标边界；
- normal、boundary、failure/cancel 中适用分支；
- 最终可观察断言；
- 安全 evidence；
- cleanup。

## 判定

- `PASSED`：所有边界和断言真实执行且 evidence 安全。
- `FAILED`：断言、schema、安全、skip/todo、mock/source 依赖或 cleanup 失败。
- `TIMEOUT`：在 case budget 内未完成。
- `UNAVAILABLE`：必需候选或外部 artifact/运行能力缺失。
- `MISSING`：manifest 有 case，但 reporter 没有对应 execution result。
