# NextAgent Agent Web

`frontend/agent-web` 是 NextAgent 面向用户的浏览器前端源码包。这里提供最短开发入口；产品契约以 OpenSpec 为准，完整开发说明和用户流程由仓库级前端文档统一维护。

## 目录

- `src/`：React、Ant Design 和 Zustand 实现。
- `tests/`：Vitest 单元、组件和前端契约测试。
- `tests/e2e/`：Playwright smoke 测试。

## 安装和验证

在本目录运行：

```powershell
npm install
npm run build
npm test
npm run build:vite:modes
npm run test:e2e
```

其中 `npm run build` 执行 TypeScript `--noEmit` 校验。其他命令的用途、targeted test 示例和故障定位见[前端开发指南](../../docs/frontend/development.md)。

## 文档入口

- [前端文档总览](../../docs/frontend/README.md)
- [前端开发指南](../../docs/frontend/development.md)
- [前端用户工作流](../../docs/frontend/user-workflows.md)
- [agent-web API 清单](../../docs/apis/agent-web-api-list.md)
- [当前实现架构](./ARCHITECTURE.md)
- [界面原则](./PRINCIPLE.md)
- [Stable Specs](../../openspec/specs/)
- [未归档 Changes](../../openspec/changes/)

## 权威边界

1. `openspec/specs/` 定义已归档的稳定行为。
2. `openspec/changes/` 承载尚未归档的变更；不能因代码已经存在就把 change 目标写成 Stable。
3. `ARCHITECTURE.md` 和本 README 说明当前实现与入口，不建立新的产品契约。

端口、联调方式、宿主集成和构建细节不在本文件重复维护，请使用上面的仓库级文档入口。
