# Design: Share Ops Hash Permission

## 第一性原理

分享权限校验的本质是：判断查看者是否拥有与创建者相同的操作权限集合。当前实现用子集判断（`allowedOps ⊆ viewerOps`）表达"查看者至少拥有创建者指定的权限"。但在远端后台存储接口的 200 元素数组约束下，完整 ops 数组无法传输和存储。

hash 方案的本质是：用一个固定长度的确定性摘要代替变长数组，在不暴露完整 ops 明文的前提下完成权限等价判断。SHA-256 摘要长度固定 64 字符（hex），无论 ops 数组多大，传输和存储的 payload 恒为长度 1 的数组。

## D1: hash 变换规则

**位置**：前端 `frontend/agent-web/src/services/shareService.ts`，对 `ShareSettingsModal` 和 `SharedConversationPage` 透明。

**算法**：
1. 去重：`new Set(ops)` 消除重复元素（ops 是权限集合，重复无语义）。
2. 排序：`Array.prototype.sort()` 默认字典序（UTF-16 code unit order），确定性排序。
3. 序列化：`JSON.stringify(sorted)` 生成确定性 JSON 字符串。
4. 摘要：`crypto.subtle.digest("SHA-256", ...)` 计算 SHA-256 摘要。
5. 编码：转 64 字符 lowercase hex 字符串。

**输入**：`readonly string[]`（用户的完整 ops 数组）。
**输出**：`Promise<string>`（64 字符 hex hash）。

**确定性保证**：相同 ops 集合（不考虑重复和顺序）始终产生相同 hash；不同 ops 集合产生不同 hash（SHA-256 碰撞概率可忽略）。

**异步**：`crypto.subtle.digest` 是异步 API，`shareService.createShare` 和 `loadSharedConversation` 已是 async 函数，直接 await。

## D2: 语义变化 — 子集判断变为 hash 相等判断

**原语义**：`allowedOps ⊆ viewerOps`（子集）。创建者可选择 ops 子集作为门槛，拥有这些 ops 的查看者均可通过。

**新语义**：`storedHash === viewerHash`（完全相等）。创建者存完整 ops 的 hash，查看者传完整 ops 的 hash，只有 ops 集合完全相同才通过。

**业务影响**：
- 同角色用户（ops 相同）可互相查看带权限分享。满足"同角色可查看"需求。
- 不同角色用户（ops 不同）无法查看。即使一个角色是另一个的超集。
- 创建者不再能选择部分权限分享（`keepPermissions` 开关变为"全量 ops hash"或"公开 null"二选一）。

**为什么不保持子集语义**：子集判断需要后端持有完整 allowedOps 和 viewerOps 两个数组。如果前端只传 hash，后端无法从 hash 还原数组做子集判断。如果前端传完整 ops 给后端做子集判断，则未解决传输约束。hash 方案与子集语义互斥，完全相等是 hash 方案的必然结果。

## D3: 架构边界

**hash 位置选择 — 前端 shareService.ts**：

选择前端而非后端的理由：200 元素约束在远端后台存储接口的传输链路上。如果后端 hash，前端仍需传完整 ops（~400 个）给后端，受传输约束阻断。前端 hash 后只传 `[hash]`（长度 1），绕过传输约束。

hash 变换是确定性数学变换（去重+排序+SHA-256），不涉及权限决策。权限决策（hash 比对）仍在后端 `ConversationShareService` 完成。前端不判断"是否有权限"，只做数据变换。这符合 `frontend/agent-web` 的浏览器投影职责边界。

**后端职责**：`ConversationShareService` 只做 hash 字符串存储和相等比对，不感知 hash 算法细节。`isOpsSubset` 替换为简单的 `storedOps[0] === viewerOps[0]` 比对。

**channel-web 职责**：transport 层不变。`createShareBody` schema 仍接受 `string[] | null`，`X-Viewer-Ops` header 仍解析 JSON 数组。只是数组内容从完整 ops 变为 hash。

## D4: 旧数据兼容

已有 `ConversationShareRecord.allowedOps` 存储的是完整 ops 明文数组（如 `["net:read", "diag:run"]`）。在新的 hash 相等校验下：
- 后端比对 `storedOps[0]`（如 `"net:read"`）与 `viewerOps[0]`（如 hash hex）。自然不匹配。
- 返回 `SHARE_FORBIDDEN`。

这是可接受的：分享是临时性的（24h/7d/30d），旧记录在有效期内会因 hash 不匹配而拒绝查看，到期后自然过期。不需要数据迁移。

极端 edge case：如果旧 `allowedOps` 恰好只有 1 个元素，且该元素的值恰好等于某查看者 ops 的 SHA-256 hash（概率可忽略），则可能误通过。这在工程上可忽略。

## D5: 安全考量

**hash 不可逆**：SHA-256 是单向函数。存储 hash 不泄露完整 ops 明文。相比原来存储完整 ops 数组，hash 方案在存储层提供了更好的隐私保护。

**碰撞风险**：SHA-256 碰撞概率为 2^-128，在工程上可忽略。不同 ops 集合产生相同 hash 的概率远低于系统故障率。

**前端篡改**：如果前端被 XSS 篡改，攻击者可传任意 hash。但原方案中攻击者也可传任意 ops 数组。hash 方案未降低安全性。后端比对逻辑不变（存储 hash vs 传来 hash），安全性依赖 `shareId` 的不可预测性，与 hash 方案无关。

**hash 算法确定性**：spec 定义 hash 变换规则（去重+排序+JSON.stringify+SHA-256+hex），确保创建和查看用同一规则。前端 `hashOps` 函数是 spec 规则的唯一实现，创建和查看共用同一函数，自然一致。

## D6: 非目标

- 不引入 hash 算法配置项。SHA-256 是固定选择。
- 不为旧 allowedOps 数据提供迁移。旧记录自然过期。
- 不改变 `keepPermissions` UI 开关语义（开=带权限分享，关=公开分享）。开关行为不变，只是"带权限"的底层从完整 ops 变为 ops hash。
- 不改变 `ConversationShareRecord.allowedOps` 的类型（仍为 `readonly string[] | null`），只改语义（从完整 ops 变为 hash）。
- 不改变 channel-web schema 的 `maxItems`（1000 已足够容纳长度 1 的数组）。
- 不改变 `X-Viewer-Ops` header 的解析逻辑（仍解析 JSON 数组），只是数组内容从完整 ops 变为 hash。
