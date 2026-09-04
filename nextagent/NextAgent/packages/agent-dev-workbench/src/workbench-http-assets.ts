import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyReply } from 'fastify';

export async function sendWorkbenchAsset(assetName: string, reply: FastifyReply): Promise<FastifyReply> {
  const assetRoot = resolve(workbenchWebDistRoot(), 'assets');
  const assetCandidate = resolve(assetRoot, assetName);
  if (!isWithinDirectory(assetRoot, assetCandidate) || !existsSync(assetCandidate) || !statSync(assetCandidate).isFile()) {
    return reply.code(404).send({ error: 'AGENT_DEV_WORKBENCH_ASSET_NOT_FOUND' });
  }
  return reply.type(contentTypeForAsset(assetCandidate)).send(createReadStream(assetCandidate));
}

export function renderWorkbenchPage(): string {
  const builtPage = readWorkbenchIndexHtml();
  return builtPage ?? missingWorkbenchBuildPage();
}

export function renderWorkbenchLauncherScript(basePath: string, elementName: string): string {
  return `(() => {
  const elementName = "${elementName}";
  if (customElements.get(elementName)) return;
  class NextAgentDevWorkbenchLauncher extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: "open" });
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "调测";
      button.setAttribute("aria-label", "打开开发者调测工作台");
      const style = document.createElement("style");
      style.textContent = ":host{position:fixed;right:22px;bottom:22px;z-index:2147483000;opacity:.72;transition:opacity .16s ease,transform .16s ease}:host(:hover),:host(:focus-within),:host([data-dragging]){opacity:1;transform:scale(1.04)}button{touch-action:none;user-select:none;border:0;border-radius:999px;padding:11px 16px;background:#2563eb;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.24);cursor:grab}button:active{cursor:grabbing}button:hover{background:#1d4ed8}button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}";
      let drag;
      let dragged = false;
      const clamp = (value, max) => Math.max(0, Math.min(value, max));
      button.addEventListener("pointerdown", (event) => {
        const rect = this.getBoundingClientRect();
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
        dragged = false;
        button.setPointerCapture(event.pointerId);
        this.setAttribute("data-dragging", "");
      });
      button.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!dragged && Math.hypot(dx, dy) < 5) return;
        dragged = true;
        const rect = this.getBoundingClientRect();
        this.style.right = "auto";
        this.style.bottom = "auto";
        this.style.left = clamp(drag.left + dx, window.innerWidth - rect.width) + "px";
        this.style.top = clamp(drag.top + dy, window.innerHeight - rect.height) + "px";
      });
      const finishDrag = (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
        drag = undefined;
        this.removeAttribute("data-dragging");
      };
      button.addEventListener("pointerup", finishDrag);
      button.addEventListener("pointercancel", finishDrag);
      button.addEventListener("click", () => {
        if (dragged) { dragged = false; return; }
        const match = /^#\\/session\\/([^/?#]+)/u.exec(window.location.hash);
        const target = new URL("${basePath}", window.location.origin);
        if (match?.[1]) target.searchParams.set("sessionId", decodeURIComponent(match[1]));
        window.location.assign(target.toString());
      });
      root.append(style, button);
    }
  }
  customElements.define(elementName, NextAgentDevWorkbenchLauncher);
  const mount = () => {
    if (!document.querySelector(elementName)) document.body.append(document.createElement(elementName));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})();`;
}

function readWorkbenchIndexHtml(): string | undefined {
  const indexCandidate = resolve(workbenchWebDistRoot(), 'index.html');
  if (!existsSync(indexCandidate) || !statSync(indexCandidate).isFile()) {
    return undefined;
  }
  return readFileSync(indexCandidate, 'utf8');
}

function workbenchWebDistRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web-dist');
}

function isWithinDirectory(rootPath: string, candidatePath: string): boolean {
  const rootWithSeparator = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  return candidatePath === rootPath || candidatePath.startsWith(rootWithSeparator);
}

function contentTypeForAsset(assetName: string): string {
  switch (extname(assetName).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function missingWorkbenchBuildPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NextAgent Dev Workbench</title>
</head>
<body>
  <main style="font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; line-height: 1.5;">
    <h1>NextAgent Dev Workbench build is unavailable</h1>
    <p>Run <code>npm run build --workspace @nextagent/agent-dev-workbench</code> before opening the development workbench.</p>
  </main>
</body>
</html>`;
}
