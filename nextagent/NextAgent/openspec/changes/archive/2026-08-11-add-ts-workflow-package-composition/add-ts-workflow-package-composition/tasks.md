## 1. Package Skeleton

- [x] 1.1 创建 `packages/agent-workflow/` 及最小 exports
  验证：`npm run build`

- [x] 1.2 加入 workspace references 和 architecture rules
  验证：`npm run lint:architecture`

## 2. Composition Wiring

- [x] 2.1 在 `agent-app` 创建并注入 `WorkflowExecutionService`
  验证：`npm run test`

- [x] 2.2 wiring failure 触发 startup failure
  验证：`npm run test`

## 3. Recipe Load

- [x] 3.1 启动期扫描本地 recipe 文件
  验证：`npm run test`

- [x] 3.2 用已冻结 workflow schema 校验 recipe
  验证：`npm run test`

- [x] 3.3 合法 recipe 发布为 workflow capability，并可由 execution definition source 解析
  验证：`npm run test`

- [x] 3.4 非法 recipe diagnostic + skip
  验证：`npm run test`

- [x] 3.5 路径必须是 workspace 内相对路径
  验证：`npm run test`

## 4. 收尾

- [x] 4.1 运行验证
  验证：`npm run build && npm run test && npm run lint:architecture`

## 5. Runtime capability 语义修正

- [x] 5.1 recipe loader 保持 `RecipeDefinition` 静态资源语义，但 descriptor.kind 统一发布为 `WORKFLOW` 且不直接暴露为 model tool
  验证：`npm test`
