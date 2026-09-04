# @nextagent/agent-app-frontend-hosting

## 职责

- Provide the Fastify `frontendHostingPlugin` used by `agent-app` when the trusted package profile is `with-frontend`.
- Validate the packaged frontend hosting manifest at runtime before serving static assets.
- Serve packaged frontend static files and SPA fallback without taking ownership of backend API, stream, WebSocket, or control routes.

## 非职责

- Does not select the active package profile.
- Does not consume `frontend/agent-web` source files or frontend-private paths.
- Does not own `agent-channel-web` transport, stream projection, runtime lifecycle, or canonical facts.
- Does not perform release/build/package orchestration.

## Public exports

- `frontendHostingPlugin`
- `validateFrontendHostingManifest`
- `FrontendHostingManifest`
- `ValidatedFrontendHostingManifest`

## Allowed dependencies

- Fastify types and route registration APIs.
- Runtime schema/path validation helpers.
- Node.js filesystem and path APIs for serving already-packaged static assets.

## Forbidden dependencies

- `@nextagent/agent-app` or other implementation owners.
- `@nextagent/agent-web` or `frontend/agent-web` source paths.
- `agent-channel-web` route registration or stream projection internals.
