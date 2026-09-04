## 审查结果

- **change id**：`provide-provider-backed-capability-display-names`
- **检查日期**：2026-08-12
- **状态**：PASS
- **结论**：群内已确认本 change 的 frozen contract、Session API、前端刷新与降级、AICOConfig 删除及 Gateway 不变边界。Proposal、design、六个 delta specs 与 tasks 形成单一可实施路径，并与当前实现的 owner 和依赖方向一致。

## Findings

| ID | 严重级别 | 领域 | 位置 | 问题 | 必需动作 | 处理结果 |
|---|---|---|---|---|---|---|
| C1 | BLOCKER | frozen contracts | proposal `需群内确认` | public contract 与 AICOConfig breaking 变化需要统一确认 | 按 proposal 九项确认字段、authority、failure、fallback、Gateway 与 deferred 边界 | RESOLVED；2026-08-12 群内评审通过 |
| C2 | HIGH | 无副作用读取 | design `Provider current-read SPI`、Catalog 实现 | EAGER current view 不得通过通用 `listAll` 重新枚举 Provider | current view 只调用启动期 `listCurrent` facts；未准备或缺失 reader 整体失败 | RESOLVED；focused test 断言 `listAll` 为 0 次 |
| C3 | HIGH | 核心契约依赖 | `agent-contracts/agent-assembly` | Agent assembly contract 不得反向依赖 capability subpath | Parser 复用统一 schema，assembly 保留结构等价的 source-owned type | RESOLVED；core contract 与 architecture gate 通过 |
| C4 | MEDIUM | Session 输入边界 | capability presentation route/spec | query/body 拒绝与 Session-bound Agent authority 需要同形闭合 | query/body unknown input 拒绝；header Agent 候选不得覆盖 Session `agentId` | RESOLVED；route contract tests 覆盖 |

## 需群内确认

proposal“需群内确认”九项已于 2026-08-12 一次性确认通过，无未解决确认项。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | `agent-capability` 拥有 descriptor/Catalog authority；Web 仅做安全投影；浏览器仅拥有 Session-scoped view state；`agent-app` 唯一装配 |
| core contracts | PASS | frozen contract 变化已有 OpenSpec 与群确认；Agent assembly 无 capability 反向依赖 |
| roadmap owner boundaries | PASS | 主要 owner 为 `agent-capability`，其他模块只产生事实或消费投影 |
| roadmap change rules | PASS | change 可独立验收中英文、三宿主、live/history、动态长尾和失败降级 |
| current code | PASS | 复用现有 descriptor、Catalog governance、Session authority、process projection 与三宿主共享入口 |
| engineering principles | PASS | 单一名称权威、一个 Catalog、一个 Session API、一个前端 store/resolver；无 snapshot、generation、轮询、新 event 或第二 registry |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | 六个既有 Function 分别修改其 canonical spec；无新增 Function 或多对多映射 |
| Delta/stable operation | PASS | ADDED 标题无 stable 碰撞；MODIFIED 标题与 stable 精确匹配 |
| Function 变更汇总 | PASS | 六个主规格按 Function 字段汇总，并与 Requirements 双向覆盖 |
| Requirement 元数据 | PASS | ADDED/MODIFIED Requirements 均声明需求类别并具有 Scenario |
| 触发、输入与输出 | PASS | Session create/activate、accepted acquisition、unknown identity；trusted Owner/Session/Agent Scope；winner-only safe resource |
| 核心决策逻辑 | PASS | locale fallback、winner-only、all-or-nothing current-read、last-good/confirmed-missing 与 wrapper target 规则唯一 |
| 失败和降级 | PASS | current-read 整体 safe failure；浏览器保留 last-good，无资源按 id 降级，不阻塞 event/history/answer |
| 唯一实施路径 | PASS | Provider facts → existing Catalog current view → runtime query adapter → Session Web route → shared frontend store/resolver |
| 验收示例 | PASS | 覆盖中英文、无 locales、Skill 获取、未知 identity、资源晚到、失败、迟到响应、history、三宿主与纯文本安全 |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| Feature/Function/Capability 术语 | PASS | OpenSpec capability 与 runtime Capability 含义分离 |
| canonical terminology | PASS | `displayName`、`locales.language`、`listCurrent`、current view、presentation resource、last-good 跨 artifact 一致 |
| BCP 14 与语义闭合 | PASS | 规范关键词只用于 Requirement；optional、缺失、失败和禁止副作用均可判定 |
| 黑盒/白盒边界 | PASS | specs 定义公共行为，design 定义 owner、source reader、composition 与浏览器私有调度 |
| 端到端追踪 | PASS | Feature（适用时）→ Function → Requirement → Scenario → task/test 可定位 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 创建前覆盖检查 | PASS | 核心契约已升级确认；Gateway、Bootstrap、event/history 与 persistence owner 不变 |
| release scope | PASS | 完整验收 `zh-CN`、`en-US`；其他合法 locale 只保留契约扩展能力 |
| 并行边界 | PASS | Capability、Agent assembly、Workflow、Plugin SDK、Web/frontend 写入面已明确 |
| 第一性原理/KISS/SOLID | PASS | 以当前 winner descriptor 为唯一事实，不为未来热插拔引入 generation、push 或持久化设施 |
| 基于存量代码的增量设计 | PASS | additive 扩展既有 authoring/descriptor/Catalog，仅删除已被替代的前端名称 authority |

## 验证记录

- `openspec validate provide-provider-backed-capability-display-names --strict`：PASS。
- `openspec validate --all --strict`：261 passed，0 failed。
- `npm run lint:architecture`：47 files、293 tests 全部通过。
- focused current-view、route、Plugin SDK 与前端 resource/store/coordinator/title tests：PASS。

## 建议下一步

同步最新 main 后重新执行完整 build、contract、architecture、frontend 与浏览器门禁；仅在最终语义代码检视无 P0/P1 时提交 MR。

## 最新 main 同步复审

- 已同步 `origin/main@888b1f7eb`，proposal、design、delta specs 与 tasks 的唯一实施路径不变。
- 最新 main 已删除两个旧的根目录 Skill 样例，因此产品资产验收收敛为现存 `network-explorer` Agent；Skill 中英文和 `displayName`/`capabilityId` 降级仍由隔离 fixture 验收，不恢复已删除资产。
- `openspec validate --all --strict`：250 passed，0 failed。
- 群内已确认的 public contract、Session API、刷新/降级、Gateway 不变边界均未改变，无新增确认项。
- 状态：**PASS**。
