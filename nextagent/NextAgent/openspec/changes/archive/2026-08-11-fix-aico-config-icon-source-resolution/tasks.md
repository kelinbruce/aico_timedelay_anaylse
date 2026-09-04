## 1. FN-10.6 前端定制

- [x] 1.1 在 `frontend/agent-web/src/aico-config/iconUtils.ts` 的 `resolveIconSrc` 函数中，在现有 `data:` / `http` 前缀判断之后，新增相对路径前缀判断（以 `/`、`./`、`../` 开头），命中时原样返回由浏览器解析；其余值仍按裸 base64 拼接 `data:image/png;base64,{value}`
  验证：`cd frontend/agent-web && npx vitest run src/aico-config/iconUtils.test.ts` 通过
  来源：spec `AICOConfig configuration type and field definitions` scenario「Relative path icon is rendered」
- [x] 1.2 补充 `resolveIconSrc` 测试：根相对路径（`/static/icons/agent.svg`）、`./` 相对路径（`./icons/agent.svg`）、`../` 相对路径（`../assets/agent.svg`）均原样返回；裸 base64 仍正确拼接；`data:` URI 和 `http`/`https` URL 仍原样返回
  验证：`cd frontend/agent-web && npx vitest run src/aico-config/iconUtils.test.ts` 全部 test case 通过
  来源：spec `AICOConfig configuration type and field definitions` scenario「Relative path icon is rendered」「Base64 icon field is rendered」
- [x] 1.3 前端构建验证：`cd frontend/agent-web && npm run build` 构建通过
  验证：构建无 error
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 design 的「长期基线刷新计划」处理：

- `openspec/specs/aico-config-contract/spec.md`：合并 icon 字段来源类型和校验规则的修改。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`：规格表补充 icon 来源格式规格项。
