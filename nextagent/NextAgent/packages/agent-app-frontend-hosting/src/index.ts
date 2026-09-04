import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';

export interface FrontendHostingManifest {
  readonly packageRoot: string;
  readonly assetRoot: string;
  readonly indexHtml: string;
  readonly routeBase: string;
  readonly spaFallback: boolean;
}

export interface ValidatedFrontendHostingManifest extends FrontendHostingManifest {
  readonly resolvedAssetRoot: string;
  readonly resolvedIndexHtml: string;
}

export interface FrontendHostingPluginOptions {
  readonly manifest: unknown;
  readonly protectedPrefixes?: readonly string[];
  readonly indexHtmlScripts?: readonly string[];
}

const manifestSchema = Type.Object(
  {
    packageRoot: Type.String({ minLength: 1 }),
    assetRoot: Type.String({ minLength: 1 }),
    indexHtml: Type.String({ minLength: 1 }),
    routeBase: Type.String({ minLength: 1 }),
    spaFallback: Type.Boolean(),
  },
  { additionalProperties: false },
);

const defaultProtectedPrefixes = ['/api', '/stream', '/ws', '/control'] as const;
const preludeLoaderPath = '/febs/v1/assets/prelude-loader';
const standalonePiuScriptPath = '/piu/AIAgentPIU.js';
const standalonePiuStylePath = '/piu/AIAgentPIU.css';

export const frontendHostingPlugin: FastifyPluginAsync<FrontendHostingPluginOptions> = async (instance, options) => {
  const manifest = validateFrontendHostingManifest(options.manifest);
  const protectedPrefixes = options.protectedPrefixes ?? defaultProtectedPrefixes;
  const indexHtmlScripts = validateIndexHtmlScripts(options.indexHtmlScripts ?? []);

  instance.setNotFoundHandler(async (request, reply) => {
    if (pathnameOf(request.url) === preludeLoaderPath) {
      reply.type('text/javascript; charset=utf-8');
      await reply.send(createStandalonePreludeLoaderSource());
      return;
    }

    if (isProtectedBackendRoute(request.url, protectedPrefixes) || !isUnderRouteBase(request.url, manifest.routeBase)) {
      await reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
      return;
    }

    const staticResponse = await tryServeStaticFile(request, reply, manifest, indexHtmlScripts);
    if (staticResponse) {
      return;
    }

    if (manifest.spaFallback) {
      await sendIndexHtml(reply, manifest.resolvedIndexHtml, indexHtmlScripts);
      return;
    }

    await reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
};

export function validateFrontendHostingManifest(raw: unknown): ValidatedFrontendHostingManifest {
  if (!Value.Check(manifestSchema, raw)) {
    const errors = [...Value.Errors(manifestSchema, raw)].map((error) => error.message);
    throw new Error(`Invalid frontend hosting manifest schema: ${errors.join(', ')}`);
  }

  const manifest = raw as FrontendHostingManifest;
  if (!isAbsolute(manifest.packageRoot)) {
    throw new Error('Invalid frontend hosting manifest: packageRoot must be absolute.');
  }
  assertPackageRelativePath(manifest.assetRoot, 'assetRoot');
  assertPackageRelativePath(manifest.indexHtml, 'indexHtml');
  assertRouteBase(manifest.routeBase);

  const packageRoot = resolve(manifest.packageRoot);
  const resolvedAssetRoot = resolve(packageRoot, manifest.assetRoot);
  const resolvedIndexHtml = resolve(packageRoot, manifest.indexHtml);
  assertInside(packageRoot, resolvedAssetRoot, 'assetRoot');
  assertInside(packageRoot, resolvedIndexHtml, 'indexHtml');
  assertInside(resolvedAssetRoot, resolvedIndexHtml, 'indexHtml');

  if (!existsSync(resolvedIndexHtml) || !statSync(resolvedIndexHtml).isFile()) {
    throw new Error('Invalid frontend hosting manifest: indexHtml must point to an existing file.');
  }

  return { ...manifest, packageRoot, resolvedAssetRoot, resolvedIndexHtml };
}

function assertPackageRelativePath(path: string, fieldName: string): void {
  const normalized = normalize(path);
  if (isAbsolute(path) || normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.split(/[\\/]/u).includes('..')) {
    throw new Error(`Invalid frontend hosting manifest: ${fieldName} must be a package-root relative path.`);
  }
}

function assertRouteBase(routeBase: string): void {
  if (
    !routeBase.startsWith('/') ||
    routeBase.includes('//') ||
    routeBase.includes('?') ||
    routeBase.includes('#') ||
    (routeBase.endsWith('/') && routeBase !== '/')
  ) {
    throw new Error('Invalid frontend hosting manifest: routeBase must be a normalized absolute route prefix.');
  }
}

function assertInside(root: string, candidate: string, fieldName: string): void {
  const fromRoot = relative(root, candidate);
  if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) {
    return;
  }
  throw new Error(`Invalid frontend hosting manifest: ${fieldName} escapes its allowed root.`);
}

function isProtectedBackendRoute(url: string, protectedPrefixes: readonly string[]): boolean {
  const pathname = pathnameOf(url);
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isUnderRouteBase(url: string, routeBase: string): boolean {
  const pathname = pathnameOf(url);
  return routeBase === '/' || pathname === routeBase || pathname.startsWith(`${routeBase}/`);
}

async function tryServeStaticFile(
  request: FastifyRequest,
  reply: FastifyReply,
  manifest: ValidatedFrontendHostingManifest,
  indexHtmlScripts: readonly string[],
): Promise<boolean> {
  const routeRelativePath = staticPathFor(request.url, manifest.routeBase);
  if (routeRelativePath === undefined) {
    return false;
  }

  const filePath = resolve(manifest.resolvedAssetRoot, routeRelativePath);
  assertInside(manifest.resolvedAssetRoot, filePath, 'static asset');
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  if (filePath === manifest.resolvedIndexHtml) {
    await sendIndexHtml(reply, filePath, indexHtmlScripts);
  } else {
    await sendFile(reply, filePath);
  }
  return true;
}

function staticPathFor(url: string, routeBase: string): string | undefined {
  const pathname = decodeURIComponent(pathnameOf(url));
  const withoutBase = routeBase === '/' ? pathname.slice(1) : pathname.slice(routeBase.length).replace(/^\//u, '');
  if (withoutBase.length === 0) {
    return undefined;
  }
  const normalized = normalize(withoutBase);
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

function pathnameOf(url: string): string {
  return new URL(url, 'http://nextagent.local').pathname;
}

async function sendFile(reply: FastifyReply, filePath: string): Promise<void> {
  reply.type(contentTypeFor(filePath));
  await reply.send(createReadStream(filePath));
}

function validateIndexHtmlScripts(scripts: readonly string[]): readonly string[] {
  const unique = [...new Set(scripts)];
  for (const source of unique) {
    if (!/^\/[A-Za-z0-9_./-]+\.js$/u.test(source) || source.includes('//') || source.includes('..')) {
      throw new Error('Invalid frontend hosting index script contribution.');
    }
  }
  return unique;
}

async function sendIndexHtml(reply: FastifyReply, filePath: string, scripts: readonly string[]): Promise<void> {
  if (scripts.length === 0) {
    await sendFile(reply, filePath);
    return;
  }
  const source = readFileSync(filePath, 'utf8');
  const tags = scripts.map((script) => `<script src="${script}"></script>`).join('');
  const html = source.includes('</body>') ? source.replace('</body>', `${tags}</body>`) : `${source}${tags}`;
  await reply.type('text/html; charset=utf-8').send(html);
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function createStandalonePreludeLoaderSource(): string {
  return `
(function installNextAgentStandalonePrel() {
  if (window.Prel) {
    return;
  }

  var registry = new Map();
  var site = {
    locale: "zh-cn",
    theme: "lightday",
    session: { csrfToken: "standalone-csrf-token" },
    user: { id: "standalone-user", name: "Standalone User", ops: null }
  };

  function createPiu(name, version) {
    var piu = registry.get(name);
    if (piu) {
      return piu;
    }
    var handlers = {};
    piu = {
      id: name,
      name: name,
      version: version || "0.0.0",
      config: {},
      deps: {},
      isBrowser: true,
      revs: { "febs.regs": "standalone", "febs.server": "standalone" },
      attach: function attach(_piu, nextHandlers) {
        handlers = Object.assign(handlers, nextHandlers || {});
        piu.__handlers = handlers;
      },
      emit: function emit(key, state) {
        registry.forEach(function dispatch(candidate) {
          var handler = candidate.__handlers && candidate.__handlers[key];
          if (typeof handler === "function") {
            handler(state);
          }
        });
      },
      __handlers: handlers
    };
    registry.set(name, piu);
    return piu;
  }

  function injectStyle(href) {
    if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) {
      return;
    }
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function injectScript(src) {
    return new Promise(function loadScript(resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        resolve();
        return;
      }
      var script = document.createElement("script");
      script.src = src;
      script.onload = function onLoad() { resolve(); };
      script.onerror = function onError() { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(script);
    });
  }

  window.Prel = {
    ready: function ready(callback) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", callback, { once: true });
        return;
      }
      queueMicrotask(callback);
    },
    autoLoad: function autoLoad(packages, version) {
      var requested = typeof packages === "string" ? Object.fromEntries([[packages, version || "*"]]) : packages || {};
      if (!Object.prototype.hasOwnProperty.call(requested, "AICOPIU")) {
        return Promise.resolve();
      }
      injectStyle("${standalonePiuStylePath}");
      return injectScript("${standalonePiuScriptPath}");
    },
    start: function start(name, version, _deps, callback) {
      var piu = createPiu(name, version);
      callback(piu, site);
    }
  };
}());
`;
}
