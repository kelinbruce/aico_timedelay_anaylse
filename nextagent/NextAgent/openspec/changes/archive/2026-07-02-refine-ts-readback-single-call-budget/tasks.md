## 1. Readback 单次预算收敛

- [x] 1.1 在 `workspaceFiles.readText()` 为 `tool-results/*` 读回路径引入 16KB 单次文本预算，超限返回既有 `PAGING_REQUIRED`，并保留 `limit=1` 的 bounded head 语义。
  验证：`npm test -- read-capability.test.ts`
  来源：design 决策 1、2、4

- [x] 1.2 补充回归测试：默认读取 `tool-results/*` 大文件时返回 `PAGING_REQUIRED`，显式小页读取仍成功。
  验证：`npm test -- read-capability.test.ts`
  来源：proposal 变更范围；design 验证映射

## 2. OpenSpec delta

- [x] 2.1 为 `large-content-readback` 与 `ts-minimal-agent-kernel` 补充 active change delta，明确 `tool-results/*` 读回页的单次文本预算必须受更小上限约束。
  验证：`openspec validate refine-ts-readback-single-call-budget --strict`
  来源：proposal 修改的 Capability
