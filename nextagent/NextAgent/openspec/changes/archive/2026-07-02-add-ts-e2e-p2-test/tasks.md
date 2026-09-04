## 1. Gate 骨架与执行入口

- [x] 1.1 在 `tests/e2e/p1-p2-scenario-gate/` 下新增 `case-inventory.ts`，固定当前全部 activated case 的 case id、scenario family、来源能力和 evidence 归属。
  验证：Vitest inventory test 或 code review 检查点：inventory 包含 `e2e-P1P2-01` 到 `e2e-P1P2-06` 六个 activated case，且不混入 planned/excluded 场景。
  来源：spec requirement “P1P2 E2E case 必须保持唯一主要归属”；design D3a
- [x] 1.2 新增 `scripts/run-p1-p2-scenario-gate.mjs`，提供唯一 gate runner，负责清理 report 目录、运行 gate 用例并触发 report writer。
  验证：`node scripts/run-p1-p2-scenario-gate.mjs`。
  来源：spec requirement “P1P2 E2E gate 必须直接交付门槛用例”；design D6
- [x] 1.3 在 `package.json` 中新增唯一标准命令 `npm run test:e2e:p1-p2-scenario-gate`，并保持与现有 alpha/product-journey/release-package gate 命令风格一致。
  验证：`npm run test:e2e:p1-p2-scenario-gate -- --help` 或实际执行 gate。
  来源：spec requirement “P1P2 E2E gate 必须直接交付门槛用例”；design D6

## 2. 当前门槛用例实现

- [x] 2.1 实现 `extension-governance` 黑盒用例，验证 lifecycle hook、risk policy、skill resource access、gateway configuration 在真实 product composition、真实 transport 和真实 persistence 下的外部可观察结果。
  验证：`npm run test:e2e:p1-p2-scenario-gate` 中 `e2e-P1P2-01` 通过。
  来源：design D3a activated case `e2e-P1P2-01`
- [x] 2.2 实现 `long-term-memory` 黑盒用例，验证 memory core/tools/extraction/aging/configuration/task trajectory 在跨请求或跨会话下的真实外部效果。
  验证：`npm run test:e2e:p1-p2-scenario-gate` 中 `e2e-P1P2-02` 通过。
  来源：design D3a activated case `e2e-P1P2-02`
- [x] 2.3 实现 `routing-child-agent` 黑盒用例，验证 routing evidence、fallback 或 child-agent 路径在真实 runtime、gateway 和 stream 投影下的外部结果。
  验证：`npm run test:e2e:p1-p2-scenario-gate` 中 `e2e-P1P2-03` 通过。
  来源：design D3a activated case `e2e-P1P2-03`
- [x] 2.4 实现 `human-pending-input` 黑盒用例，验证 AskUser、question/confirmation/authorization/handoff pending input 在真实 request、真实 Web transport、真实 pending input 持久化和回答恢复链路下的外部结果。
  验证：`npm run test:e2e:p1-p2-scenario-gate` 中 `e2e-P1P2-04` 通过。
  来源：design D3a activated case `e2e-P1P2-04`
- [x] 2.5 实现 `workflow-routing` 黑盒用例，验证 workflow routing、workflow execution 和 workflow package composition 在真实 product composition、真实 transport 和真实 runtime 下的外部结果。
  验证：`npm run test:e2e:p1-p2-scenario-gate` 中 `e2e-P1P2-05` 通过。
  来源：design D3a activated case `e2e-P1P2-05`
- [x] 2.6 实现 `conversation-share` 黑盒用例，验证分享创建、共享只读查看、run snapshot 过滤和 viewer ops 权限门槛在真实 Web route、真实 share persistence 和真实 session/message 路径下的外部结果。
  验证：`npm run test:e2e:p1-p2-scenario-gate` 中 `e2e-P1P2-06` 通过。
  来源：design D3a activated case `e2e-P1P2-06`
- [x] 2.7 新增 `negative-gate.test.ts`，验证 gate 不接受缺失 case、planned case 混入、mock transport 路径或非真实边界替身作为通过证据。
  验证：Vitest negative gate test。
  来源：spec requirement “P1P2 E2E 门槛只接收真实边界场景”；design D6

## 3. 证据与报告输出

- [x] 3.1 为当前 gate 实现固定 machine-readable report，至少输出 `caseId`、`scenarioFamily`、`maturityStage`、`ownerGate`、`result`、`failurePhase` 和 `evidenceRefs`。
  验证：`tests/e2e/p1-p2-scenario-gate/write-report.test.ts`。
  来源：spec requirement “P1P2 E2E 门槛证据必须安全且可消费”；design D5、D5a
- [x] 3.2 增加 forbidden evidence negative verification，确认 report/evidence 不含 raw credential、prompt、完整模型输出、附件正文、未脱敏绝对路径、provider secret、raw backend exception 或 adapter-private DTO。
  验证：report negative test。
  来源：spec requirement “Forbidden evidence 内容触发失败”；design D5b
- [x] 3.3 将 gate report 接到 release qualification 可消费的输出位置，但不定义新的 release verdict 聚合器。
  验证：runner 执行后产出 gate report；code review 检查点：没有新增第二套 verdict contract。
  来源：design D5

## 4. 验证与收尾

- [x] 4.1 执行 gate 和仓库基础验证：`npm run test:e2e:p1-p2-scenario-gate`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：命令成功。
  来源：实现型 E2E gate 常规门禁
- [x] 4.2 执行 OpenSpec 严格校验，并确认 proposal、design、specs、tasks 与实际测试实现一致。
  验证：`openspec validate add-ts-e2e-p2-test --strict`、`openspec validate --all --strict`。
  来源：proposal scope；design 验证映射
- [x] 4.3 复核本 change 没有偷渡产品行为、通用 E2E DSL、release verdict 聚合或对既有 Alpha/P0 gate 的职责重写。
  验证：code review 检查点：diff 只包含当前 gate 的测试、runner、命令和相应 OpenSpec 文档。
  来源：proposal 非目标；design D6
