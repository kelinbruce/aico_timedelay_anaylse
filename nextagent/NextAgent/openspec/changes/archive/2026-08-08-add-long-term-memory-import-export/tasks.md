## 1. `FN-8.14 导入和导出长期记忆`

- [x] 1.1 为中英文模板、纯数组兼容、fatal UTF-8、5 MiB、1..50 条、严格字段 allowlist、字段长度/枚举/数量/数值边界和默认投影建立 helper 行为测试。
  来源：`FN-8.14` + Requirements `记忆导入必须使用固定 JSON 模板`、`批量导入必须在不可信 JSON 边界完成前置校验` + Scenarios `下载固定导入模板`、`模板跟随当前界面语言`、`拒绝非 JSON 文件`、`文件条目数或字段越界时拒绝`、`文件不能增加权威字段`。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/memoryTransfer.test.ts --reporter=dot`；模板与合法边界通过，非法输入整体拒绝且不产生可提交条目。

- [x] 1.2 实现 JSON 模板生成、解析、默认值投影和 `ltm-import-json-v2-<hash>-<sourceIndex>` 稳定幂等身份，删除 Excel/CSV 导入及其仅用于导入的依赖，同时保留 CSV 导出 helper。
  来源：`FN-8.14` + Requirements `记忆导入必须使用固定 JSON 模板`、`批量导入必须在不可信 JSON 边界完成前置校验`、`确认导入必须调用批量新增接口` + Scenarios `下载固定导入模板`、`文件不能增加权威字段`、`确认后提交当前预览`、`重复导入相同文件保持幂等`；design“`FN-8.14 导入和导出长期记忆` / 修改方案”第 1 至 4 项。
  验证：运行 `npm exec vitest run tests/memoryTransfer.test.ts --reporter=dot`；相同 bytes/序号键稳定，删除前序项不改变后项键，不同序号不合并，产品导入路径不再包含表格解析。

- [x] 1.3 为上传后预览、删除、清空后重新选择同名文件、取消、长文本/标签投影和确认前零写请求建立页面行为测试。
  来源：`FN-8.14` + Requirement `上传后必须预览、删除并确认导入` + Scenarios `上传后只显示预览`、`预览项使用紧凑详情样式`、`删除入口位于卡片右上角`、`多标签不挤占摘要空间`、`删除待导入项`、`清空预览后重新选择文件`。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx --reporter=dot`；用户可见 DOM、操作状态、完整 `title` 和零 batch 调用断言通过。

- [x] 1.4 实现 transient preview 与紧凑确认弹框：摘要/类型/标签/置信度同一标题行，正文两行省略，右上角删除，空态重新选择，当前 locale 模板下载。
  来源：`FN-8.14` + Requirements `记忆导入必须使用固定 JSON 模板`、`上传后必须预览、删除并确认导入`；design“`FN-8.14 导入和导出长期记忆` / 修改方案”第 2、5、9 项。
  验证：运行 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`；中文和英文投影、交互锁、长文本与多标签行为通过。

- [x] 1.5 为 ACTIVE/ARCHIVED `CONFIGURED` 容量 normal、boundary、failure 与确认时复检建立页面行为测试。
  来源：`FN-8.14` + Requirement `上传后必须预览、删除并确认导入` + Scenarios `容量摘要使用紧凑描述`、`总量超过五十条时阻止确认`；Requirement `确认导入必须调用批量新增接口` + Scenario `服务端容量和安全限制仍然生效`。
  验证：运行 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`；48+2 允许、48+3 阻止、查询失败阻止、确认复检及双语容量文案通过。

- [x] 1.6 实现容量查询、正常“导入后还可新增”摘要、单条超限警告和首次确认门禁，并保持服务端最终裁决。
  来源：`FN-8.14` + Requirements `上传后必须预览、删除并确认导入`、`确认导入必须调用批量新增接口`；design“`FN-8.14 导入和导出长期记忆` / 修改方案”第 6 项。
  验证：运行 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`；容量公式、提示去重、按钮状态和确认时查询调用通过。

- [x] 1.7 为单 batch 请求、部分成功、幂等命中提示、HTTP 4xx/404、网络/5xx/畸形响应未知结果和精确重试建立 service/page 行为测试。
  来源：`FN-8.14` + Requirements `确认导入必须调用批量新增接口`、`导入结果必须准确报告部分成功和中断进度` + Scenarios `确认后提交当前预览`、`重复导入相同文件保持幂等`、`后端未同步批量接口`、`单批部分成功`、`整批请求结果未知`、`导入期间防止重复操作`。
  验证：运行 `npm exec vitest run tests/memoryService.test.ts tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`；URL/body/响应校验、HTTP 分类、列表保留和稳定键重试通过。

- [x] 1.8 实现单次 batch 确认、结果分类、成功处理文案、未知结果精确重试和单一文件操作锁。
  来源：`FN-8.14` + Requirements `确认导入必须调用批量新增接口`、`导入结果必须准确报告部分成功和中断进度`；design“`FN-8.14 导入和导出长期记忆` / 修改方案”第 7、9 项。
  验证：运行 `npm exec vitest run tests/memoryService.test.ts tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`；请求次数、原序号顺序、错误分支、重试和操作锁通过。

- [x] 1.9 建立 ACTIVE/ARCHIVED 从 offset 0、limit 100 开始的个人记忆全量 CSV 导出历史基线；该范围与列契约由后续 1.10 按新需求替代。
  来源：`FN-8.14` 的初始导出基线；当前验收以 1.10 关联的 `筛选导出必须安全读取当前个人记忆结果` 为准。
  验证：运行 `npm exec vitest run tests/memoryTransfer.test.ts tests/MemoryManagePage.test.tsx --reporter=dot`；分页请求、CSV 内容、公式注入保护和失败零下载通过。

- [x] 1.10 先补充当前 Tab/搜索/类型/来源/更新方式筛选导出、中英文表头与枚举、记忆来源/更新时间列以及半角/全角/控制字符 CSV 注入 payload 的失败回归；再让导出从 offset 0 读取当前个人记忆 Tab 的完整筛选结果并生成本地化安全 CSV，共享 Tab 不导出
  来源：`FN-8.14` + Requirement `筛选导出必须安全读取当前个人记忆结果` + Scenarios `导出当前筛选的完整结果`、`导出超过一页的筛选结果`、`中文导出包含完整本地化列`、`公式注入载荷作为文本导出`；design“`FN-8.14 导入和导出长期记忆` / 修改方案”第 8、9 项。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/memoryTransfer.test.ts tests/MemoryManagePage.test.tsx --reporter=dot`；断言当前筛选参数、offset 0 全分页、双语 CSV、来源/更新时间和用户提供的全部注入 payload。
  验证结果（2026-08-08）：生产代码修改前，本地化列与 10 个全角/控制字符绕过断言失败，页面仍显示“导出全部”且不消费筛选；实现后 `memoryTransfer` 24/24、页面导出相关定向测试通过、前端 TypeScript build 和 change strict 通过。测试覆盖用户提供的 5 个 payload，以及半角/全角 `= - + @`、实际 NUL、Tab/零宽字符前缀和跨 100 条分页。

- [x] 1.11 将记忆管理界面和中文 CSV 中 `USER_CHARACTERISTICS` 的用户可见名称统一为“个性化配置”，保持 API 枚举值不变
  来源：`FN-8.14` + Requirement `上传后必须预览、删除并确认导入` + Scenario `中文界面统一显示个性化配置`。
  验证：页面筛选/卡片/详情/编辑/导入预览复用统一 i18n 映射，CSV 使用同名本地化映射；运行页面、导出和 i18n 定向测试。
  验证结果（2026-08-08）：生产映射修改前页面与 CSV 新断言失败；修改后页面定向测试 1/1、`memoryTransfer` 与 i18n 30/30、前端 TypeScript build 和 change strict 均通过。

## 2. 整体验证与审查

- [x] 2.1 验证 `FN-8.14` 在共享 `agent-web` 页面和 immersive/PIU 构建中保持同一行为，且不修改 `agent-contracts`、Web API wire contract、可信 scope、服务端容量裁决或持久化 owner。
  来源：proposal“Function 影响（OpenSpec Capabilities）”与“非目标”；design“`FN-8.14 导入和导出长期记忆` / 修改方案”明确不修改边界。
  验证：在 `frontend/agent-web` 运行定向 Vitest、`npm run build`、`npm run build:vite:modes`；在根目录运行 `npm run lint:architecture` 和 `git diff --check`，均为 PASS。

- [x] 2.2 完成规格和代码语义审查，并记录可重复的最终验证证据。
  来源：design“验证策略”；AGENTS.md push 门禁。
  验证：运行 `openspec validate add-long-term-memory-import-export --strict`、`openspec validate --all --strict`、`nextagent-skill-review` 和 push 前 `nextagent-code-review`；无 BLOCKER/P0/P1 后方可推送。

- [x] 2.3 对筛选与安全导出增量运行前端 build、多宿主 build、OpenSpec strict、architecture gate、diff check 和模型语义审查，并记录本轮可重复证据
  来源：design“验证策略”；AGENTS.md 实现质量门禁。
  验证：本轮定向测试、`npm run build`、`npm run build:vite:modes`、`openspec validate add-long-term-memory-import-export --strict`、`npm run lint:architecture` 和 `git diff --check` 均通过；review 无 BLOCKER/P0/P1。

## 最终验证证据

- `npx vitest run tests/memoryTransfer.test.ts tests/i18n.test.ts --reporter=dot`：PASS，2 个文件、30 个测试。
- `npx vitest run tests/MemoryManagePage.test.tsx -t "export|导出|lock" --reporter=dot`：PASS，12 个相关测试；48 个无关测试未运行。
- `npm run build`、`npm run build:vite:modes`（`frontend/agent-web`）：PASS。
- `openspec validate add-long-term-memory-import-export --strict`：PASS。
- `openspec validate --all --strict`：本变更 PASS；仓库现有 `fix-conversation-preview-validation`、`fix-session-list-validation` 因缺少 delta 失败，与本变更无文件交集。
- `npm run lint:architecture`：PASS，46 个文件、291 个测试，无 dependency violation。
- `git diff --check`：PASS。
- `nextagent-skill-review`：PASS；Function/capability 1:1、OpenSpec delta、架构 owner 和唯一实施路径一致，无 BLOCKER。
- `nextagent-code-review`：PASS；无 P0/P1/P2，前端投影边界、多宿主一致性、安全、Clean Code 与最小内核非回归检查通过。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档流程依据 design“长期基线刷新计划”更新 stable spec、`FN-8.14`、`F-8.2`、overview、memory architecture、agent-web/agent-channel-web module design 和 spec-to-design-map；不新增 ADR。
