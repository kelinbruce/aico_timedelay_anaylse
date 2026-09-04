## 1. 已完成的共享投影基础

- [x] 1.1 在 `agent-app` 建立启动期 `capability-result-presentation` 配置 owner、校验/冻结路径和窄 `CapabilityResultPresentationPolicy` 注入，local configured、trusted product 和 IR Web 注册路径获得同一快照，不修改 `agent-contracts` 或 Gateway
  来源：design “启动配置与窄策略投影”“明确不修改的边界”
  已有证据：`packages/agent-app/tests/capability-result-presentation-config.test.ts`、`packages/agent-app/tests/configuration-composition.test.ts` 和架构门禁已覆盖 owner 与注入路径

- [x] 1.2 在 `agent-channel-common` 建立身份优先、schema 白名单、平台安全上限与集成级别取最小值的唯一 projector，live、run-event history、SSE 和 WebSocket 复用该入口；CLIP raw→safe 也必须由该 owner 根据可信 `CLIP_STREAM_V1` 分类完成，不能保留 core/channel 双 projector
  来源：design “一个共享的后端结果 projector”
  验证：普通内置类别由共享 projector 测试覆盖；真实 CLIP completion + Message、伪造 safeResult 降级、普通 CUSTOM 不分类、未知 classifier 拒绝、completion 禁止正文和 live/history 等价均已覆盖；core 只写可信 classifier，raw→safe 仅保留在 channel-common；`CLIP_STREAM_V1` 由 `agent-common` 单一导出并由 core/runtime/channel 共用，4 files / 115 tests 与四个受影响 package build 通过

- [x] 1.3 收敛 conversation/share/process history 职责：非 AskUserQuestion Capability Result Message 的 public `content` 固定为空且 metadata 使用严格 allowlist，share 排除普通 Capability Result Message，Agent Web 不再从 raw `content` 构造过程详情，run-event history 继续服务端投影
  来源：`Capability 结果的用户可见投影由可信后端统一产生`
  验证：conversation content、严格 metadata allowlist、share 原文排除和前端禁止 raw 重建均有敏感哨兵 negative tests；用户问题、最终答案及 AskUser bounded compatibility 保持不变

- [x] 1.4 建立 500 步历史零逐结果请求、run history 并发 4、自动目标 16 和同 run 去重的基线，并覆盖 Read/Skill 形状碰撞与三宿主刷新等价
  来源：`大结果历史浏览不得产生逐结果请求放大`、`普通 Read 与内部资源读取被正确区分`
  已有证据：`frontend/agent-web/tests/e2e/process-history-capacity.spec.cjs`、`process-message-event-projection.spec.cjs`、`process-history-modes.spec.cjs`

## 2. 三策略、全工具类别与 Skill 激活覆盖收敛

- [x] 2.1 为启动配置建立失败优先测试：只接受 `STATUS_ONLY` / `SUMMARY` / `DETAIL`，默认为 `SUMMARY`，`Rag=SUMMARY` 且其余内置策略基线符合 spec，集成方 exact rule 只覆盖同名基线项或添加扩展 Tool 项，`HIDDEN`、重复/未知/越界输入阻止 ready
  来源：`Capability 结果呈现策略受平台安全上限约束`
  验证：保留既有默认值、覆盖、`HIDDEN` 拒绝和 128 Unicode code point 边界证据；新增 `Rag=SUMMARY` 断言必须先在旧默认下失败，实施后同一命令全部通过

- [x] 2.2 修改 `agent-app` 配置 schema 和冻结策略，删除 `HIDDEN`，设置 `SUMMARY` 默认与 spec 定义的内置工具策略基线（含 `Rag=SUMMARY`），让集成方规则按精确 `capabilityId` 覆盖基线同名项或添加扩展项，不修改通用 config merge，不引入动态 API、按用户策略或 Gateway 持久化
  来源：design “启动配置与窄策略投影”“明确不修改的边界”
  验证：2.1 命令 2 files / 13 tests 全部通过；`rg -n 'HIDDEN' packages/agent-app/src packages/agent-app/config` 无命中（命令按无匹配语义返回 1），确认产品配置路径已删除该合法值

- [x] 2.3 建立共享 projector 的数据驱动三策略矩阵，覆盖 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow`、`TodoWrite`、`Cron`、AskUser accepted-answer 三档等价、`Rag`、`Skill`、`Agent`、内部 `ApiCall`、可信分类 CLIP 和 unknown/custom，并对平台内置摘要验证 `safeSummaryCode` / `safeSummaryArgs` 白名单
  来源：design “验证策略”第 2 层
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts` 最终 1 file / 50 tests 通过；表驱动矩阵逐类覆盖三策略、safe failure、invalid shape，并用 Read、Bash、Glob、ToolSearch、RAG、TodoWrite、Workflow、Cron、CLIP 的过量正文/列表验证 4,000 字符、50 项和敏感字段清除；Workflow 的超长名称、未知/超长状态均降级为 `STATUS_ONLY`，失败摘要 args 固定为空闭集；实现前额外发现 TodoWrite 100 项及同步最新 main 后的 RAG 60 项未裁剪，并分别按预期失败后修复；同步新增的非 model-visible `ApiCall` 以 HTTP 敏感字段负例确认即使误入普通结果投影也只能保持 `STATUS_ONLY`

- [x] 2.4 修改 `agent-channel-common` 策略类型和唯一 projector，移除 `HIDDEN` / 成功结果 `TIMELINE_ONLY` 路径，保证所有已形成可见生命周期事实的结果至少为 `STATUS_ONLY`，保留平台安全上限优先与高级字段清除
  来源：`Capability 结果呈现策略受平台安全上限约束`
  验证：禁止项架构测试先因公开类型和 projector 残留 `HIDDEN` 按预期 1 failed / 43 passed；实现后定向命令 3 files / 66 tests 全部通过，`rg -n 'HIDDEN' packages/agent-channel-common/src` 无命中（无匹配返回 1）

- [x] 2.5 增加调用来源不变式测试：同一内置 Tool 直接调用与经 Skill `allowed-tools` 激活的投影完全一致；无安全 projector 的扩展 Tool 在 `SUMMARY` / `DETAIL` 下降级为 `STATUS_ONLY`；有受控 projector 的扩展 Tool 覆盖三策略
  来源：`工具结果投影不得因 Skill 或发现来源而变化`
  验证：新增 direct/Skill-activated Read 等价断言及 Skill id/源路径/正文负断言；使用 release config 运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts packages/agent-core/tests/targeted-skill-routing-security.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`，4 files / 97 tests 全部通过

- [x] 2.6 增加 Skill 引用拒绝的 negative integration tests，覆盖不存在、非 Tool-kind、未绑定和未授权 Capability，证明只有安全失败事实可见，无伪造成功卡或 raw Skill/工具内容
  来源：“Skill 无权激活工具时不伪造成功投影”
  验证：release config 定向 4 files / 97 tests 全部通过；既有 Context Engine/Skill Tool/targeted routing negative cases覆盖不存在、Tool/Agent kind 混淆、resolver/unbound 和 forbidden/unauthorized，本次 projector invalid/failure 矩阵补充断言 raw 结果与伪造成功详情均不会进入 Web payload

- [x] 2.7 建立 transport/history 代表矩阵，从文件、搜索、命令、结构化业务、编排、交互、受限、CLIP 和 unknown 每类选一个结果，证明 live/run-event history、SSE/WS 的级别、语言中立摘要、详情、截断与失败等价；CLIP 必须使用真实 `CAPABILITY_COMPLETED + Message`，不得伪造持久化 result delta
  来源：`Capability 结果的用户可见投影由可信后端统一产生`
  验证：新增单页九类 history/live payload 逐项相等矩阵及敏感内容负断言；release config 运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts packages/agent-channel-web/tests/workflow-result-projection.test.ts`，4 files / 42 tests 全部通过（根默认配置只收集2个文件，未误记为完整证据）

- [x] 2.8 增加 Agent Web 三策略黑盒 unit tests：`STATUS_ONLY` 无摘要/详情入口且刷新后不出现“暂无可展示摘要”，活动 status-only 步骤仍显示运行态；`SUMMARY` 按当前界面语言显示 code/args 摘要，`DETAIL` 可展开安全详情；覆盖进行中、成功、失败、空结果和截断结果，不从 raw Message 重建详情
  来源：design “验证策略”第 5 层
  验证：新增 ProcessDetails 三档黑盒、安全失败、completion-only status-only 和双语摘要用例；运行相关前端测试最终 8 files / 232 tests 全部通过，前端 build 通过；RAG 只消费后端 bounded `safeResult`，raw conversation 结果不再重建

- [x] 2.9 更新浏览器风险旅程，覆盖三种策略、Read/Skill 形状碰撞、AskUserQuestion、Skill 激活 Tool、live 刷新后 history 以及 local/immersive/collaborative 三宿主，不在 E2E 穷举所有工具组合
  来源：design “验证策略”第 6 层
  验证：在允许本地端口后启动 Vite，并用 Playwright 配置直接运行 `process-message-event-projection.spec.cjs`、`process-history-modes.spec.cjs`、`process-history-capacity.spec.cjs`，最终 14 / 14 tests 全部通过，覆盖三宿主身份碰撞、AskUserQuestion 过程、刷新恢复和 host-mode 场景；直接 runner 避免仓库 smoke wrapper 忽略文件参数而夹带无关用例

- [x] 2.10 把容量用例收敛为 500 个混合工具步骤，混排三种策略、内置 Tool、Skill 激活 Tool、已识别扩展 Tool 和 unknown/custom Tool，在打开、预览跳转、滚动条拖动、滚轮快速滚动和滚动条点击中继续断言零逐结果请求、4 并发、16 自动目标和同 run 去重
  来源：`500 个混合工具过程步骤不产生 N 加一请求`
  验证：容量夹具从单一 `networkProbe` 改为 `CustomNetworkProbe` status-only、Read summary、Skill-activated Read detail、Skill status-only 和 recognized CLIP detail 五类循环；最终指定 Playwright 旅程 14 / 14 tests 全部通过，其中 `keeps 10,000-turn process-history navigation bounded across rapid preview inputs` 通过，保留500条可见过程记录、零逐结果请求、4/16/同 run 去重断言

- [x] 2.11 更新集成配置样例与回归证据，说明三策略、内置策略基线、集成方 exact rule 覆盖语义、Skill 引用工具按实际 `capabilityId` 配置，以及扩展 Tool 无安全 projector 时的 `STATUS_ONLY` 降级
  来源：proposal “影响范围”、design “Skill 激活工具与调用来源不变式”
  验证：交付文档、`docs/用户配置和使用指导.md` 与 `docs/developer/12-deployment.md` 已共同覆盖 `Bash` / `Read` / `VendorNetworkProbe` YAML 样例、三档用户可见效果、内置基线、Skill 最终 Tool id 匹配、扩展安全上限、启动阻断条件和重启生效边界；同形配置已由 `capability-result-presentation-config.test.ts` 通过 `validateDefaultSystemConfig` 验证，合法选项只列三档，`HIDDEN` 仅作为移除/非法值说明

- [x] 2.12 为本地人工验收增加 `capability-presentation` mock 请求模式，使用既有 StreamEnvelope 依次展示 `STATUS_ONLY`、`SUMMARY`、`DETAIL`，覆盖长详情截断、敏感字段不发送、终态答案及刷新后 history 等价，不改变默认 mock 和生产路径
  来源：design “本地人工验收夹具”
  验证：先以失败测试确认旧实现仍为正常成功 `STATUS_ONLY` 补写“暂无可展示摘要”、提供空 disclosure，并把 `DETAIL` 与截断混在同一个夹具中；实现后运行 `cd frontend/agent-web && npm test -- src/features/chat/process/processDetails.test.ts src/features/chat/components/ProcessPanel.test.ts tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx tests/TurnBlock.test.tsx`，5 files / 220 tests 全部通过，`npm run build` 通过；`node --test frontend/agent-web-mock-server/tests/events.test.js` 12 / 12 tests 通过；`openspec validate govern-user-visible-capability-result-projection --strict` 通过。重新启动 `npm run dev:mock` 后输入 `[mock:capability-presentation delay=50 terminal-delay=500] 验证工具结果展示策略`，live 中观察到 CustomNetworkProbe 只有静态完成状态、Read 与 RAG 只有本地化安全摘要、第一个 Bash 为未截断有界详情、第二个 Bash 为截断有界详情；页面无敏感哨兵，刷新当前会话后五个步骤恢复一致

- [x] 2.13 以失败测试固定 AskUser accepted answer 的公开事实语义：三种配置、live、completion + Message history、conversation compatibility 返回同一 bounded answer；malformed/超预算 fail closed，`USER_INPUT_RECEIVED` 保持 answer-free，前端不生成普通 AskUser 工具卡
  来源：`Capability 结果呈现策略受平台安全上限约束` + Scenario “AskUser accepted answer 不受普通结果级别隐藏”
  验证：目标用例实现前确认 `STATUS_ONLY` 丢失答案且状态错误；实现后使用 release config 运行共享 projector、AskUser bounded projector、conversation route、run-event history 与 timeline persistence 相关测试，三档返回同一 bounded accepted answer，metadata/content 身份不一致、非法形状与超预算均 fail closed，`USER_INPUT_RECEIVED` 仍不携带 answer；前端相关 ProcessDetails 测试通过

- [x] 2.14 把 CLIP raw→safe projector 收敛到 `agent-channel-common`，core 只从可信 descriptor 写入 `CLIP_STREAM_V1`，runtime 只允许该闭集分类且继续禁止 completion 结果正文，history 从关联 Message 恢复同一安全投影
  来源：design “一个共享的后端结果 projector” + Scenario “可信 CLIP 分类恢复 live 与 history”
  验证：core 23 tests、runtime persistence 41 tests 及共享 projector/history 定向测试通过；覆盖普通 CUSTOM 不分类、伪造 CLIP safeResult 降级、未知 classifier 拒绝、completion 无正文和 live/history 深度相等

- [x] 2.15 为平台内置摘要实现闭合 `safeSummaryCode` / `safeSummaryArgs` 与兼容 `safeSummary`，后端不接收/透传上游伪造 descriptor；前端以现有 i18n 双语渲染并在语言切换时复用同一 envelope
  来源：design “一个共享的后端结果 projector” + Scenario “界面语言切换复用同一摘要语义”
  验证：共享 projector 50 tests 对已支持类别执行 code/args allowlist 与敏感哨兵矩阵；失败 descriptor 的 args 固定为空闭集；前端同一 Read SUMMARY envelope 在 zh-CN/en-US 显示对应语言，未知 code、额外参数、空白参数和超长参数均 fail closed，无网络请求

- [x] 2.16 收紧普通 Web 输出边界：conversation 的 Capability Result content 为空且 metadata 只保留 allowlist，share 排除普通 Capability Result Message，同时保留完整用户问题/最终答案和普通 conversation AskUser bounded compatibility
  来源：`Capability 结果的用户可见投影由可信后端统一产生` + Scenarios “显式请求 Capability Result Message 也不返回普通工具原文”“共享对话不携带普通工具结果原文”
  验证：`conversation-route.test.ts`、`conversation-share.test.ts` 与 `share-routes.test.ts` 使用 raw content、raw payload metadata、工具参数和敏感哨兵先失败后通过；普通 Capability Result、伪造 AskUser answer 与 `ASSISTANT_TOOL_USE` 均不会进入公开 conversation/share，durable records 不被修改

- [x] 2.17 更新 `capability-presentation` mock 的 SUMMARY code/args、RAG 默认摘要和 status-only completion-only 刷新夹具，验证中英文切换、刷新一致性和活动 status-only 动效，不在 mock 中复制后端策略算法
  来源：design “本地人工验收夹具”
  验证：mock-server 12 / 12 tests、前端相关 unit tests 和 build 通过；夹具依次覆盖 Custom STATUS_ONLY、Read SUMMARY、RAG SUMMARY、普通 Bash DETAIL、截断 Bash DETAIL，并由同一 `publicProjection` 同时形成 live delta 与 persisted completion；history 不保存 live-only result delta，刷新后五个 completion 与 live 安全投影逐项相等

- [x] 2.18 先建立共享 projector 的安全失败映射失败测试，覆盖 design 列出的已审计 `safeErrorCode + safeErrorCategory` 组合、九类 `safeErrorCategory`、一码多类冲突以 category 为准、未知 code 使用 category、缺失语义使用通用兜底、code-only degradation 不覆盖完整 Capability 失败、失败 `safeSummaryArgs` 为空以及三种成功结果策略下失败原因等价
  来源：`FN-2.4 查看请求状态` + Requirements `Capability 安全失败投影必须只陈述已确认事实`、`Capability Path Rejected Failure Visibility` + Scenarios “写入前未完整读取只显示事实原因”“未命中的错误码使用完整类别兜底”“一码多类错误不得覆盖当前类别”“路径错误码与冲突类别组合使用冲突语义”“路径错误码缺少类别时安全降级”“缺失错误语义安全降级”“code-only 降级事实不覆盖完整 Capability 失败”“三种成功结果策略不隐藏失败原因”
  验证：新增 40 个数据驱动/negative cases；在旧实现上运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts` 得到 1 file failed、20 failed / 70 passed，按预期失败于未完整读取、目标变化、平台不支持、`NOT_FOUND`、`CONFLICT`、`CANCELED`、`INTERNAL`、冲突 code/category、缺失语义、上游自由文本和 code-only notice 权威边界；实施后须运行同一定向 projector 测试并全部通过

- [x] 2.19 修改共享后端 projector，按已审计且类别一致的具体 code、完整 category、通用兜底生成闭合失败 descriptor，一码多类或冲突组合以 category 为准；停止接受上游自由文本作为主失败原因，并停止用 Event type 填充 Capability 生命周期 `payload.text`；不新增 Message/Event/Gateway 字段，不改变 Capability 失败后的模型轮次或 runtime lifecycle
  来源：design “事实性安全失败投影”“生命周期协议标识的显示边界”“明确不修改的边界” + Requirement `Capability Path Rejected Failure Visibility`
  验证：2.18 的 20 个红测全部转绿；`npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts` 为 4 files / 127 tests passed，`npm run build --workspace @nextagent/agent-channel-common` 通过；negative assertions 证明 raw exception、上游英文 summary、Event type、参数、路径、结果正文和 correlation id 不进入失败投影

- [x] 2.20 先建立 Agent Web 事实性失败卡片黑盒失败测试：默认只显示一次本地化原因，技术详情默认收起且展开后仅含安全 code/category 和本地化 status，`STATUS_ONLY` / `SUMMARY` / `DETAIL` 失败效果一致，未知 descriptor 安全降级，`CAPABILITY_STARTED` 等内部协议标识不显示；不得从错误码或 `retryable` 推导建议、自动恢复文案或 Capability 级 CTA；同时锁定已知 request terminal model failure 的阶段和有依据指导，并在无 request retry control 时不显示重试入口
  来源：`FN-2.4 查看请求状态` + Requirement `请求终态失败只在有可靠行动依据时提供指导` + Scenarios “模型认证终态失败给出可执行的管理指引”“可重试错误没有请求级重试入口时不建议重试”“未识别终态错误使用事实性通用降级” + Requirement `Capability 安全失败投影必须只陈述已确认事实` + Scenarios “平台不支持不生成无法兑现的行动建议”“技术详情默认收起且不重复原因”“模型后续动作作为新事实呈现” + Requirement `Capability 生命周期事件不得显示内部协议标识` + Scenarios “活动步骤不显示 CAPABILITY_STARTED”“未知摘要 descriptor 不直接显示”
  验证：`cd frontend/agent-web && npm test -- tests/safeSummaryPresentation.test.ts tests/processDetailsProjection.test.ts src/features/chat/components/ProcessPanel.test.ts` 在旧实现上为 3 files failed、19 failed / 85 passed，分别复现缺少事实性双语映射、上游建议文案成为主原因、失败摘要重复、默认原因不可见、三策略状态不一致和 `CAPABILITY_STARTED` 泄漏；既有 request terminal 相关基线未被改写

- [x] 2.21 实现 Agent Web 事实性失败卡片与生命周期协议标识过滤：消费后端闭合失败 descriptor，默认只显示一次本地化原因，展开后只显示安全 code/category 和本地化调用状态标签，未知 descriptor 安全降级；不从错误码或 `retryable` 推导建议、恢复文案或 Capability 级 CTA；保持已知 request terminal model failure 的阶段和有依据指导
  来源：2.20 黑盒失败测试 + `FN-2.4 查看请求状态` + Requirements `请求终态失败只在有可靠行动依据时提供指导`、`Capability 安全失败投影必须只陈述已确认事实`、`Capability 生命周期事件不得显示内部协议标识`
  验证：2.20 的 19 个红测全部转绿；`cd frontend/agent-web && npm test -- tests/safeSummaryPresentation.test.ts tests/processDetailsProjection.test.ts src/features/chat/process/processDetails.test.ts src/features/chat/components/ProcessPanel.test.ts tests/failureDetails.test.ts` 为 5 files / 151 tests passed，`npm run build` 通过；失败卡片不再显示上游建议、重复原因或协议常量，`failureDetails` 的 request terminal 模型阶段/有依据指导回归保持通过

- [x] 2.22 增加 live/run-event history、SSE/WS 与三宿主代表性回归：同一失败刷新前后保持同一原因和默认收起技术详情；code-only degradation 不覆盖、降级、改写或成为完整 Capability 卡片的第二条失败原因；失败后的真实 Read、重试或 Assistant Message 作为新事实出现，旧失败不被预告、改写或移除；没有显式交互事实时不显示用户行动入口
  来源：`FN-2.4 查看请求状态` + Requirement `Capability 安全失败投影必须只陈述已确认事实` + Scenarios “模型后续动作作为新事实呈现”“code-only 降级事实不覆盖完整 Capability 失败” + Requirement `Capability 生命周期事件不得显示内部协议标识` + Scenario “刷新后不恢复内部协议文本”
  验证：channel transport/history 定向回归为 4 files / 129 tests passed，修复 history 把自带完整安全失败事实的 completion 误判为必须关联结果 Message 的分叉；前端失败投影/组件/终态回归为 5 files / 151 tests passed；`process-history-modes.spec.cjs` 为 12 / 12，local、immersive、collaborative 均验证唯一事实原因、默认收起安全技术详情、code-only notice 分离、后续 Read 可见、无上游文案/敏感路径/Event type，并保持 200 轮大历史旅程通过

- [x] 2.23 扩展本地 `capability-presentation` 人工夹具，使用既有安全事件形状依次展示未完整读取、平台不支持、category fallback、未知语义兜底和失败后的真实后续步骤；夹具只提供已投影事实，不复制生产 projector 算法
  来源：design “事实性安全失败投影”“本地人工验收夹具”
  验证：mock-server 13 / 13 tests 覆盖四类已投影失败、失败后的真实 Read、live/history code/category/descriptor 等价以及协议标识/建议文案/敏感路径 negative assertions，前端与 channel-common build 通过；浏览器人工检查确认中文和英文四类原因各仅一次，Write 技术详情默认收起且展开仅有安全 code/category/status，刷新后恢复默认收起并保持相同原因及后续 Read；夹具未实现 code/category 映射，只复用已投影 StreamEnvelope 事实

- [x] 2.24 为真实模型验收发现的生命周期兜底泄漏和失败原因弱提示补失败测试：无安全业务正文的 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 归一化后不得生成英文协议兜底，活动 Agent 只显示本地化身份与状态；常显失败原因必须使用可读的过程正文层级，技术详情继续默认收起
  来源：Requirement `Capability 生命周期事件不得显示内部协议标识` + Scenario “活动步骤不显示 CAPABILITY_STARTED” + Requirement `Capability 安全失败投影必须只陈述已确认事实`
  验证：实现前定向前端测试为 3 files failed / 3 tests failed / 107 tests passed，分别复现归一化合成 `Capability started`、历史兼容文本进入步骤正文和失败原因未使用 14px 过程正文字号

- [x] 2.25 最小修复 Agent Web 生命周期归一化和失败原因排版：Capability lifecycle 没有安全正文时保留空正文并仅由结构化身份/状态渲染；失败原因使用过程正文样式但不改变工具标题、执行说明、技术详情字段、折叠状态或深色主题颜色 token
  来源：2.24 红测 + design “事实性安全失败投影”“生命周期协议标识的显示边界”
  验证：定向测试 3 files / 110 tests passed；扩大到 stream、三策略、安全摘要、过程投影、失败详情和 ProcessPanel 为 6 files / 173 tests passed；前端 TypeScript build 通过

- [x] 2.26 回归验证独立 `DEGRADATION_NOTICE` 与 Capability 失败事实边界，确认 code-only notice 不覆盖、不重复、不合并工具原因，live/history 与三宿主仍等价；记录 macOS Bash `PLATFORM_UNSUPPORTED` 与未配置 sandbox 的 Python `SANDBOX_UNAVAILABLE` 为本地环境边界，不修改 Capability 执行逻辑
  来源：Scenario “code-only 降级事实不覆盖完整 Capability 失败” + proposal 非目标“不中断或改变 Capability 执行”
  验证：channel transport/history 4 files / 129 tests passed；前端 `build:vite:modes` 通过；三宿主失败事实、过程交互、reduced-motion、输出交接和 200 轮历史 Playwright 为 12 / 12 passed。受限环境首次启动 Chromium 因 macOS Mach port 权限失败，获准在受限环境外以相同命令重跑通过；该环境失败未作为代码回归处理

- [x] 2.27 修复活动 Capability 的重复状态正文并收紧启动事件自由文本边界：`CAPABILITY_STARTED` 没有受治理的安全业务说明字段，只在标题显示本地化身份与执行中状态；输入归一化与过程投影均忽略任何不属于受治理字段的启动文本，模型执行说明继续由独立 `LLM_CONTENT_DELTA` 呈现，不改变 lifecycle、Event、Message、Gateway 或三宿主交互
  来源：design “生命周期协议标识的显示边界” + Requirement `Capability 生命周期事件不得显示内部协议标识` + Scenario “活动步骤不显示 CAPABILITY_STARTED”
  验证：第一阶段实现前定向投影测试为 1 file failed、2 failed / 61 passed，分别复现空业务正文被补写“执行中”和任意启动文本进入正文；契约核查确认生产 started schema 不存在安全业务说明字段后，补充输入归一化与投影双层负例，旧实现为 2 files failed、2 failed / 82 passed，收紧后为 2 files / 84 tests passed；扩大前端回归、build 和三宿主过程历史 Playwright 证据在 task 3.1 刷新

## 3. Change 整体验证

- [x] 3.1 完成 backend/frontend/OpenSpec 全量门禁与模型语义审查，确认无 P0/P1、无 Gateway/`agent-contracts` delta、无 raw Capability Message 前端产品路径，且三策略、事实性失败语义、内部协议标识防泄漏、所有已支持结果类别、Skill 激活来源、扩展降级和混合工具容量均有可重复证据
  来源：proposal “影响范围” + design “验证策略”“明确不修改的边界”
  验证：根目录 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；`frontend/agent-web` 运行 `npm run build`、相关 unit tests、`npm run build:vite:modes` 和 2.9/2.10 Playwright；运行 `openspec validate govern-user-visible-capability-result-projection --strict`、`$nextagent-skill-review`、`$nextagent-code-review`
  最终证据：已把语义差异重放到 `origin/main@a300c8dbdcf918fa1ca61b90a24e3255cbff3911`，与同步前提交执行 `git range-diff` 结果完全等价且无冲突；根 `npm run build` 通过；允许本地回环端口后根 `npm test` 为 140 files passed / 1 skipped、1552 tests passed / 2 skipped；`npm run lint:architecture` 为 45 files / 279 tests，`npm run lint:code` 为 0 errors / 17 条既有 warnings；`openspec validate --all --strict` 为 261 passed / 0 failed。`npm run test:contract` 为 41 files / 353 tests passed、3 files / 3 tests failed，并已在独立的相同 `origin/main@a300c8dbdcf918fa1ca61b90a24e3255cbff3911` 临时工作树逐项复现相同失败，分别是 provider kind 单/双引号源码断言、Workflow LLM 输出结构断言和 timeline correlation 完成事件夹具，均与本 change 零差异。change 相关后端 transport/history 4 files / 129 tests、main 兼容修正 2 files / 13 tests、前端 5 files / 152 tests、mock 13 / 13、前端 TypeScript build 和 `build:vite:modes` 均通过；指定三宿主、刷新恢复、失败事实卡、200 轮复杂历史与 10,000 轮/500 步容量 Playwright 为 17 / 17。`git diff origin/main -- packages/agent-contracts packages/agent-platform-gateway-local packages/agent-platform-gateway-remote` 为空，conversation/share negative tests 与代码差异确认浏览器不从 raw Capability Message 重建产品详情。`$nextagent-skill-review` 与 `$nextagent-code-review` 在最新 main 集成差异上结论均为 PASS：无 P0/P1，OpenSpec、owner、安全上限、三宿主和 minimal-kernel 边界一致。本轮收紧 `CAPABILITY_STARTED` 自由文本边界后，前端定向回归为 6 files / 175 tests passed，相关三宿主与大历史 Playwright 为 13 / 13，前端 TypeScript build、根 build、`build:vite:modes`、Prettier、`git diff --check` 和 261 项 OpenSpec strict validation 均通过；增量 OpenSpec 与代码语义复审仍为 PASS，无新增 P0/P1、Gateway 或 `agent-contracts` delta

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design 的“长期基线刷新计划”更新 stable spec、FN-2.4、F-2.4、stream/config/history architecture、agent-app/channel-web/agent-web modules 与 spec-to-design-map；检查长期文档只引用唯一的三级配置 schema、内置默认表、安全上限、调用来源不变式、Message/Event 职责和 projector owner，不复制平行规则。
