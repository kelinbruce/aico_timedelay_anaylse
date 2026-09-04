## 1. 基线保护与方案重置

- [x] 1.1 在 `packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts` 和 `frontend/agent-web/src/features/chat/process/processDetails.test.ts` 保留 characterization，锁定三档结果字段、RAG `SUMMARY` 字段、AskUserQuestion 专用呈现，以及 Capability 条目数量、顺序、合并和展开条件
  - 来源：proposal 非目标；design `第一性原理与不变量`
  - 验证：根目录运行 `npm test -- packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；`frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetails.test.ts`
  - 完成证据：既有 characterization 已在业务名称实现前建立，后续任务必须持续保持通过

- [x] 1.2 删除当前工作区中与目标方案冲突的 `businessLabel`、`capabilityPresentation`、Tool `presentation` 和后端名称 resolver 草稿及其专属测试，恢复 `agent-contracts/capability`、`agent-plugin-sdk`、Capability 注册链、Workflow Recipe `displayName` 投影和 app composition 到本 change 开始前行为
  - 删除：`packages/agent-capability/src/capability-business-presentation.ts`、`packages/agent-capability/tests/capability-business-label.test.ts`、`packages/agent-capability/tests/capability-presentation-contract.test.ts`、`packages/agent-channel-common/tests/capability-business-presentation.test.ts`、`packages/agent-core/tests/capability-business-presentation.test.ts`
  - 复核：仅清理本 change 前一方案产生的改动，不覆盖同一工作区中的无关用户修改
  - 验证：根目录运行 `rg -n "CapabilityPresentationMetadata|capabilityPresentation|businessLabel|capability-business-presentation|capability-business-label" packages/agent-contracts packages/agent-plugin-sdk packages/agent-capability packages/agent-app packages/agent-core packages/agent-runtime packages/agent-channel-common packages/agent-channel-web frontend/agent-web/src`；预期生产代码和旧方案专属测试无命中
  - 完成证据（2026-08-06）：上述 `rg` 无命中；根目录 `npm test -- packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts` 通过 91 项；`frontend/agent-web` 的 `npm test -- src/features/chat/process/processDetails.test.ts` 通过 37 项

## 2. Capability lifecycle 最小身份

- [x] 2.1 新增 `packages/agent-core/tests/capability-public-identity.test.ts` 失败测试，覆盖普通 `Read`、Agent wrapper、Skill wrapper 的 started/completed 身份，成功、失败、超时、取消、结果校验失败和 completion-only 分支，以及非 wrapper 参数不产生 `targetCapabilityId`
  - 断言：`capabilityId` 保持执行入口；Agent/Skill 只输出归一化 `targetCapabilityId`；started/completed 逐值一致；payload 不含 `agentId`、`name`、`prompt`、`args` 或其他完整参数
  - 验证：根目录运行 `npm test -- packages/agent-core/tests/capability-public-identity.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts`；预期新增身份断言在实现前失败
  - 完成证据（2026-08-06）：实现前新增 10 项身份断言全部按预期失败；补齐 completion-only RED 后单项按预期失败

- [x] 2.2 修改 `packages/agent-core/src/tools/tool-loop.ts` 的既有 lifecycle payload 构造，在已解析 descriptor 与 `effectiveArguments` 边界形成 request-local `CapabilityProcessIdentity`，并让当前普通 Tool、Agent wrapper、Skill wrapper 的所有 started/completed 终态分支复用
  - 规则：`capabilityKind` 取 descriptor.kind；`capabilityId` 不改写；Agent/Skill/Workflow 只读取对应目标参数并归一化为 `targetCapabilityId`；非法目标局部省略
  - 保持：Workflow 既有外层与内层 lifecycle、Capability 执行、权限、routing、result delta、Message 和审计身份不变；Workflow 目标字段的公共 schema 与前端降级由 2.5、2.6、4.1、4.2 验证
  - 验证：执行 2.1 的测试命令；预期新增测试和既有并行 Tool loop 测试通过
  - 完成证据（2026-08-06）：2.1 命令通过 30 项；result delta 无新增身份，普通 Tool 参数不产生 target，completion-only 只携带可确定入口身份

- [x] 2.3 扩展 `packages/agent-core/tests/workflow-runtime-event-projector.test.ts` 和 `packages/agent-core/tests/workflow-tool-delta-projection.test.ts` 形成失败测试，覆盖 Workflow Tool、Skill、Agent、Subflow 节点分别投影 `TOOL/SKILL/AGENT/WORKFLOW + capabilityId`，非 Capability 节点不伪造 kind，且不改变既有外层与内层条目数量
  - 断言：节点 started/completed 身份一致；result delta 不新增身份字段；showTitle/showContent、父子关系、顺序和现有 structured delta 保持
  - 验证：根目录运行 `npm test -- packages/agent-core/tests/workflow-runtime-event-projector.test.ts packages/agent-core/tests/workflow-tool-delta-projection.test.ts`；预期新增 kind 断言在实现前失败
  - 完成证据（2026-08-06）：实现前新增 5 项身份断言按预期失败，既有 68 项回归保持通过

- [x] 2.4 修改 `packages/agent-core/src/agent/workflow-runtime-event-projector.ts` 和必要的 `packages/agent-core/src/tools/workflow-tool-delta-projection.ts`，只装饰既有 Capability 节点 lifecycle 身份，不查询名称目录、不新增或删除外层及内层事件
  - 验证：执行 2.3 的测试命令；预期身份、display-control 和结构保持断言全部通过
  - 完成证据（2026-08-06）：2.3 命令通过；直接节点身份、非 Capability 负例、delta 不重复和既有外层/内层结构断言通过

- [x] 2.5 扩展 `packages/agent-core/tests/timeline-safe-payload-schemas.test.ts` 和 `packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts` 形成失败测试，覆盖 started/completed 的 optional `capabilityKind`、optional `targetCapabilityId`、合法 wrapper 组合、非 wrapper 目标字段、空值、超过 128 Unicode code point、控制字符、旧 history 和 result delta 不新增字段
  - 验证：根目录运行 `npm test -- packages/agent-core/tests/timeline-safe-payload-schemas.test.ts packages/agent-runtime/tests/timeline-event-persistence-policy.test.ts`；预期新增合法身份用例在 schema 实现前失败，非法组合必须实际触发拒绝或局部省略路径
  - 完成证据（2026-08-06）：持久化负例在实现前 4 项按预期未拒绝并导致测试失败；schema 正向、Unicode 边界和错位 target 均有显式断言

- [x] 2.6 修改 `packages/agent-core/src/projection/capability-timeline-payload-schemas.ts` 和 `packages/agent-runtime/src/timeline/event-persistence-policy.ts`，为 started/completed 增加最小身份 schema 与既有 timeline 持久化校验
  - 保持：`CAPABILITY_RESULT_DELTA`、persistence owner、table、Record、Message 和 Gateway 不变；旧 payload 继续可读取
  - 验证：执行 2.5 的测试命令；预期正向、边界和非法组合全部通过
  - 完成证据（2026-08-06）：2.5 命令通过 59 项；旧 payload 仍可持久化，非法 kind/target 和 delta 重复身份被拒绝

## 3. Web 安全投影与历史一致性

- [x] 3.1 新增 `packages/agent-channel-common/tests/capability-public-identity.test.ts`，并扩展 `packages/agent-channel-common/tests/process-message-projection.test.ts`、`packages/agent-channel-common/tests/web-stream-delivery.test.ts`、`packages/agent-channel-web/tests/session-event-history-route.test.ts` 形成失败测试
  - 覆盖：SSE/WS/history 同形、started/completed 同一身份、delta 不重复、completed 只取 timeline、非法 kind 或 target 局部省略、非 wrapper target 省略、旧 history、completion-only 和合法 `capabilityId` 保留
  - 安全负例：断言 payload 不包含 `agentId`、`name`、`recipeName`、prompt、args、inputText、inputVariables 或原始参数对象
  - 验证：根目录运行 `npm test -- packages/agent-channel-common/tests/capability-public-identity.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`；预期新增身份投影用例在实现前失败
  - 完成证据（2026-08-06）：实现前共享 projector 新增 4 项断言按预期失败；引用 Message 的 Skill 参数泄露负例、live delivery 与 history 同形用例已补齐

- [x] 3.2 修改 `packages/agent-channel-common/src/projections/stream-envelope.ts` 的既有 Capability lifecycle projector，只 allowlist started/completed 的合法 `capabilityKind` 和匹配 wrapper 的 `targetCapabilityId`
  - 规则：不从 Message、result、Capability 目录或当前前端映射补身份；非法新增字段不丢弃合法 `capabilityId`、状态或安全失败；delta 不复制
  - 验证：执行 3.1 的测试命令，并在根目录运行 `npm run lint:architecture`；预期 contract、负例和依赖边界通过
  - 完成证据（2026-08-06）：共享投影测试通过 30 项；channel-web 专用配置下 history 路由通过 17 项；架构门禁通过 45 文件、280 项且无依赖违规

## 4. Agent Web 集中映射与标题

- [x] 4.1 新增 `frontend/agent-web/src/features/chat/process/capabilityProcessTitle.test.ts` 失败测试，覆盖平台内置 Tool、Memory Tool、`ToolSearch`、`acquire_skill`、集成映射、三类 wrapper、直接 Agent/Skill/Workflow、映射未命中、目标缺失、非法身份和中英文模板
  - 映射示例使用 `Read`、`Write`、`Agent`、`Skill`、`Workflow`；Bash/Python 分别断言中性“命令/程序”语义
  - 验证：`frontend/agent-web` 运行 `npm test -- src/features/chat/process/capabilityProcessTitle.test.ts`；预期解析模块不存在或标题仍为技术名时失败
  - 完成证据（2026-08-06）：实现前因解析模块不存在按预期 RED；测试覆盖 18 个平台、集成、wrapper、直接能力、非法身份和中英文场景

- [x] 4.2 新增 `frontend/agent-web/src/features/chat/process/capabilityProcessTitle.ts`，在一个 build-time 映射入口中维护平台 i18n key、集成扩展区和固定模板，并实现唯一标题降级链
  - 规则：wrapper 由入口推导目标 kind，不增加 target kind；Tool 映射值为完整标题；Agent/Skill/Workflow 映射值只为资源名称；当前语言资源缺失时按未命中处理，不借用另一语言；映射不含状态、HTML、Markdown 或详情
  - 保持：不读取 runtime config、Capability 目录、模型或后端名称服务；三种宿主复用同一模块
  - 验证：执行 4.1 的测试命令；预期平台映射、集成映射、非法值和中英文用例全部通过
  - 完成证据（2026-08-06）：4.1 的 18 项全部通过；平台映射优先、集成 map 参数、当前语言 key 缺失降级和固定模板均由纯函数断言

- [x] 4.3 扩展 `frontend/agent-web/src/features/chat/process/processDetails.test.ts` 形成失败测试，覆盖 started-delta-completed 关联、delta 早于可见 started、completion-only、旧 history、状态只拼接一次、三类 wrapper、直接 Workflow 节点、无摘要和三档标题一致
  - 结构回归：断言 Capability 条目数量、顺序、合并、折叠、展开条件、动画输入和 AskUserQuestion 专用呈现不变
  - 验证：`frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetails.test.ts src/features/chat/process/capabilityProcessTitle.test.ts`；预期当前 aggregation 尚未消费公开身份时新增用例失败
  - 完成证据（2026-08-06）：实现前 Read 与 Skill 聚合标题 2 项按预期失败；既有 completion/history/三档/AskUserQuestion characterization 与 resolver 的三类 wrapper、直接 kind 矩阵共同覆盖目标分支

- [x] 4.4 修改 `frontend/agent-web/src/features/chat/process/processDetails.ts` 及 `frontend/agent-web/src/i18n/resources/en-US.ts`、`frontend/agent-web/src/i18n/resources/zh-CN.ts` 的必要平台模板，让既有 tool-call aggregation 使用集中标题 resolver，并移除成功结果的 `resultReturnedWithoutSummary` 占位回退
  - 保持：correlation、merge、排序、折叠、展开、动画、结果 level、RAG 和 pending-input 行为不变
  - 验证：执行 4.3 的测试命令并在 `frontend/agent-web` 运行 `npm run build`；预期标题矩阵和结构回归通过
  - 完成证据（2026-08-06）：过程聚合与 resolver 共 58 项通过；无摘要断言只保留标题状态；frontend TypeScript build 通过

- [x] 4.5 扩展 `frontend/agent-web/src/features/chat/utils/safeSummaryPresentation.test.ts` 形成失败测试，覆盖关联 `capabilityId=Python` 时成功、失败、超时使用程序措辞，Bash 继续使用命令措辞；随后只修改 `safeSummaryPresentation.ts` 与现有调用点
  - 保持：摘要 code、args、结果 level 和未知摘要拒绝规则不变
  - 验证：`frontend/agent-web` 运行 `npm test -- src/features/chat/utils/safeSummaryPresentation.test.ts src/features/chat/process/processDetails.test.ts`
  - 完成证据（2026-08-06）：实现前 Python 5 项均错误使用 command key 并按预期失败；实现后 Python/Bash 8 项和 processDetails 40 项通过

- [x] 4.6 在 `frontend/agent-web/src/features/chat/process/processDetails.test.ts` 增加 DETAIL 证据保持测试，只补齐现有平台标签 i18n
  - 断言：Bash 命令名、Python 脚本名或程序名、代码和参数未新增；stdout/stderr、路径、错误码、顺序与截断逐值不变；`STATUS_ONLY` 和 `SUMMARY` 不获得详情
  - 验证：`frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetails.test.ts`；预期详情边界和证据值全部通过
  - 完成证据（2026-08-06）：Python DETAIL 精确断言标题、摘要、退出码、stdout 标签和 `CELL_OK 42ms` 原证据；脚本名、代码和参数负例通过；定向前端共 66 项及 build 通过

## 5. 集成、宿主与完整门禁

- [x] 5.1 新增 `packages/agent-app/tests/capability-public-identity-composition.test.ts`，验证普通 Tool 与 Agent/Skill wrapper 从 tool loop → timeline → channel 的完整身份路径，并覆盖 Workflow 节点直接身份、旧 history、映射缺失降级、三档结果、RAG 和 AskUserQuestion 不变
  - 验证：根目录运行 `npm test -- packages/agent-app/tests/capability-public-identity-composition.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`
  - 完成证据（2026-08-06）：release 配置下完整身份链与结果呈现 characterization 共 92 项通过；公开投影不包含 wrapper 原始参数，Workflow 只产生直接 Skill 节点身份

- [x] 5.2 新增 `frontend/agent-web/tests/e2e/capability-business-language.spec.cjs`，在 local、immersive、collaborative 三种交付宿主分别验证内置 Tool、Agent/Skill 目标名称、Workflow 直接节点、未配置映射降级、刷新 history、无摘要和 DETAIL 证据不变
  - 非目标断言：不加入运行时语言切换、命令名或脚本名旅程，不因业务标题增加或删除 Workflow 外层/内层条目
  - 验证：`frontend/agent-web` 运行 `npx playwright test tests/e2e/capability-business-language.spec.cjs --config=playwright.config.cjs` 和 `npm run build:vite:modes`
  - 完成证据（2026-08-06）：三宿主 Playwright 3 项通过；local 当前英文、immersive/collaborative 当前中文均按各自宿主语言呈现；刷新、未知 ID 降级、无摘要和 Python DETAIL 边界通过；三宿主产物构建通过

- [x] 5.3 运行 change 全量门禁并逐条记录结果：根目录 `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；`frontend/agent-web` 运行 `npm run build`、相关 `npm test`、`npm run build:vite:modes` 与 5.2 Playwright
  - 判定：change-caused failure 必须修复并重跑；既有基线噪声必须记录精确失败项和与本 change 的关系，不能用概括性“测试通过”代替
  - 完成证据（2026-08-06）：本 change 的 OpenSpec 严格校验通过；全仓 272/273，仅既有 `fix-skill-projection-diagnostics` 失败；后端测试 1629 通过、架构测试 280 通过且无依赖违规；前端 build、三宿主 build、66 项定向测试和 3 项 Playwright 通过。后端 typecheck/build 仅剩既有 `agent-log` 导出与 Skill projection 测试类型失败；contract 356/357，仅剩既有 `modelParams` 八字段断言失败；本 change 产生的门禁失败已修复并重跑确认

- [x] 5.4 对最终实现执行 `$nextagent-code-review`，覆盖 Frozen core contract、browser ownership、三宿主一致性、Security、OpenSpec consistency、Clean Code、无新增原始披露和全部验证证据
  - 验证：P0/P1 修复后重审；最终结论必须为 `PASS` 或 `PASS WITH FOLLOW-UP`
  - 完成证据（2026-08-06）：`nextagent-skill-review` 对 change/roadmap 结论 PASS；`nextagent-code-review` 未发现 P0/P1/P2，修复一项 started 安全降级丢失合法 `capabilityKind` 的局部一致性问题并以 RED/GREEN 测试确认；最终结论 `PASS WITH FOLLOW-UP`，follow-up 仅为 5.3 已记录的仓库既有全局门禁失败

- [x] 5.5 同步最新 `main` 后补齐业务标题测试矩阵，并修复无正文降级路径丢失合法公开身份的合并回归
  - 自动化覆盖：全部 15 个平台内置映射的中英文标题、普通扩展 Tool 命中/未命中、Agent/Skill/Workflow wrapper 命中/未命中/目标缺失、直接资源命中/未命中、Workflow 外层与内层父子标题、主过程卡与“完整过程”统一标题、三宿主刷新历史
  - 契约覆盖：普通 Tool、Plugin Tool、三类 wrapper 和 Workflow Skill/Subflow 节点从 tool loop 到 Web channel 的身份链；引用过程消息不可用时保留合法身份并只降级正文
  - 完成证据（2026-08-06）：身份降级测试 RED 2 项后 GREEN 8 项；“完整过程”旧技术标题 RED 1 项后改为复用集中 resolver；后端受影响测试 343 项、前端标题/过程/详情测试 201 项、三宿主 Playwright 3 项通过

- [x] 5.6 补齐配置化方案交付前的集成开发说明，在能力扩展指南集中说明当前构建期映射入口、公开身份、双语资源、标题边界、兼容降级和构建验证，并从插件指南链接该唯一说明
  - 保持：不把 Issue #661 跟踪的 AICOConfig 配置化描述为已实现能力，不修改 Capability 注册、Plugin metadata、后端名称或运行时配置边界
  - 验证：检查文档中的实现路径、导出名称和 i18n 资源路径均存在；运行 `openspec validate refine-capability-process-business-language --strict`
  - 完成证据（2026-08-06）：能力扩展指南已覆盖 Tool、Agent、Skill、Workflow 的命中/未命中规则和重新构建要求；插件指南只链接唯一说明，未复制形成第二份配置契约

## 归档前更新基线检查（非实施任务）

实现和验证完成后，按 design 的“长期基线刷新计划”更新长期 spec、Function/Feature、architecture、modules 和 spec-to-design-map；确认 `capabilityKind`、`targetCapabilityId`、前端集中映射与统一降级各自只有一个规范性来源，未把运行时语言切换、Bash/Python 执行目标披露、RAG 结果调整、后端业务名称或新的 Provider 注册路径带入本 change。
