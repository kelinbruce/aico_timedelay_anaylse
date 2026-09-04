# Code review — 2026-08-12

## 结论

**PASS**。基于最新 `main` 的 `main...HEAD` 语义检视未发现 P0、P1 或需要随本 change 延期的 P2。

## 审查范围

- Frozen contracts：`CapabilityDescriptor.locales`、optional Provider `listCurrent`、`CapabilityCurrentViewPort`、runtime presentation query contracts。
- Owner/Agent Scope：Session route 先 `requireSession`，只使用持久化 Session 的 `agentId`；客户端不能提交 locale、agentId 或 Provider selector。
- Provider/Catalog：EAGER 只读启动期 descriptor；SEARCH 只读当前本地/已安装事实；复用既有 binding、availability、priority 与 conflict winner；不调用 `search`。
- Browser owner：三宿主复用 shared Session store/coordinator；Session 预取、single-flight、dirty trailing、last-good、confirmed-missing、迟到 response 隔离和 locale 零请求切换。
- Non-regression：AICOConfig 名称字段与前端静态名称权威删除；wrapper/action/status/detail i18n、Capability identity、模型名称、执行、结果披露、Runtime Bootstrap、Gateway 与 persistence 不变。
- Clean Code / security：无 private package import、无新 Gateway record/table/migration、response closed schema、纯文本渲染、非法资源整批拒绝。

## 验证证据

- `npm run build`：PASS。
- `npm test`（非沙箱重跑）：150 files passed、1 skipped；1819 tests passed、2 skipped。
- `npm run lint:architecture`：46 files、290 tests PASS；dependency-cruiser 与 package manifest policy PASS。
- OpenSpec：当前 change strict PASS；`--all --strict` 290/290 PASS。
- Agent Web：focused 8 files、188 tests PASS；TypeScript build PASS；`build:vite:modes` PASS；Capability browser E2E 7/7 PASS。
- Provider/current-view focused release suite：163/165 PASS；2 个失败均为 `skillhub-source.test.ts` 中既有 Skill invocation 断言，`main...HEAD` 未修改对应执行逻辑或断言；本 change 新增 current-read cases PASS。
- `npm run test:contract`（非沙箱重跑）：364/368 PASS。4 个失败分别来自 default Gateway 列表已包含 `api-call`、repository `default-system` 配置基线校验、同配置导致 local entrypoint blocked、remote Workflow `requestHeaders` 基线投影；相关测试、配置和实现不在本 change diff 中。
- Agent Web 全量测试仍有既有 reduced-motion、annotation、immersive route 与 attachment fixture 失败；本 change focused component/state/process/PIU tests 和 E2E 均通过。

## Gateway 结论

本 change 不新增或修改 Gateway contract、Record、store、table 或 migration。Session-scoped 查询仅复用既有 `RuntimeSessionPort → UserSessionService → SessionStoreGateway.loadSession` 读取链路完成 Owner Scope 校验并取得可信 Session `agentId`；Capability 名称本身不写入 Gateway。

## 最新 main 同步复审

- 分支已 rebase 到 `origin/main@888b1f7eb`。最新 main 已删除两个旧的根目录 Skill 样例，本 change 未恢复已删除资产；正式正向资产收敛为现存 `network-explorer` Agent，Skill 的中英文与无本地化降级继续由独立 fixture 覆盖。
- rebase 冲突按最新 main 的 system-event、Workflow lifecycle、input-guard 和 process projection 语义合并，仅移除已被本 change 替代的 AICOConfig/构建期名称映射残留。
- 最新聚焦验证：Agent Web TypeScript PASS；Agent Web 6 files / 201 tests PASS；backend 5 files / 56 tests PASS；bundled Agent 1 test PASS；OpenSpec 250/250 strict PASS。
- 最新 main 的根 build 仍被 `local-gateway-contract.test.ts` 中已删除 `ConversationAnnotationRecord.comment` 的基线测试引用阻塞；architecture gate 仍被 `agent-channel-common` 既有注释中的字面量触发。两处文件均不在本 change 差异中，不归因于本 change。
- 最终语义结论仍为 **PASS**：未发现 P0、P1 或需要随本 change 延期的 P2。
