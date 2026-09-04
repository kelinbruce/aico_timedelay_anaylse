## 1. Gate 基础设施

- [x] 1.1 为 `tests/e2e/` 增加真实 local product process fixture、隔离配置和确定性清理。
  验证：fixture integration test 实际启动/停止 product process，并断言临时数据目录被清理。
  来源：spec requirement “产品旅程 E2E 使用真实产品边界”；design D1
- [x] 1.2 增加 `npm run test:e2e:product-journey`、Playwright project、case inventory 和 machine-readable report。
  验证：命令可执行；故意跳过一个必需 case 时 gate 实际失败。
  来源：spec requirement “产品旅程 E2E 覆盖首版主用户路径”；design D4
- [x] 1.3 将公共测试 helper 限定为 process lifecycle、临时目录、真实 transport client、case inventory 和本 gate report 写入；不得引入通用 E2E DSL 或产品路径可依赖的测试机制。
  验证：code review 检查 helper 只被 `tests/e2e/` 使用，且没有新增产品 API、产品入口依赖或跨 gate 通用编排框架。
  来源：design D5

## 2. 产品旅程用例

- [x] 2.1 实现 e2e-P0-02：登录后创建 session、提交问题并读取 conversation。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-02`。
  来源：spec requirement “产品旅程 E2E 覆盖首版主用户路径”
- [x] 2.2 实现 e2e-P0-03：SSE canonical sequence 和终态。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-03`。
  来源：同上
- [x] 2.3 实现 e2e-P0-04：SSE 与 WebSocket 生命周期和终态一致。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-04`。
  来源：同上
- [x] 2.4 实现 e2e-P0-06：terminal commit 后 stream、history 和刷新结果一致。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-06`。
  来源：同上
- [x] 2.5 实现 e2e-P0-07：same-session latest-submit replacement 和串行 dispatch。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-07`。
  来源：同上
- [x] 2.6 实现 e2e-P0-08：cancel 终态和 partial answer。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-08`。
  来源：同上
- [x] 2.7 实现 e2e-P0-09：retry 新 run 与旧结果追溯。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-09`。
  来源：同上
- [x] 2.8 - [x] 2.10 实现 e2e-P0-13：长会话 selection、summary/compaction 和降级提示。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-13`。
  来源：同上
- [x] 2.11 实现 e2e-P0-14：大内容引用按需加载。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-14`。
  来源：同上
- [x] 2.12 实现 e2e-P0-15：model-tool-capability 完整 loop。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-15`。
  来源：同上
- [x] 2.13 实现 e2e-P0-18：capability source 配置禁用后的目录和调用结果。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-18`。
  来源：同上
- [x] 2.14 实现 e2e-P0-22：feedback 不可更新/撤销和关联事实。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-22`。
  来源：同上
- [x] 2.15 实现 e2e-P0-23：自动标题与手动标题优先级。
  验证：`npm run test:e2e:product-journey -- --grep e2e-P0-23`。
  来源：同上
## 3. Negative Gate 和收尾

- [x] 3.1 增加 forbidden mock negative verification，实际放入一个替代目标 transport 的失败 fixture 并断言 gate 拒绝其作为证据。
  验证：product journey gate negative fixture test。
  来源：spec scenario “Mock 不能满足产品旅程 gate”；design D2
- [x] 3.2 增加 report 安全内容断言和失败 evidence 验证。
  验证：report test 实际注入本 gate report/evidence 会接收的 credential/path/prompt 标记并断言输出不包含标记；不复制 security gate 的全量 canary 扫描。

- [x] 3.3维护唯一标准命令 `npm run test:e2e:product-journey`，写出 machine-readable release smoke `ReleaseCheckResult`，不定义 adapter API 或 release verdict。
  验证：command integration test 覆盖 passed、failed、timeout、报告缺失和 evidence mapping。
  来源：spec requirement “产品旅程 E2E 证据安全且可追溯”；design D5
- [x] 3.4 运行本 change 和仓库门禁。
  验证：`npm run test:e2e:product-journey`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-e2e-product-journey-gate --strict`。
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/ts-e2e-product-journey-gate/spec.md`。
- 更新 `openspec/designs/architecture/e2e-quality-gates.md`、`openspec/designs/modules/agent-app.md` 和 `openspec/designs/spec-to-design-map.md`。
