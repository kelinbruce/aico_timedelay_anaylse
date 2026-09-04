# Tasks

## 1. `FN-8.14 导入和导出长期记忆`

- [x] 1.1 先补充导入容量反馈、相同文件新批次、未知结果精确重试和个人/归档导出呈现的失败行为测试。
  来源：`FN-8.14` + Requirements `上传后必须预览、删除并确认导入`、`确认导入必须调用批量新增接口`、`导入结果必须准确报告部分成功和中断进度`、`筛选导出必须安全读取当前个人记忆结果` 及其目标 Scenarios。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/memoryTransfer.test.ts tests/i18n.test.ts --reporter=dot`；修改前目标用例失败，修改后目标用例通过。

- [x] 1.2 将导入幂等身份从文件 hash 收窄为每次文件选择生成的批次 ID，并保留原文件序号和未知结果原样重试。
  来源：`FN-8.14` + Requirement `确认导入必须调用批量新增接口` + Scenarios `确认后提交当前预览`、`重新选择相同文件建立新批次`、`结果未知时原样重试`；design“修改方案”第 1 项。
  验证：`npm exec vitest run tests/memoryTransfer.test.ts tests/MemoryManagePage.test.tsx --reporter=dot` 断言同批次键相同、不同批次键不同且未知结果请求完全一致。

- [x] 1.3 简化容量反馈，仅使用 ACTIVE 与 ARCHIVED 的 `CONFIGURED` 总数计算已有个人设定记忆数和可导入数，排除智能沉淀等非 `CONFIGURED` 记忆；客户端不替代服务端最终准入。
  来源：`FN-8.14` + Requirement `上传后必须预览、删除并确认导入` + Scenarios `显示个人可导入数量`、`容量反馈读取失败`；design“修改方案”第 2 项。
  验证：`npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 共 72/72 PASS，覆盖未过滤 Tab 总数为 100、其中 ACTIVE/ARCHIVED 的 `CONFIGURED` 总数为 38 时仍显示可导入 12 条，并验证查询过滤、下限 0 和读取失败后仍由服务端裁决。

- [x] 1.4 区分“我的记忆”和“已归档”的导出按钮与成功提示，并在共享记忆库隐藏个人导出操作。
  来源：`FN-8.14` + Requirement `筛选导出必须安全读取当前个人记忆结果` + Scenarios `导出我的记忆`、`导出已归档记忆`、`排除共享记忆库`；design“修改方案”第 4 项。
  验证：`npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 断言按钮、state 参数、实际数量提示和共享 Tab 无导出入口。

## 2. 既有 `FN-8.15` 分页语义实现修复

- [x] 2.1 删除成功后按当前 `page` 重载列表和 Tab 数量；当前页变空时复用既有逻辑回退到最后一个有效页。
  来源：`add-ts-long-memory-manage` 的 Requirement `记忆列表必须支持筛选、搜索和分页`、Requirement `已删除记忆的过期界面操作必须安全收敛`；design“修改方案”第 5 项。
  验证：`npm exec vitest run tests/MemoryManagePage.test.tsx --reporter=dot` 断言第二页删除后下一次列表请求仍使用当前 offset，且空页校正不产生第一页默认跳转。

- [x] 2.2 恢复共享展示 helper 的 Unix/Windows 宿主绝对路径脱敏，不改变 URL、相对路径和 IP 地址显示。
  来源：`add-ts-long-memory-manage` 的 Requirement `记忆只读展示必须与 Chat 使用相同敏感内容保护范围`；design“修改方案”第 7 项。
  验证：`npm exec vitest run tests/redactPathsInText.test.ts tests/redaction-presentation-consistency.test.tsx tests/MemoryManagePage.test.tsx --reporter=dot` 覆盖私有、共享、归档、Chat/Memory placeholder 一致性及允许保留的内容。

## 3. 整体验证与 review

- [x] 3.1 完成前端相关测试、前端 build、multi-host build、strict OpenSpec 校验、`git diff --check`、`nextagent-skill-review` 和 `nextagent-code-review`。
  来源：design“验证策略”与仓库验证门禁。
  验证：记录每条实际命令和结果；范围内失败未解决时不得勾选，仓库既有范围外失败必须明确列出证据和影响判断。
  验证结果（2026-08-09）：5 个前端文件、103 个测试全部通过；`npm run build`、`npm run build:vite:modes`、2 条定向 memory Playwright、change strict 校验和 `git diff --check` 通过；规格 review 为 PASS，代码 review 为 PASS WITH FOLLOW-UP。仓库全量 OpenSpec 的 3 个空 delta change 和 architecture 的 `api-call-tool.ts` runtime logging 失败均无本次文件交集，已在 review 中披露。
