## ADDED Requirements

### Requirement: useUserOps hook SHALL provide user ops with local/remote semantics

A `useUserOps()` hook SHALL be created in `frontend/agent-web/src/features/auth/useUserOps.ts`. It SHALL read the current host context via `useContext(AppHostContext)` and return `readonly string[] | null`. When `mode` is `"local"`, it SHALL return `null` (no restriction). When `mode` is `"immersive"` or `"piu"`, it SHALL return `host?.site?.user?.ops ?? []` (empty array when ops is missing). The hook SHALL NOT make API calls, SHALL NOT mutate state, and SHALL NOT throw when `AppHostContext` is unavailable.

#### Scenario: useUserOps returns null in local mode
- **GIVEN** `AppHostContext` with `mode="local"`
- **WHEN** `useUserOps()` is called
- **THEN** it SHALL return `null`

#### Scenario: useUserOps returns ops array in remote mode
- **GIVEN** `AppHostContext` with `mode="immersive"` and `site.user.ops=["AICOService.View", "AICOService.Write"]`
- **WHEN** `useUserOps()` is called
- **THEN** it SHALL return `["AICOService.View", "AICOService.Write"]`

#### Scenario: useUserOps returns empty array when remote ops missing
- **GIVEN** `AppHostContext` with `mode="piu"` and `site={}` (no user object)
- **WHEN** `useUserOps()` is called
- **THEN** it SHALL return `[]`

#### Scenario: useUserOps returns null when AppHostContext is unavailable
- **GIVEN** `useUserOps()` is called outside `AppProviders`
- **WHEN** the hook executes
- **THEN** it SHALL return `null` (safe fallback to local semantics)

### Requirement: AICOServiceOperation SHALL define View and Write as string enum constants

The `AICOServiceOperation` enum SHALL define two members: `View = "AICOService.View"` and `Write = "AICOService.Write"`. These SHALL correspond to the raw string values received from `HostSiteContext.user.ops`. The enum SHALL live in `frontend/agent-web/src/features/auth/authEnums.ts`. The enum SHALL NOT include any operations beyond View and Write.

#### Scenario: Enum values match Prel site context strings
- **GIVEN** the `AICOServiceOperation` enum
- **WHEN** inspecting `AICOServiceOperation.View`
- **THEN** its value SHALL be `"AICOService.View"`
- **AND** `AICOServiceOperation.Write` SHALL be `"AICOService.Write"`

### Requirement: AuthGate SHALL disable visible write operation entries when user lacks required ops

The `AuthGate` component SHALL be created in `frontend/agent-web/src/features/auth/AuthGate.tsx`. It SHALL accept `requiredOps: AICOServiceOperation[]`, `tooltipKey?: string`, and `children: ReactNode`. It SHALL retrieve ops via `useUserOps()`. When `useUserOps()` returns `null` (local mode), it SHALL render children without modification. When the user's ops contain all `requiredOps`, it SHALL render children without modification. When the user's ops lack any required op, it SHALL render children in a disabled state and wrap them with a `Tooltip` displaying the i18n text specified by `tooltipKey`. The component SHALL NOT make API calls or mutate global state.

The disabled state SHALL be applied by injecting `disabled={true}` into Antd `Button` children via `cloneElement`, or by wrapping non-Antd elements with `pointerEvents: "none"` and visual dimming. The exact mechanism MAY vary by element type but MUST prevent user interaction.

The default `tooltipKey` SHALL be `"auth.noWritePermission"` when not provided.

#### Scenario: AuthGate renders children normally in local mode
- **GIVEN** `useUserOps()` returns `null` (local mode)
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered without `disabled` and without `Tooltip`

#### Scenario: AuthGate renders children normally when user has all required ops
- **GIVEN** `useUserOps()` returns `["AICOService.View", "AICOService.Write"]`
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered without `disabled` and without `Tooltip`

#### Scenario: AuthGate disables children when user lacks required ops
- **GIVEN** `useUserOps()` returns `["AICOService.View"]`
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered in a disabled state
- **AND** a `Tooltip` SHALL be present with i18n text from `auth.noWritePermission`

#### Scenario: AuthGate disables children when user has no ops
- **GIVEN** `useUserOps()` returns `[]`
- **WHEN** `AuthGate` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered in a disabled state
- **AND** a `Tooltip` SHALL be present

### Requirement: AuthWrapper SHALL conditionally render children based on required ops

The `AuthWrapper` component SHALL be created in `frontend/agent-web/src/features/auth/AuthWrapper.tsx`. It SHALL accept `requiredOps: AICOServiceOperation[]`, `fallback?: ReactNode`, and `children: ReactNode`. It SHALL retrieve ops via `useUserOps()`. When `useUserOps()` returns `null` (local mode), it SHALL render children. When the user's ops contain all `requiredOps`, it SHALL render children. When the user's ops lack any required op, it SHALL render `fallback` if provided, or `null` if not.

#### Scenario: AuthWrapper renders children in local mode
- **GIVEN** `useUserOps()` returns `null`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered

#### Scenario: AuthWrapper renders children when user has all required ops
- **GIVEN** `useUserOps()` returns `["AICOService.View", "AICOService.Write"]`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** children SHALL be rendered

#### Scenario: AuthWrapper returns null when user lacks required ops and no fallback
- **GIVEN** `useUserOps()` returns `["AICOService.View"]`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}`
- **THEN** the component SHALL render `null`

#### Scenario: AuthWrapper renders fallback when provided
- **GIVEN** `useUserOps()` returns `["AICOService.View"]`
- **WHEN** `AuthWrapper` is rendered with `requiredOps={[AICOServiceOperation.Write]}` and `fallback={<Placeholder />}`
- **THEN** the component SHALL render `<Placeholder />`

### Requirement: ChatPage SHALL read userOps via useUserOps hook with semantic equivalence

`ChatPage.tsx` SHALL replace the hand-written ops reading (`isRemoteMode ? (host?.site?.user?.ops ?? null) : null`) with `useUserOps()`. The replacement SHALL be semantically equivalent: local mode returns `null`, remote mode with ops returns the ops array, remote mode without ops returns `[]` (was `null` in the old code, but `[]` and `null` are functionally equivalent for downstream `ShareSettingsModal` which treats both as "no allowedOps"). The `userOps` value passed to `ShareSettingsModal` SHALL remain unchanged in type and behavior.

#### Scenario: ChatPage userOps is null in local mode
- **GIVEN** `AppHostContext` with `mode="local"`
- **WHEN** `ChatPageCore` renders
- **THEN** `useUserOps()` SHALL return `null`
- **AND** `ShareSettingsModal` SHALL receive `userOps={null}`

#### Scenario: ChatPage userOps returns ops in remote mode
- **GIVEN** `AppHostContext` with `mode="immersive"` and `site.user.ops=["AICOService.View", "AICOService.Write"]`
- **WHEN** `ChatPageCore` renders
- **THEN** `useUserOps()` SHALL return `["AICOService.View", "AICOService.Write"]`
- **AND** `ShareSettingsModal` SHALL receive the same ops array

### Requirement: Write operation entries SHALL be disabled when user lacks AICOService.Write

The following write operation UI elements MUST be wrapped with `AuthGate` requiring `AICOServiceOperation.Write`. When the user does not have `AICOService.Write`, these elements SHALL be visible but disabled with a Tooltip:

1. **Send button** (`btn-send`) in `MessageInput` SHALL be disabled. The textarea (`message-textarea`) SHALL remain enabled for reading/copying text.
2. **Edit confirm button** (`btn-confirm-edit`) and **Cancel edit button** (`btn-cancel-edit`) in `MessageInput` SHALL be disabled.
3. **Stop button** (`btn-stop`) in `MessageInput` SHALL be disabled.
4. **Attach button** (`attach-button`) in `MessageInput` SHALL be disabled.
5. **Hidden file input** (`type="file"`) in `MessageInput` SHALL NOT be rendered (wrapped with `AuthWrapper`).
6. **Drag-and-drop zone** in `MessageInput` SHALL be deactivated (`onDrop`/`onDragOver` ignored).
7. **More menu reload** (`btn-more-menu` menu item `reload`) SHALL be disabled.
8. **Slash commands** `/retry`, `/edit`, and `/clear` SHALL be disabled with a permission-related `disabledReason`.
9. **New Session button** (`sidebar-new-session-shortcut`) in `Sidebar` SHALL be disabled.
10. **Session rename** (Dropdown menu item `key="rename"`) in `Sidebar` SHALL be disabled.
11. **Retry button** (`btn-retry-ai`) in `TurnBlock` SHALL be disabled.
12. **Edit button** (`btn-edit-user`) in `TurnBlock` SHALL be disabled.
13. **Like** (`annotation-like`), **Dislike** (`annotation-dislike`), and **Favorite** (`annotation-favorite`) in `TurnBlock` SHALL be disabled.
14. **Suggested question items** (`suggested-question-item`) in `SuggestedQuestions` SHALL be disabled when the click triggers a submit (`isSend: true`).

The `/help` slash command SHALL NOT be affected (it is a read operation).

Read operation UI elements SHALL remain fully functional without any restriction:
- Session list, session switching, history search, favorites list browsing in `Sidebar`.
- Message list, conversation preview navigation, run graph panel in `ChatPage`.
- Recommended questions display, skill selector display.
- Copy message content, theme/locale switching, sidebar collapse/expand, help.

#### Scenario: Send button is disabled when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** rendering `MessageInput` in remote mode
- **THEN** the element with `data-testid="btn-send"` SHALL be present but disabled
- **AND** the element with `data-testid="message-textarea"` SHALL be present and NOT disabled

#### Scenario: Attach button and file input are disabled when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** rendering `MessageInput` in remote mode
- **THEN** the element with `data-testid="attach-button"` SHALL be present but disabled
- **AND** no `<input type="file">` element SHALL be present in the DOM

#### Scenario: Drag-and-drop is deactivated when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** rendering `MessageInput` in remote mode and dragging a file over the input area
- **THEN** the drop zone SHALL NOT accept the file (no file attachment triggered)

#### Scenario: Slash write commands are disabled when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** typing `/retry`, `/edit`, or `/clear` in the composer
- **THEN** the slash command panel SHALL show these commands as disabled
- **AND** the disabledReason SHALL indicate insufficient write permission
- **AND** `/help` SHALL remain enabled

#### Scenario: New session button is disabled when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** rendering `Sidebar` in remote mode
- **THEN** the element with `data-testid="sidebar-new-session-shortcut"` SHALL be present but disabled

#### Scenario: Session rename is disabled when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** rendering `Sidebar` in remote mode and opening the session actions menu
- **THEN** the "Rename" menu item SHALL be present but disabled

#### Scenario: TurnBlock action buttons are disabled when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** rendering `TurnBlock` in remote mode
- **THEN** `btn-retry-ai` SHALL be present but disabled
- **AND** `btn-edit-user` SHALL be present but disabled
- **AND** `annotation-like` SHALL be present but disabled
- **AND** `annotation-dislike` SHALL be present but disabled
- **AND** `annotation-favorite` SHALL be present but disabled

#### Scenario: Suggested questions are disabled when user lacks Write permission
- **GIVEN** a user with ops `["AICOService.View"]`
- **WHEN** rendering `SuggestedQuestions` in remote mode
- **THEN** `suggested-question-item` elements SHALL be present but not clickable

#### Scenario: All operations are available when user has both View and Write
- **GIVEN** a user with ops `["AICOService.View", "AICOService.Write"]`
- **WHEN** rendering the full application in any remote mode
- **THEN** `btn-send` SHALL be present and NOT disabled
- **AND** `attach-button` SHALL be present and NOT disabled
- **AND** `sidebar-new-session-shortcut` SHALL be present and NOT disabled
- **AND** slash commands `/retry`, `/edit`, `/clear` SHALL be enabled

### Requirement: Application shell SHALL render unavailable state when user lacks both View and Write

When `useUserOps()` returns `[]` (remote mode, no permissions), the entire application content area SHALL render a `PermissionUnavailable` component, covering all routes including chat session pages and shared conversation pages. The `PermissionUnavailable` component SHALL display a title and description using i18n keys `auth.noPermissionTitle` and `auth.noPermissionDescription`. The sidebar, chat composer dock, shared conversation page, and PIU panel SHALL NOT render. The permission check SHALL be performed at the shell level (`ImmersiveApp` and `AIAgentPiuRuntime`), not inside individual route components.

#### Scenario: Main content renders unavailable state when user has no permissions
- **GIVEN** a user with ops `[]`
- **WHEN** rendering the application in remote mode
- **THEN** the entire application content area SHALL render the `PermissionUnavailable` component
- **AND** the chat composer dock SHALL NOT be present
- **AND** the shared conversation page SHALL NOT be present
- **AND** the immersive shell SHALL NOT be present
- **AND** the PIU panel SHALL NOT be present

#### Scenario: Local mode never renders unavailable state
- **GIVEN** `useUserOps()` returns `null` (local mode)
- **WHEN** rendering the application
- **THEN** the `PermissionUnavailable` component SHALL NOT be rendered
- **AND** the immersive shell with chat composer SHALL be present
- **AND** shared conversation pages SHALL be accessible

### Requirement: All permission提示文案 SHALL be internationalized

All user-visible permission control text SHALL be defined in i18n resource files (`zh-CN.ts` and `en-US.ts`) under the `auth` namespace. The following keys SHALL be defined in both locales:
- `auth.noWritePermission`: Tooltip text for disabled write operations, instructing the user to contact their administrator to add a role with `AICOService.Write` operation.
- `auth.noPermissionTitle`: Title for the full-page unavailable state.
- `auth.noPermissionDescription`: Description for the full-page unavailable state, instructing the user to contact their administrator to add a role with both `AICOService.View` and `AICOService.Write` operations.
- `auth.noPermissionSidebar`: Message displayed in the sidebar session list area when the user has no permissions.
- `auth.slashNoWritePermission`: `disabledReason` text for slash commands (`/retry`, `/edit`, `/clear`) when the user lacks Write permission.

#### Scenario: zh-CN contains all auth i18n keys
- **GIVEN** the zh-CN i18n resource file
- **WHEN** inspecting the `auth` namespace
- **THEN** `noWritePermission`, `noPermissionTitle`, `noPermissionDescription`, `noPermissionSidebar`, and `slashNoWritePermission` SHALL all be present with non-empty Chinese text

#### Scenario: en-US contains all auth i18n keys
- **GIVEN** the en-US i18n resource file
- **WHEN** inspecting the `auth` namespace
- **THEN** `noWritePermission`, `noPermissionTitle`, `noPermissionDescription`, `noPermissionSidebar`, and `slashNoWritePermission` SHALL all be present with non-empty English text

### Requirement: New write operation UI entries SHALL use AuthGate or AuthWrapper for permission control
When adding new UI entries that trigger backend write operations (POST/PUT/DELETE/PATCH) or initiate submit/retry/edit/cancel/annotation flows, developers SHALL wrap them with `AuthGate` (for visible entries that should be disabled with a tooltip) or `AuthWrapper` (for hidden entries that should not be rendered). This is a governance guideline enforced through code review, not through automated architecture tests or lint rules. Write operations are defined as any UI action that directly or indirectly calls `requestService`, `sessionService.renameSession`, `sessionService.createSession`, `annotationService.upsertAnnotation`, or `apiClient.post/put/delete/patch`.

#### Scenario: Code review checks for AuthGate usage on new write entries
- **WHEN** a new UI entry that triggers a backend write operation is added
- **THEN** the code review SHALL verify that the entry is wrapped with `AuthGate` or `AuthWrapper`
- **AND** if the entry is not wrapped, the reviewer SHALL request the change
