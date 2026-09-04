## 0. 契约前置门禁

- [x] 0.1 确认 `configure-capability-business-names` 的两个 delta specs、Function 元数据和 Requirement 合并键保持有效，且实施代码不超出已批准的 AICOConfig 名称配置与过程标题范围
      来源：`FN-10.6 前端定制`、`FN-2.4 查看请求状态`；design `设计范围`、proposal `What Changes`
      验证：2026-08-08 在仓库根目录运行 `openspec validate configure-capability-business-names --strict`，结果为 `Change 'configure-capability-business-names' is valid`；运行 `git diff --check origin/main...HEAD`，退出码 0 且无 whitespace error

## 1. `FN-10.6 前端定制`

- [x] 1.1 先为 `capabilityBusinessNames` 写入输入边界测试，覆盖合法双语项、unsupported locale、control character、256/257 code point、1000/1001 项、重复身份首项优先和部分非法项保留其他配置；实施前运行并确认新增目标测试因字段尚未支持而失败
      来源：`FN-10.6 前端定制` + 系统质量属性“安全、可靠性/恢复、可维护性、可测试性” + Requirement `AICOConfig configuration type and field definitions`（Scenario `提供扩展 Capability 双语名称`、`名称语言 key 不受支持`）与 `AICOConfig validation uses hand-written functions`（Scenario `部分非法名称逐项过滤`、`重复身份使用首个合法条目`）
      验证：2026-08-08 在 `frontend/agent-web` 先运行 `npm test -- src/aico-config/validateAICOConfig.test.ts`，新增 7 个用例全部因字段尚未支持而失败、既有 35 个用例通过；完成 1.2 后与 store 测试合并运行，52/52 通过

- [x] 1.2 扩展既有 AICOConfig types 与 hand-written validator，使合法名称进入同一 config snapshot，非法/重复/超量项按规范逐项降级且不影响其他字段
      来源：`FN-10.6 前端定制` + Requirements `AICOConfig configuration type and field definitions`、`AICOConfig validation uses hand-written functions`、`AICOConfig default behavior when fields are absent`；design `FN-10.6 前端定制 / 修改方案`
      验证：2026-08-08 在 `frontend/agent-web` 运行 `npm test -- src/aico-config/validateAICOConfig.test.ts src/aico-config/AICOConfigStore.test.ts`，2 个 test files、52/52 tests 通过

- [x] 1.3 先建立 local 与 immersive 一次性 sessionStorage loading 测试，再把 immersive 专用 loader 收敛为共享 loader并由两个 entry 在首次 render 前各调用一次；保留 collaborative 既有完整 payload replacement
      来源：`FN-10.6 前端定制` + Requirement `AICOConfig injection paths per host mode`（Scenarios `local 与 immersive 读取同一个启动期配置`、`sessionStorage 配置缺失`、`collaborative 接收完整配置`）；design `FN-10.6 前端定制 / 修改方案`
      验证：2026-08-08 在 `frontend/agent-web` 运行包含 `src/aico-config/loadSessionStorageAICOConfig.test.ts`、`src/entries/aico-config-entry-loading.test.tsx`、`tests/piu-runtime-contract.test.tsx` 的 focused suite，验证两个 entry 首次 render 前各读取一次、parse/access failure 使用默认值、collaborative 重发完整替换；focused suite 13 files、379/379 tests 通过；运行 `npm run build:vite:modes`，multi-host page 与 PIU artifact 均构建成功

- [x] 1.4 完成 FN-10.6 focused regression，确认缺失/空配置保持默认、existing AICOConfig 字段不回归且不引入 hot update 或第二配置 store
      来源：`FN-10.6 前端定制` + Requirements `AICOConfig injection paths per host mode`、`AICOConfig default behavior when fields are absent`；design `FN-10.6 前端定制 / 修改方案`
      验证：2026-08-08 在 `frontend/agent-web` 运行包含 `src/aico-config` 的 focused suite，AICOConfig 相关 82/82 tests 通过；运行 `npm run build` 通过；人工语义检视确认只复用 `aicoConfigStore`，没有 storage listener/polling、Runtime Bootstrap、Vite env、backend config 或 parallel store delta

## 2. `FN-2.4 查看请求状态`

- [x] 2.1 先为标题 resolver 与 process builders 写入优先级测试，覆盖平台名称不可覆盖、AICOConfig 优先于构建期 mapping、当前语言缺失继续 fallback、Tool 完整标题、wrapper 模板包装、纯文本与技术标识降级；实施前运行并确认新增配置名称断言失败
      来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 必须集中维护 Capability 业务名称映射`（Scenarios `AICOConfig 配置扩展 Skill 名称`、`平台固定名称不能被配置覆盖`、`当前语言缺失时使用构建期 fallback`、`配置与构建期名称均缺失`、`名称按纯文本渲染`）
      验证：2026-08-08 在 `frontend/agent-web` 实施前运行 resolver 测试，新增 12 个配置优先级断言失败、既有 28 个通过；运行 builder RED 测试，新增 3 个配置投影断言失败、既有 41 个通过；完成 2.2 后相关 resolver、builder 与 projection tests 168/168 通过

- [x] 2.2 在 shared `TurnBlock` 派生当前 locale 的 readonly configured-name lookup，并把它显式传入 timeline/process builders 与纯标题 resolver，形成“平台 → AICOConfig → 构建期 → 安全降级”的唯一解析路径
      来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 必须集中维护 Capability 业务名称映射`；design `FN-2.4 查看请求状态 / 修改方案` 与 decision table
      验证：2026-08-08 在 `frontend/agent-web` 运行最终 focused suite，13 files、379/379 tests 通过，其中 resolver 42/42、process builder 44/44、projection 82/82、既有 TurnBlock 92/92；运行 `npm run build`，TypeScript build 通过

- [x] 2.3 增加 shared TurnBlock 的 config/locale/history 重渲染验证，确认 process 与 timeline 使用同一 lookup且不改变 entry 数量、key、顺序、状态、结果级别或 safe detail
      来源：`FN-2.4 查看请求状态` + Requirement `Agent Web 必须集中维护 Capability 业务名称映射`（Scenario `历史按当前配置重新渲染`）；design `FN-2.4 查看请求状态 / 修改方案`
      验证：2026-08-08 在 `frontend/agent-web` 运行 `tests/TurnBlock.capability-business-names.test.tsx` 与 process projection tests，确认同一 live/history identity 在 config 完整替换和 zh-CN/en-US 切换后同步重渲染，HTML/Markdown-like 名称保持纯文本；最终 focused suite 379/379 通过，且修复 legacy `toolName` 兼容后既有 TurnBlock 92/92 通过

## 3. 跨 Function 集成与文档

- [x] 3.1 验证 host input 到 shared process title 的端到端组合：local、immersive、collaborative 对同一 config/identity/locale 显示同一名称，非法配置均沿同一默认/fallback 路径且平台名称不能覆盖
      来源：`FN-10.6 前端定制`、`FN-2.4 查看请求状态`；design `跨 Function 协作与端到端流程`、`验证策略`
      验证：2026-08-08 在 `frontend/agent-web` 串行运行 `npx playwright test tests/e2e/capability-business-language.spec.cjs --config=playwright.config.cjs --workers=1`，6/6 通过，覆盖三宿主、扩展 Tool 有/无构建期映射 × 有/无 AICOConfig、platform collision、当前语言缺失、完整替换、no-hot-reload、刷新和纯文本；`npm run build:vite:modes` 通过

- [x] 3.2 更新 Capability 扩展与 plugin developer 文档，用 AICOConfig JSON 示例替换“只能修改前端源码”的当前限制，并明确 shape、优先级、语言缺失、纯文本和 no-hot-reload 边界
      来源：proposal `影响范围`；design `跨 Function 协作与端到端流程`
      验证：2026-08-08 运行 `rg -n "Issue #661|capabilityBusinessNames|构建期映射" docs/developer/05-capability-extension.md docs/developer/19-agent-plugins.md`，两处入口均指向同一 AICOConfig 主路径与构建期兼容 fallback，且不再把 #661 描述为未实现；人工检视 JSON shape、优先级、语言缺失、纯文本和 no-hot-reload 与 delta spec 一致

- [x] 3.3 使用仓库配置的 MiniMax 启动完整开发服务并执行真实页面操作 smoke，确认真实模型主路径可用；复杂标题四象限继续由确定性三宿主 fixture 验收，避免依赖模型随机选择 Tool
      来源：design `验证策略`、proposal `影响范围`
      验证：2026-08-08 使用固定 MiniMax launcher 构建、打包并启动 `/private/tmp/NextAgent-issue-661`；因不同 checkout 已占用 3000，使用临时 application overlay 仅把当前服务端口改为 3001，`/health` 返回 `UP` 且首页 200；Chromium 创建真实 session、发送固定标记请求，MiniMax 返回 `MINIMAX_REAL_SMOKE_OK`，执行详情为“已完成”、page error 为空；服务保持运行供验收

## 4. Change 整体验证

- [x] 4.1 执行 Agent Web 与架构门禁，确认 change 只触达 frontend presentation customization，不改变 backend/runtime/gateway/stream contract
      来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
      验证：2026-08-08 在 `frontend/agent-web` 运行 `npm run build`、最终 focused suite 13 files/379 tests、`npm run build:vite:modes`，全部通过；变基到 `origin/main@01120adb9` 后重新运行 change 聚焦 suite，8 files/183 tests 通过，三宿主 Playwright 6/6 通过。仓库根目录 `npm run lint:architecture` 的 dependency-cruiser 与 manifest policy 通过，architecture tests 为 46 files/292 tests 通过、1 file/1 test 失败；唯一失败来自本分支未修改的 `packages/agent-capability/src/builtins/api-call-tool.ts`，不在 `origin/main...HEAD` diff 中，记录为最新主线基线噪声。完整 MiniMax launcher 另行完成根 workspace build 与 fullstack packaging validation

- [x] 4.2 执行 OpenSpec 与 diff 完成门禁并记录基线噪声，确认 change artifacts 可实施且没有新增 strict validation failure
      来源：design `验证策略`、`长期基线刷新计划`
      验证：2026-08-08 变基到 `origin/main@01120adb9` 后，在仓库根目录重新运行 `openspec validate configure-capability-business-names --strict` 与 `git diff --check origin/main...HEAD`，均通过；运行 `openspec validate --all --strict`，307 个 change/spec 通过，仅保留本分支未修改的 `fix-conversation-preview-validation`、`fix-session-list-validation`、`fix-share-validation-error-messages` 三项最新主线基线失败，没有 change 新增的 strict validation failure

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design 的“长期基线刷新计划”同步两个 stable specs、两个 Functions、两个 Features、overview、相关 architecture/module/ADR 与 spec-to-design-map；确认 AICOConfig 字段契约只由 `aico-config-contract` 定义，标题优先级只由 `ts-run-status-visibility` 定义，且长期设计不把 backend 名称服务、hot update、执行时名称冻结或构建期 fallback 移除描述为已实现能力。
