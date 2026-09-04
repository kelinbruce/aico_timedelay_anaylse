# fix-background-task-monitor-popover-clip tasks

## 1. Popover 替换

- [x] 1.1 用 Ant Design Popover 替换 position:absolute 面板（trigger=click、placement=bottomRight、受控 open/onOpenChange）。移除 Button 上手动的 onClick 切换。使用响应式宽高以兼容窄宿主。移除 position、top、right、marginTop、zIndex、border、background、boxShadow 样式。
  验证：在 frontend/agent-web 运行 npm run build 和 npm test -- --run tests/BackgroundTaskMonitorPanel.test.tsx。

- [x] 1.2 更新 Escape 关闭测试，断言 aria-expanded=false 而非 DOM 移除（Ant Popover 在 jsdom 中通过 CSS class 隐藏，而不是移除元素）。
  验证：npm test -- --run tests/BackgroundTaskMonitorPanel.test.tsx 通过 6/6。

- [x] 1.3 验证多宿主构建：npm run build:vite:modes 在 local、immersive、collaborative 下通过。
  验证：build:vite:modes 成功完成。
