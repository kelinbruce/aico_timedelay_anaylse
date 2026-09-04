## MODIFIED Requirements

### Requirement: Web Submit Stream And History

`agent-channel-web` SHALL 提供最小 submit、SSE stream 和 history read 行为。Web channel SHALL 只负责 transport、runtime facade 调用、runtime session-facing stream 订阅、Web DTO schema/projection 和 stream projection，不得拥有 request lifecycle、Agent routing、session contract、canonical replay truth 或 terminal history truth。

本 change 仅修改当前会话内 conversation preview/anchored read。它不得新增全局 `/search` route、session-list search DTO、stream cursor shape、后端 UI state 字段或会话列表搜索参数。

#### Scenario: Current-session preview and anchored history use runtime session facade
- **WHEN** 产品 Web API 启动
- **THEN** route registry MUST expose `GET /api/v1/sessions/{sessionId}/conversation/preview`
- **AND** route registry MUST continue exposing `GET /api/v1/sessions/{sessionId}/conversation`
- **AND** route registry MUST NOT expose global `GET /api/v1/search`, `GET /api/v1/sessions/search`, or `GET /api/v1/sessions/{sessionId}/conversation/search` in this change
- **WHEN** 客户端读取当前会话 conversation preview 或 anchored conversation history
- **THEN** channel MUST call runtime session facade
- **AND** runtime MUST resolve trusted `agentId` and call `agent-session` `UserSessionPort`
- **AND** `agent-session` MUST 将 domain conversation preview/query 映射为 gateway-owned message-store query 后调用 gateway
- **AND** public conversation query MUST use `cursor?` as the older-record cursor and map it to internal `beforeCursor`
- **AND** public conversation query MAY use `newerCursor?` to load records newer than the current newest boundary
- **AND** public conversation query MAY use `anchorMessageId?` to load a continuous visible message window containing that message
- **AND** `cursor?`, `newerCursor?`, and `anchorMessageId?` MUST NOT be combined in one request
- **AND** existing public `includeCapabilityResults?` query semantics MUST be preserved for conversation reads, default to `false`, and MAY be combined with latest, older, newer, or anchor reads without changing scope, anchor validation, window continuity, or cursor semantics
- **AND** internal conversation page MUST return optional `nextBeforeCursor` and optional `newerCursor`; channel MUST project `nextBeforeCursor` to public `nextCursor` for compatibility
- **AND** conversation response MUST return `nextCursor` for loading older records and MUST set it to null or omit it when no older records remain
- **AND** conversation response MAY return `newerCursor` for loading newer records and MUST set it to null or omit it when no newer records remain
- **AND** conversation response MUST NOT include `windowMode`
- **AND** conversation response MUST NOT include `anchor`
- **AND** anchored conversation history MUST return one continuous visible message window around the anchor message
- **AND** anchored conversation history MUST NOT stitch a latest window and an earlier window together when messages between them are not loaded
- **AND** stale、hidden、deleted、cross-owner or cross-agent `anchorMessageId` MUST fail closed and MUST NOT fall back to latest history as if anchor loading succeeded
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `cursor` and `nextCursor` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST preserve existing `beforeCursor`/`nextBeforeCursor` older-record pagination names and use `newerCursor` for newer-record pagination, and MUST NOT receive or return public conversation cursor alias names
- **AND** public `GET /api/v1/sessions/{sessionId}/conversation/preview` query MUST require explicit `limit` and MAY accept explicit `offset`
- **AND** public preview query without `offset` MUST return the latest preview marker window and report the actual effective `offset`
- **AND** public preview query MUST reject search, date, cursor, `includeCapabilityResults`, position, or search-total parameters
- **AND** public preview query MUST reject negative `offset`, non-positive `limit`, or `limit` greater than 500
- **AND** conversation preview MUST create markers only from visible USER messages in the requested session under the trusted owner and Agent scope
- **AND** conversation preview response MUST contain only `sessionId`, `totalMarkers`, `offset`, `limit`, and `markers`
- **AND** `totalMarkers` MUST represent the current-session visible USER marker count under the trusted owner and Agent scope
- **AND** each conversation preview marker MUST contain `messageId`, optional `requestId`, `createdAt`, bounded `previewText`, and `previewTruncated`
- **AND** each conversation preview marker MAY contain bounded `answerPreviewText` and `answerPreviewTruncated` only when a visible ASSISTANT message exists for the same request
- **AND** conversation preview MUST server-truncate `previewText` and `answerPreviewText` to at most 300 Unicode code points before the Web response without splitting surrogate pairs
- **AND** conversation preview MUST support sessions with more than 100 visible USER markers through valid `offset` and `limit` pages
- **AND** conversation preview MUST NOT sample markers or return random/partial marker data that does not correspond to the requested page
- **AND** conversation preview response MUST NOT include `markersComplete`, `markerLimit`, highlight、rank、position ratio、tool/Capability result text、hidden content or conversation items
- **AND** public Web API MUST NOT expose `includeHidden`
- **AND** history MUST 使用 visible `SessionMessage` records 作为最终对话内容来源
- **AND** Web channel MUST NOT reconstruct final history from stream envelopes, projection cache, or timeline replay
