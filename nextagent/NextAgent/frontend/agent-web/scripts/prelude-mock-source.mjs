export function createPreludeMockSource(options = {}) {
  const piuEntry = options.piuEntry ?? '/src/entries/piu.tsx';
  const defaultVersion = options.defaultVersion ?? '0.1.0';

  return `
(function installPrelMock() {
  if (window.Prel) {
    return;
  }

  var registry = new Map();
  var site = {
    locale: "zh-cn",
    theme: "lightday",
    session: { csrfToken: "dev-csrf-token" },
    user: { id: "dev-user", name: "Developer", ops: null }
  };

  function ensureMenu() {
    var hostMode = document.body.getAttribute("data-nextagent-host-mode");
    if (hostMode !== "collaborative") {
      document.body.removeAttribute("data-nextagent-prel-menu-layout");
      var existingMenu = document.getElementById("prel-mock-menu");
      if (existingMenu) {
        existingMenu.remove();
      }
      return;
    }

    document.body.setAttribute("data-nextagent-prel-menu-layout", "flow");
    if (document.getElementById("prel-mock-menu")) {
      return;
    }
    var style = document.createElement("style");
    style.textContent = [
      "#prel-mock-menu{position:relative;z-index:1100;width:100%;height:63.2px;flex:0 0 63.2px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;box-sizing:border-box;background:#111827;color:#fff;font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 1px 0 rgba(255,255,255,.08)}",
      "#prel-mock-menu-title{font-weight:700}",
      "#prel-mock-menu-right{display:flex;align-items:center;gap:10px;min-height:40px}",
      "#ai-agent-container{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px}"
    ].join("");
    document.head.appendChild(style);

    var menu = document.createElement("header");
    menu.id = "prel-mock-menu";
    menu.innerHTML = '<span id="prel-mock-menu-title">Prel Test Frame</span><div id="prel-mock-menu-right"></div>';
    document.body.prepend(menu);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureMenu, { once: true });
  } else {
    ensureMenu();
  }

  function runReadyCallback(callback) {
    ensureMenu();
    callback();
  }

  function createPiu(name, version) {
    var piu = registry.get(name);
    if (piu) {
      return piu;
    }
    var handlers = {};
    piu = {
      id: name,
      name: name,
      version: version || "${defaultVersion}",
      config: {},
      deps: {},
      isBrowser: true,
      revs: { "febs.regs": "mock", "febs.server": "mock" },
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

  function injectModule(src) {
    return new Promise(function loadModule(resolve, reject) {
      var existing = document.querySelector('script[type="module"][src="' + src + '"]');
      if (existing) {
        resolve();
        return;
      }
      var script = document.createElement("script");
      script.type = "module";
      script.src = src;
      script.onload = function onLoad() { resolve(); };
      script.onerror = function onError() { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(script);
    });
  }

  window.Prel = {
    ready: function ready(callback) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function onReady() { runReadyCallback(callback); }, { once: true });
        return;
      }
      queueMicrotask(function onReady() { runReadyCallback(callback); });
    },
    autoLoad: function autoLoad(packages, version) {
      var requested = typeof packages === "string" ? Object.fromEntries([[packages, version || "*"]]) : packages || {};
      if (Object.prototype.hasOwnProperty.call(requested, "AICOPIU")) {
        return injectModule("${piuEntry}");
      }
      return Promise.resolve();
    },
    start: function start(name, version, _deps, callback) {
      var piu = createPiu(name, version);
      callback(piu, site);
    }
  };

  window.__AIAgentPiuMockPrel = {
    registry: registry,
    site: site,
    getPiu: function getPiu(name) { return registry.get(name); }
  };
}());
`;
}
