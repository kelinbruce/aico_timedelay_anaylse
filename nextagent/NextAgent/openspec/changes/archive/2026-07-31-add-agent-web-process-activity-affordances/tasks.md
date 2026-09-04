## 1. 活动条目状态

- [x] 1.1 在 `ProcessPanel.test.ts` 增加活动行唯一性、固定节点、标题层级、终态/history 移除、原图标稳定和焦点不迁移的失败用例
- [x] 1.2 最小修改 `ProcessPanel`，只消费既有活动判定并投影可访问状态与主题视觉
- [x] 1.3 在 `ProcessPanel.test.ts` 增加浅色/深色主题外圈呼吸、无节点缩放、reduced-motion 静态退化，以及更晚可见助手文字立即移除上一步活动提示的失败用例
- [x] 1.4 最小修改 `ProcessPanel`，让活动提示与 composed presentation 视觉交接使用同一顺序事实，并只在固定节点 wrapper 上实现主题感知的外圈呼吸
  验证（2026-07-29）：合并最新 `origin/main` 后，前端定向测试 9 files、258 tests 通过；完整浏览器门禁 24/24 通过，覆盖三宿主 process activity、reduced-motion、AskUserQuestion 多轮交互与 200-turn 大数据场景；前端 TypeScript build、modes build、mock server 8/8、OpenSpec strict 260/260 与 architecture gate 41 files/247 tests 均通过。

## 2. 新条目一次性进入反馈

- [x] 2.1 增加首次 live 新行、detail/rerender/panel reopen 不重放、run scope、history 和 reduced-motion 失败用例
- [x] 2.2 实现 committed-render 后更新的 run-scoped appearance 记录与 200ms/4px 进入反馈

## 3. 视口跟随

- [x] 3.1 建立跟随底部、离开底部、恢复跟随和缺失回调的 characterization
- [x] 3.2 将活动 key/sequence 接入既有 follow-bottom effect，不增加 `scrollIntoView` 或第二 viewport owner

## 4. 焦点稳定 disclosure 与答案交接

- [x] 4.1 增加完成条目无延迟、手工展开/收起保持、run scope 重置和成功重开目录的失败用例
- [x] 4.2 修改 `useProcessEntryDisclosure`，实现无延迟自动收起、run-scoped 手工状态和目录式重开
- [x] 4.3 增加执行中 content、已完成答案、离开底部、手工展开/收起、自动收束后 failed，以及 canonical `QUESTION` required/received/durable-answer/timeout/cancel/非 QUESTION/缺 `pendingInputId` 的失败用例
- [x] 4.4 只读取既有 Turn 完成态、可见答案与同 root/run/`pendingInputId` 的 `QUESTION` 补充信息 presentation，完成 ProcessPanel 一次性 handoff、手工状态优先和异常展示
- [x] 4.5 增加运行中公开助手文字收起此前自动步骤 detail、面板保持打开、阶段说明后新步骤继续展开、同一步骤恢复活动、手工展开优先和 supplemental `QUESTION` 优先的失败用例
- [x] 4.6 复用共享 Web presentation 中最新可见助手文字与过程条目的展示先后关系，实现步骤级视觉交接，不读取 `stageNote`、`final` 或 Provider metadata
- [x] 4.7 增加 timeline sequence 大于后续 Assistant Message history ordinal 时仍按 composed presentation 先后收起步骤 detail 的回归用例
- [x] 4.8 将公开文字交接改为比较同一个 composed `aiEvents` 中的展示位置，不跨域比较 timeline sequence、history ordinal 或 Message sequence
- [x] 4.9 增加 accumulated assistant snapshot 原槽位更新但活动时间晚于新思考时仍收起该思考 detail 的回归用例，并以 normalized `createdAt` 计算同域活动顺序
- [x] 4.10 增加包含 PIU 结构化内容的 detail 自动收起、用户主动展开和再次收起组件回归及专用 mock 手测用例，不锁定 PIU 挂载策略
- [x] 4.11 为专用 mock 用例增加仅开发环境生效的 `network-diagnostic@1.0.0/render` 可交互 PIU 卡片，验证 `PiuMessage → autoLoad → emit → container` 链路；未知 PIU 保持 no-op
  验证（2026-07-29）：在 `frontend/agent-web` 运行 `npm test -- src/host/prel-mock.test.tsx src/features/chat/components/ProcessPanel.test.ts`，2 files、22 tests 通过。
- [x] 4.12 增加 `piu-answer` mock，用前置结构化文字、答案区 PIU 和后续模型总结验证 composed answer 排布顺序
  验证（2026-07-29）：mock server 8/8 tests 通过；`AnswerSegments.test.tsx` 与 `prel-mock.test.tsx` 共 36/36 tests 通过。

## 5. 三宿主与交付门禁

- [x] 5.1 扩展 `process-history-modes.spec.cjs`，验证三宿主活动状态、进入反馈、disclosure 和视口结果一致
- [x] 5.2 运行前端定向测试、build、modes build、目标 E2E、OpenSpec strict、architecture gate 和 diff check

## 6. 范围与语义审计

- [x] 6.1 从最新 `origin/main` 建立隔离交付分支，确认基线相关测试 4 files、43/43 通过
- [x] 6.2 将 proposal、design 和增量 spec 收敛为纯 `frontend/agent-web` 体验职责
- [x] 6.3 审计最终 diff 不包含 stage-note、provisional output、Message/Event、runtime persistence、Channel 或 Think continuity 实现
- [x] 6.4 使用 `nextagent-code-review` 完成最终语义检视，确认无 P0/P1

## 归档前更新基线检查（非实施任务）

归档时只把活动提示、进入反馈、视口协作、焦点稳定 disclosure 和重开目录归并到 `agent-web-process-panel` stable spec 与 `agent-web` 模块设计。
