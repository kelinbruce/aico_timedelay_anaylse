## REMOVED Requirements

### Requirement: 右侧布局宽度

**Reason**：`1080px` 最大宽度不再由会话专用 `RightPaneLayout` 独立定义；本 change 将首批 Agent Web 页面内容宽度统一归属到 `FN-10.35 呈现 Agent Web 页面布局`。

**Migration**：使用 `agent-web-page-layout` 的 `页面 Content 支持 contained 与 fluid 宽度`。会话页面选择 `contained`，其内容最大宽度继续为 `1080px`；调用方无需迁移 Web API、配置或持久化数据。
