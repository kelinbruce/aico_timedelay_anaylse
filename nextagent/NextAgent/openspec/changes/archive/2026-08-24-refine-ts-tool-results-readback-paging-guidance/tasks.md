## 1. FN-4.6 分页查看大结果

- [x] 1.1 Raise the dedicated `tool-results/*` readback budget to 65,536 bytes while preserving the configured `workspaceFiles.maxTextBytes` lower cap.
  Validation: `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/read-capability.test.ts`.

- [x] 1.2 Ensure `PAGING_REQUIRED` includes safe actionable details: `suggestedLimit`, `byteBudget`, requested `limit`, `offset`, `sliceBytes`, and max-line evidence.
  Validation: `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/read-capability.test.ts`.

- [x] 1.3 Compute retry guidance from the actually selected line count, not only the requested `limit`, and keep the `limit=1` bounded-head escape hatch.
  Validation: `npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/read-capability.test.ts`.

## 2. 共享验证

- [x] 2.1 Update `large-content-readback` delta for the 64 KiB `tool-results` budget and actionable `PAGING_REQUIRED` requirement.
  Validation: `npx.cmd openspec validate refine-ts-tool-results-readback-paging-guidance --strict`.
