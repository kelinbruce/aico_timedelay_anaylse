## 1. `FN-2.4 查看请求状态`

- [x] 1.1 为 `systemEventPresentation` 建立中英文目标行为测试，覆盖三类事件的固定标题、基础摘要、严重程度、显式 code 有无、未知 code 和任意 payload 文本不泄漏；实施前运行测试并确认现有代码因 resolver 不存在或行为不满足而失败。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenarios `canonical 降级提示不承诺请求结果`、`前端兼容 Hook 提示隐藏内部术语`、`上下文整理是信息提示`；`FN-2.4 查看请求状态` + 系统质量属性 `安全` + Requirement `系统过程事件普通界面必须限制技术信息披露` + Scenarios `任意事件文本不能替代固定业务语义`、`显式技术码仅在用户主动展开后可见`、`缺少显式技术码时不能从文本补充`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/systemEventPresentation.test.ts`；实现前预期出现明确失败，resolver 实现后预期全部通过。

- [x] 1.2 为折叠过程与时间线建立目标行为和 negative-case 测试，断言两处文案一致、技术码通过既有“技术详情/错误码”语义默认收起、上下文与 Hook 不展开、任意文本不可见，同时锁定事件顺序、条目数量、terminal 去重、最终答复及请求下方终态失败总结不变；实施前运行并确认目标断言失败。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenarios `不适用事件继续由既有呈现规则处理`、`请求终态失败总结保持独立`；`FN-2.4 查看请求状态` + 系统质量属性 `安全` + Requirement `系统过程事件普通界面必须限制技术信息披露` + Scenarios `任意事件文本不能替代固定业务语义`、`显式技术码仅在用户主动展开后可见`、`缺少显式技术码时不能从文本补充`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetails.test.ts tests/processDetailsProjection.test.ts tests/TurnBlock.failed.test.tsx`；实现前预期至少一个新目标断言失败，实施后预期全部通过，旧条目、terminal owner 与截图所示 `MODEL_INTERNAL_ERROR` 终态失败总结无回归；不得新增断言固化其他 code 未校验 `retryable` 或 surface retry control 的既有偏差。

- [x] 1.3 为完整运行图和短暂上下文提示建立目标行为测试，断言降级/Hook 为 warning、上下文整理为 info、三类事件使用固定语义、可见阶段为中性系统处理提示且任意 payload 文本不可见；锁定真实 Runtime 先产生整理事件、后产生答案时的 3 秒显示窗口，且后续 answer delta 不重启计时，实施前运行并确认目标断言失败。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenarios `canonical 降级提示不承诺请求结果`、`前端兼容 Hook 提示隐藏内部术语`、`上下文整理是信息提示`；design `FN-2.4 查看请求状态 / 修改方案 / 消费者接入`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/runGraphViewState.test.ts tests/TurnRunGraphPanel.test.tsx tests/TurnBlock.test.tsx`；实现前预期至少一个新目标断言失败，实施后预期全部通过。

- [x] 1.4 建立产品配置边界 characterization，断言未声明的系统事件标题、摘要、严重程度或 visibility 字段被 AICOConfig validator 忽略，且 `showThinkingChain=false` 只隐藏完整过程入口，不删除 ProcessPanel 中的 `DEGRADATION_NOTICE` 摘要；实施前运行并记录既有边界通过。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenarios `产品配置不能改写系统事件语义`、`产品配置不能整体隐藏降级事实`；design `FN-2.4 查看请求状态 / 修改方案 / 配置与可见性边界`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/aico-config/validateAICOConfig.test.ts tests/TurnBlock.test.tsx`；预期 characterization 在实现前通过，实施后继续通过。

- [x] 1.5 实现纯 `systemEventPresentation` resolver 和唯一一组 `zh-CN`/`en-US` 文案，使 event type 成为标题、摘要与严重程度的唯一语义输入，只有 `DEGRADATION_NOTICE` 顶层显式非空 `code` 可进入可选技术证据，legacy 文本内的伪 code 不得被解析；resolver 不接收或读取 AICOConfig、显示级别或 visibility policy。
  来源：design `FN-2.4 查看请求状态 / 修改方案 / 唯一呈现入口`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/systemEventPresentation.test.ts tests/i18n.test.ts src/i18n/index.test.ts`；预期 resolver 与本地化测试全部通过，无缺失 key。

- [x] 1.6 将 `processDetails.ts` 的折叠过程、时间线和 terminal failure 关联降级过程条目接入 resolver，删除三类事件对任意 payload 文本的用户摘要回退，同时保持排序、合并、条目 key、数量和 terminal owner 不变；不得修改 `failureDetails.ts`、`FailedNotice`、终态失败 i18n 映射或既有安全事实选择优先级。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenario `不适用事件继续由既有呈现规则处理`；`FN-2.4 查看请求状态` + 系统质量属性 `安全` + Requirement `系统过程事件普通界面必须限制技术信息披露` + Scenarios `任意事件文本不能替代固定业务语义`、`显式技术码仅在用户主动展开后可见`、`缺少显式技术码时不能从文本补充`；design `FN-2.4 查看请求状态 / 修改方案 / 消费者接入`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetails.test.ts tests/processDetailsProjection.test.ts tests/buildTurnBlocks.test.ts`；预期全部通过，旧技术标题和注入文本断言为不可见。

- [x] 1.7 将完整运行图和 `TurnBlock.tsx` 的短暂提示接入 resolver；保留内部 `kind='degradation'`，把三类 node 的可见阶段改为中性系统处理提示，并使 `CONTEXT_COMPACTED` 使用 info status，不改其他 node、edge、raw event 或动画时序。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenarios `上下文整理是信息提示`、`不适用事件继续由既有呈现规则处理`；design `FN-2.4 查看请求状态 / 修改方案 / 消费者接入`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/runGraphViewState.test.ts tests/TurnRunGraphPanel.test.tsx tests/TurnBlock.test.tsx`；预期三类目标事件与全部既有非目标 graph/TurnBlock 测试通过。

- [x] 1.8 建立 live/history characterization，验证 canonical durable `DEGRADATION_NOTICE` 与 `CONTEXT_COMPACTED` 刷新前后语义一致，并实际断言 transport failure notice、3 秒短暂动画与 `HOOK_DEGRADED` 不被 history 合成。
  来源：`FN-2.4 查看请求状态` + 系统质量属性 `可靠性/恢复` + Requirement `系统过程事件的实时与历史语义必须闭合` + Scenarios `canonical durable 事件刷新前后语义一致`、`transport failure notice 保持 live-only`、`上下文整理短暂动画保持 live-only`、`Hook 兼容事件保持 live-only`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processHistory.test.ts tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx tests/conversationStore.process-history.test.ts`；预期 durable 事件 live/history 断言一致，三个 live-only negative case 均不产生历史呈现。

- [x] 1.9 增加三种宿主与中英文浏览器旅程，验证默认过程、完整运行图和上下文短暂提示使用同一业务语义，且界面不出现“降级通知”“Hook 降级”“上下文压缩”或对应英文技术标题。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenarios `canonical 降级提示不承诺请求结果`、`前端兼容 Hook 提示隐藏内部术语`、`上下文整理是信息提示`；design `FN-2.4 查看请求状态 / 验证策略`
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e -- tests/e2e/system-event-business-language.spec.cjs`；预期 local、immersive、collaborative 的 zh-CN/en-US 用例全部通过。

- [x] 1.10 增加仅供人工集成验收的受控失败 Tool fixture 及其隔离门禁。Fixture 必须返回合法且安全的失败结果，不得被默认配置、默认 Agent assembly、构建 artifact 或发布包引用；具体错误码和装配参数由测试资产持有，不构成产品契约。
  来源：design `FN-2.4 查看请求状态 / 修改方案 / 真实 Runtime 验证装配`
  验证：运行 fixture contract test、默认装配 architecture negative test 和构建 artifact 检查；预期 fixture 返回合法 `FAILED` Capability result，默认产品装配与发布产物中不存在 fixture plugin、Agent 或配置引用。

- [x] 1.11 增加 `DEGRADATION_NOTICE` 真实 Runtime 场景配置和公共 API 验证脚本。专用 Agent 与验证模型策略必须将执行约束为一次受控 Tool 失败；脚本不得直接写 timeline、SQLite，或读取 MiniMax 凭据，具体触发参数由测试配置持有。
  来源：design `FN-2.4 查看请求状态 / 修改方案 / 真实 Runtime 验证装配`；`FN-2.4 查看请求状态` + Requirements `Agent Web 系统过程事件必须使用事实性业务语言`、`系统过程事件普通界面必须限制技术信息披露`、`系统过程事件的实时与历史语义必须闭合`
  验证：使用既有 MiniMax 启动器启动隔离实例并运行场景脚本；脚本必须输出 sessionId、requestId、runId、`DEGRADATION_NOTICE`、terminal status 和 history 重建结果，并在同一前端 artifact 中断言固定业务摘要、默认收起的显式技术码与完整运行图语义；日志和产物不得包含 credential，也不得修改默认服务与默认数据。

- [x] 1.12 增加 `CONTEXT_COMPACTED` 真实 Runtime 场景配置和公共 API 验证脚本。脚本必须通过公共 request API 构造有界的长上下文，并使用验证专用的受限模型 profile 稳定触发现有自动压缩路径；不得直接调用 Context Engine 私有方法或写 timeline、SQLite，具体窗口、输入规模和 prompt 由测试资产持有。
  来源：design `FN-2.4 查看请求状态 / 修改方案 / 真实 Runtime 验证装配`；`FN-2.4 查看请求状态` + 系统质量属性 `可靠性/恢复` + Requirement `系统过程事件的实时与历史语义必须闭合` + Scenarios `canonical durable 事件刷新前后语义一致`、`上下文整理短暂动画保持 live-only`
  验证：使用既有 MiniMax 启动器启动隔离实例并运行场景脚本；脚本必须输出各轮 request/run 坐标、`CONTEXT_COMPACTED`、terminal status 和 history 重建结果，并在同一前端 artifact 中断言信息级固定业务摘要、完整运行图语义和只在 live 出现的短暂提示；日志和产物不得包含 credential，也不得修改默认服务与默认数据。

- [x] 1.13 复核真实 Runtime 验证矩阵只包含 canonical `DEGRADATION_NOTICE` 与 `CONTEXT_COMPACTED`；`HOOK_DEGRADED` 继续由前端 compatibility fixture 验证，测试配置、脚本和断言不得新增后端 producer、channel vocabulary、history projector 或派生映射。
  来源：design `FN-2.4 查看请求状态 / 修改方案 / 真实 Runtime 验证装配`；`FN-2.4 查看请求状态` + Requirement `系统过程事件的实时与历史语义必须闭合` + Scenario `Hook 兼容事件保持 live-only`
  验证：运行 architecture/source negative test 与既有 `npm run test:e2e -- tests/e2e/system-event-business-language.spec.cjs`；预期后端和 channel 无 `HOOK_DEGRADED` producer/projector，前端 compatibility 用例继续通过。

- [x] 1.14 将三类系统事件的中英文目标测试更新为运维任务语义：`DEGRADATION_NOTICE` 与 `HOOK_DEGRADED` 使用同一“本次任务有部分内容未完成”语义，`CONTEXT_COMPACTED` 使用“已整理较早的对话”语义；保持严重程度、技术码、任意 payload 文本不泄漏、live/history 与三宿主边界不变。实施前运行目标测试并确认现有资源因仍使用旧文案而失败。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` + Scenarios `canonical 降级提示不承诺请求结果`、`前端兼容 Hook 提示隐藏内部术语`、`上下文整理是信息提示`；design `FN-2.4 查看请求状态 / 修改方案 / 唯一呈现入口`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/i18n.test.ts src/features/chat/process/systemEventPresentation.test.ts tests/runGraphViewState.test.ts tests/TurnBlock.test.tsx`；预期修改生产资源前出现目标文案不匹配，实施后全部通过。
  实施记录：2026-08-10 在修改生产资源前运行上述命令，119 个测试中 115 个通过、4 个按预期因旧中英文资源仍返回旧文案而失败，已取得 RED 证据。

- [x] 1.15 仅更新 `zh-CN`/`en-US` 系统事件资源以满足 1.14，并在 design 中固定 GitCode #718 的边界：当前 resolver 不按错误码生成 Capability/Agent 具体业务原因、可执行建议或因果链，不修改 resolver 输入输出、后端、Gateway、公共 API、failure presenter 或 Capability projector。
  来源：design `FN-2.4 查看请求状态 / 修改方案 / 唯一呈现入口`、`明确不修改的边界`、`备选方案`
  验证：运行 1.14 的目标测试并执行 `git diff --name-only`；预期生产代码仅有两份 i18n 资源变化，OpenSpec 只修改当前 change artifacts。
  实施记录：2026-08-10 目标测试 4 个文件、119 个测试全部通过；`git diff --name-only` 显示产品代码仅修改 `zh-CN.ts` 与 `en-US.ts`，其余为目标测试和当前 change artifacts。

- [x] 1.16 先增加折叠过程的目标行为测试：`DEGRADATION_NOTICE` 与 `HOOK_DEGRADED` 必须携带 warning severity 并使用橙黄色三角警告图标，`CONTEXT_COMPACTED` 必须携带 info severity 并使用中性圆形信息图标；绿色完成、红色失败、工具运行中与既有专用图标保持不变。同步把中英文降级摘要更新为“查看执行详情和本次答复，确认未完成内容”的等义文案，并在生产代码修改前运行测试，确认现有实现因丢失 severity 和旧文案而失败。
  来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 系统过程事件必须使用事实性业务语言` 的三个系统事件 Scenarios；design `FN-2.4 查看请求状态 / 修改方案 / 消费者接入`。
  验证：运行 `frontend/agent-web` 的 `ProcessPanel`、`processDetailsProjection`、`systemEventPresentation` 与 `i18n` 定向测试；预期生产代码修改前至少因系统事件条目缺少 severity、图标仍为完成态及资源仍为旧摘要而 FAIL。
  实施记录：2026-08-11 在生产代码修改前运行四个目标文件，确认 i18n 旧摘要、三类条目缺少 severity、warning/info 图标缺失共 5 个目标失败；同次运行另有 2 个与本增量无关且修改前已存在的 ProcessPanel 活动态断言失败。

- [x] 1.17 复用 `systemEventPresentation` 已有 severity 与全局 warning/info 主题 token，最小扩展前端内部 `ProcessEntry` 和 `ProcessPanel` 图标选择；warning 使用 `WarningOutlined` 和 `--color-status-warning-dot`，info 使用 `InfoCircleOutlined` 和 `--color-status-info-dot`，不导入 Run Graph 私有类型，不新增状态枚举、颜色体系、后端字段、公共 contract 或 Gateway 依赖，并保持事件数量、排序、终态与 Capability 失败图标不变。
  来源：design `FN-2.4 查看请求状态 / 修改方案 / 消费者接入`、`实时与历史边界`；1.16 的失败测试。
  验证：重跑 1.16 的同一测试集合并确认 PASS；补充 live/history 条目 severity 一致断言和暗色主题 token 断言。
  实施记录：2026-08-11 resolver/i18n/process projection/run graph 120 个目标测试、ProcessPanel warning/info 图标与既有失败/成功图标回归、TurnBlock 系统事件用例全部通过；canonical 两类事件 live/history severity 一致，compatibility-only Hook 单独按 live warning 验证。

## 2. Change 整体验证

- [x] 2.1 完成前端生产构建、多宿主 artifact 构建、目标测试、真实 Runtime 补充验收与 OpenSpec 门禁，并通过人工架构审查确认产品实现 diff 没有 backend contract、timeline、history、persistence、Gateway、Capability resolver、terminal failure presenter、AICOConfig contract、生产 API 或非适用事件呈现变化，默认产品装配不引用测试 fixture，也没有新增通用系统事件 visibility map。
  来源：proposal `目标与非目标（Goals / Non-Goals）`、`影响范围（Impact）`；design `FN-2.4 查看请求状态 / 修改方案 / 明确不修改的边界`、`验证策略（Verification Strategy）`
  验证：在 `frontend/agent-web` 运行 `npm run build`、`npm run build:vite:modes` 和上述全部目标测试；在仓库根目录运行 `openspec validate refine-system-event-business-language --strict`、`openspec validate --all --strict`、`git diff --check`。预期目标 change 严格校验通过、前端命令通过、全量 OpenSpec 相对实施前基线不新增失败项，且 code review 的排除边界检查无违规。

- [x] 2.2 完成运维文案增量的前端目标测试、生产构建和多宿主 artifact 构建。
  来源：proposal `目标与非目标（Goals / Non-Goals）`；design `FN-2.4 查看请求状态 / 修改方案 / 明确不修改的边界`、`验证策略（Verification Strategy）`
  验证：在 `frontend/agent-web` 运行 1.14 目标测试、`npm run build` 和 `npm run build:vite:modes`；预期全部通过。
  实施记录：2026-08-10 目标测试 119/119 通过，TypeScript build 与三宿主 artifact build 均以 exit 0 完成。

- [x] 2.3 运行运维文案增量的 local、immersive、collaborative 中英文浏览器旅程。
  来源：proposal `目标与非目标（Goals / Non-Goals）`；design `FN-2.4 查看请求状态 / 验证策略（Verification Strategy）`
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e -- tests/e2e/system-event-business-language.spec.cjs`；预期 3 种宿主 × 2 种语言全部通过。
  实施记录：2026-08-10 首次运行因沙箱禁止监听 `127.0.0.1:5174` 返回 `EPERM`；获得用户明确授权后在沙箱外重跑，3 种宿主 × 2 种语言共 6 个用例全部通过。

- [x] 2.4 完成 OpenSpec 门禁和人工语义检视，确认未引入错误码业务映射、Capability/Agent 失败呈现、后端 contract、Gateway、公共 API 或配置变化。
  来源：proposal `目标与非目标（Goals / Non-Goals）`；design `FN-2.4 查看请求状态 / 修改方案 / 明确不修改的边界`、`验证策略（Verification Strategy）`
  验证：在仓库根目录运行 `openspec validate refine-system-event-business-language --strict`、`openspec validate --all --strict`、`git diff --check` 并检查完整 diff；预期目标 change 通过，全量 OpenSpec 相对既有基线不新增失败项，产品代码只修改两份 i18n 资源。
  实施记录：2026-08-10 目标 change 严格校验通过；全量 OpenSpec 为 309 passed、3 个既有 change failed；`git diff --check` 通过，人工检视未发现后端、Gateway、API、配置、resolver 或 Capability/Agent failure projector 改动。

- [x] 2.5 完成 severity 图标与新摘要增量的前端生产构建、多宿主构建、中英文浏览器旅程、真实 Runtime 降级/上下文补充验收、OpenSpec strict 和语义检视；确认折叠过程与完整运行图的 warning/info 语义一致，且没有事件合并、后端 contract、Gateway、公共 API、AICOConfig 或请求终态变化。
  来源：proposal `目标与非目标（Goals / Non-Goals）`；`FN-2.4 查看请求状态` 的三个 Requirements；design `验证策略（Verification Strategy）`。
  验证：运行受影响前端单元/组件测试、`npm run build`、`npm run build:vite:modes`、目标 Chromium E2E、真实 Runtime 手工脚本、`openspec validate refine-system-event-business-language --strict`、`openspec validate --all --strict`、`git diff --check` 和 `$nextagent-skill-review`。
  实施记录：2026-08-11 前端 TypeScript build 与三宿主 artifact build 通过；local/immersive/collaborative × zh-CN/en-US 共 6 个 Chromium 旅程通过；真实 MiniMax 降级与上下文整理均产生目标 canonical event，SSE/history/UI/完整运行图通过且请求终态均为 `COMPLETED`；测试 fixture 隔离门禁 7/7、OpenSpec target 与全量 317/317、`git diff --check` 通过；`nextagent-skill-review` 与 `nextagent-code-review` 均为 PASS，无 P0-P3 finding。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、Feature、overview、conversation UI architecture 与 `agent-web` module；确认 `agent-channel-web` module、ADR 和 spec-to-design-map 无需更新，且长期文档不重复定义同一呈现行为或 event owner。
