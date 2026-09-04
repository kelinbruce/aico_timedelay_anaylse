---
sources:
  - AGENTS.md
  - frontend/agent-web/package.json
  - openspec/designs/architecture/fullstack-packaging-boundary.md
last-verified: 2026-09-01
---

# 前端边界约束与三宿主模式

修改 `frontend/agent-web` 时必须遵守的规则。

## 前端所有权边界

**`frontend/agent-web` 只拥有：**
- 浏览器投影（渲染、布局、样式）
- 组件交互（点击、输入、拖拽）
- 本地 view state（Zustand store 中的 transient state）

**`frontend/agent-web` 不拥有：**
- Request lifecycle（归 agent-runtime）
- Canonical stream/history truth（归 agent-session + agent-runtime）
- Trusted identity（归 agent-channel-web auth boundary）
- Agent Scope / Owner Scope（归后端）
- Capability authority（归 agent-capability）
- Persistence（归 gateway）
- 业务逻辑决策

## 三宿主模式

前端支持三种宿主模式，**必须复用同一 Chat Workspace 和后端 runtime bootstrap/transport contract**。宿主入口差异不得形成平行业务语义。

| 宿主 | 入口 | 场景 | 关键差异 |
|---|---|---|---|
| `local` | `entries/local/` | 本地开发者 UI | 完整功能、localhost auth |
| `immersive` | `entries/immersive/` | 沉浸式嵌入 | 去侧边栏、专注对话 |
| `collaborative` | `entries/collaborative/` | PIU 协作嵌入 | 最小化 UI、宿主提供导航 |

### 宿主模式共享契约

- 共享 Header 和 `contained | fluid` 内容边界在三种宿主中保持一致
- 页面操作由目标页面声明
- 宿主导航由宿主拥有
- 会话跟随、历史分页和锚点定位由 conversation viewport owner 决定

## 前端技术栈

| 技术 | 用途 |
|---|---|
| React 19 | UI 框架 |
| Ant Design 5 | 组件库 |
| Zustand | 状态管理 |
| Vite | 构建 |
| i18next | 国际化 |
| Mermaid | 图表渲染 |
| @antv/g6 | 图可视化（Run Graph） |
| marked | Markdown 渲染 |
| Playwright | E2E 测试 |

## 前端关键约束

### 消息渲染

- 普通 assistant 完成态：安全 Markdown、点分标识符、不可交互任务状态
- 保留列对齐的 GFM 表格与代码语义
- 表格和 Mermaid 在窄视口内保持 `560px` 可读结构并各自横向滚动
- 所有模型返回内容复用共享响应式消息列
- 完整 main scroll viewport 与 footer surface 安全区

### Pending Input

- Pending Input 响应面与普通 Composer 互斥
- 恢复、展示型过期和 owning-request 取消委托

### Composer

- 键盘、命令和草稿交互
- 输入框 2000 字符截断与引导（超 `LONG_TEXT_THRESHOLD=2000` 时截断 + inline notice 引导使用 `.md` 附件）
- 截断不禁用发送按钮，中英文均按 1 字符计

### 附件

- 浏览器附件队列
- 文件名正则 + magic bytes 交叉验证
- zip 炍弹防护（≤512MB）+ zip slip 防护
- per-user 累计配额：200 文件 / 500MB
- 频率限制：500 次/小时
- markdown 附件强制接受（跳过扩展名白名单）

### Stream 连接

- SSE 和 WS 等价 stream transport
- stream resume/replay（含无游标 live-tail）
- stream/history consistency
- Activity SSE/WS connection 独立于 Request Execution Stream

### 前端构建与验证

| 命令 | 用途 |
|---|---|
| `cd frontend/agent-web && npm run build` | 前端 TypeScript 构建 |
| `cd frontend/agent-web && npm test -- ...` | 前端单元测试 |
| `cd frontend/agent-web && npm run build:vite:modes` | 多宿主模式构建 |
| `cd frontend/agent-web && npm run test:e2e -- ...` | E2E 测试 |

**注意**：根目录 `npm run build` 当前只复制 builtin Skill assets，**不**执行 `frontend/agent-web` TypeScript 或 Vite build。不得把它作为前端 build 证据。

## 前端目录结构速查

```
frontend/agent-web/src/
├── app/          # App 级布局和路由
├── components/   # 共享 UI 组件
├── config/       # 前端配置
├── constants/    # 前端常量
├── entries/      # 宿主模式入口 (local, immersive, collaborative)
├── features/     # 功能模块
│   ├── auth/          # 认证 UI
│   ├── chat/          # 对话工作区（主对话视图）
│   ├── composer/      # 消息输入
│   ├── expand-panel/  # 结构化内容展示
│   ├── favorites/     # 收藏管理
│   ├── memory/        # 长期记忆 UI
│   ├── knowledge/     # 知识导入/管理
│   ├── run-graph/     # Turn Run Graph 可视化
│   ├── session-activity/ # 会话活动指示
│   ├── sidebar/       # 会话列表侧边栏
│   ├── skill-selector/ # Skill 选择 UI
│   ├── welcome/       # 欢迎页高频问题
│   ├── background-tasks/ # 后台任务管理
│   ├── category-questions/ # 分类问题浏览
│   ├── complaint/     # 反馈/投诉
│   ├── guide/         # 用户引导
│   ├── share/         # 记忆分享
│   └── suggested-questions/ # 建议问题
├── host/         # 宿主集成逻辑
├── i18n/         # 国际化资源
├── pages/        # 页面级组件
├── piu/          # PIU 组件
├── services/     # API 服务层 (SSE, REST, WebSocket)
├── shortcuts/    # 键盘快捷键
├── state/        # Zustand stores
├── styles/       # 全局样式
├── utils/        # 工具函数
├── vendor/       # Vendored 依赖
└── aico-config/  # AICO 外部 UI 定制
```
