import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('app entry shell', () => {
  it('keeps index.html as the local shell without Prelude', () => {
    const html = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('runtime-config.js');
    expect(html).not.toContain('/febs/v1/assets/prelude-loader');
    expect(html).toContain('<script type="module" src="/src/entries/local.tsx"></script>');
  });

  it('defines immersive.html as the source immersive shell', () => {
    const html = readFileSync(path.resolve(process.cwd(), 'immersive.html'), 'utf8');

    expect(html).toContain('<body data-nextagent-host-mode="immersive">');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script src="/febs/v1/assets/prelude-loader"></script>');
    expect(html).toContain('<script type="module" src="/src/entries/immersive.tsx"></script>');
  });

  it('keeps immersive dev entry paths out of the hash router basename', () => {
    const immersiveApp = readFileSync(path.resolve(process.cwd(), 'src/app/ImmersiveApp.tsx'), 'utf8');

    expect(immersiveApp).toContain('<HashRouter>');
    expect(immersiveApp).not.toContain('basename');
    expect(immersiveApp).not.toContain('resolveImmersiveBasename');
  });

  it('defines collaborative.html as the dev/test PIU host shell', () => {
    const html = readFileSync(path.resolve(process.cwd(), 'collaborative.html'), 'utf8');

    expect(html).toContain('<body data-nextagent-host-mode="collaborative">');
    expect(html).toContain('<script src="/febs/v1/assets/prelude-loader"></script>');
    expect(html).toContain('<script type="module" src="/src/entries/collaborative.ts"></script>');
  });

  it('keeps the dev Prelude mock menu only for collaborative host-page testing', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'scripts/prelude-mock-source.mjs'), 'utf8');

    expect(source).toContain('data-nextagent-host-mode');
    expect(source).toContain('hostMode !== "collaborative"');
    expect(source).toContain('document.body.removeAttribute("data-nextagent-prel-menu-layout")');
    expect(source).toContain('existingMenu.remove()');
    expect(source).toContain('data-nextagent-prel-menu-layout", "flow"');
    expect(source).toContain('#prel-mock-menu{position:relative;');
    expect(source).toContain('flex:0 0 63.2px');
    expect(source).toContain('id="prel-mock-menu-right"');
  });

  it('keeps immersive layout free of page-owned top-menu spacing', () => {
    const immersiveApp = readFileSync(path.resolve(process.cwd(), 'src/app/ImmersiveApp.tsx'), 'utf8');
    const themeCss = readFileSync(path.resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');

    expect(immersiveApp).not.toContain('PREL_MENU_HEIGHT');
    expect(immersiveApp).not.toContain('100vh');
    expect(immersiveApp).not.toContain('marginTop');
    expect(immersiveApp).not.toContain('paddingTop');
    expect(themeCss).not.toContain('nextagent-prel-menu-height');
    expect(themeCss).not.toContain('body[data-nextagent-host-mode="immersive"][data-nextagent-prel-ready="true"] #root');
    expect(themeCss).not.toContain('body[data-nextagent-host-mode="immersive"][data-nextagent-prel-ready="true"] .immersive-shell');
    expect(themeCss).not.toContain('body[data-nextagent-host-mode="immersive"][data-nextagent-prel-menu-layout="flow"]');
  });

  it('mounts one activity controller in each main local and immersive shell, outside shared routes', () => {
    const localApp = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const immersiveApp = readFileSync(path.resolve(process.cwd(), 'src/app/ImmersiveApp.tsx'), 'utf8');

    expect(localApp.match(/<SessionActivityConnectionController \/>/g)).toHaveLength(1);
    expect(localApp).toContain('<Route path="/shared/:shareId" element={<SharedConversationPage />} />');
    expect(localApp.indexOf('<SessionActivityConnectionController />')).toBeGreaterThan(localApp.indexOf('<Route path="*"'));

    expect(immersiveApp.match(/<SessionActivityConnectionController \/>/g)).toHaveLength(1);
    expect(immersiveApp).toContain('function ImmersiveMainSurface');
    expect(immersiveApp).toContain('<Route path="/shared/:shareId" element={<SharedConversationPage />} />');
  });

  it('threads explicit conversation-surface visibility through the shared workspace', () => {
    const localApp = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const workspace = readFileSync(path.resolve(process.cwd(), 'src/app/ChatWorkspace.tsx'), 'utf8');
    const immersiveApp = readFileSync(path.resolve(process.cwd(), 'src/app/ImmersiveApp.tsx'), 'utf8');
    const piuRuntime = readFileSync(path.resolve(process.cwd(), 'src/piu/AIAgentPiuRuntime.tsx'), 'utf8');

    expect(localApp).toContain(
      "const isConversationSurfaceVisible = contentView === 'conversation' && (location.pathname === '/' || /^\\/session\\/[^/]+$/.test(location.pathname))",
    );
    expect(localApp).toContain('isConversationSurfaceVisible={isConversationSurfaceVisible}');
    expect(localApp).not.toContain('<ChatWorkspace onOpenHelp={openCommandHelp} isConversationSurfaceVisible />');
    expect(workspace).toContain('readonly isConversationSurfaceVisible: boolean');
    expect(workspace.match(/isConversationSurfaceVisible=\{isConversationSurfaceVisible\}/g)).toHaveLength(2);
    expect(immersiveApp.match(/renderConversationArea\(isConversationSurfaceVisible\)/g)).toHaveLength(2);
    expect(immersiveApp).toContain("contentView === 'complaint'");
    expect(immersiveApp).toContain("contentView === 'conversation' && isConversationRoute && !isCustomPanel");
    expect(immersiveApp).toContain('isCustomPanel ? (');
    expect(piuRuntime).toContain('const isConversationSurfaceVisible = showPanel && !minimized && !complaintHistoryOpen');
    expect(piuRuntime).toMatch(/<PiuPanelHeader\s+isConversationSurfaceVisible=\{isConversationSurfaceVisible\}/);
    expect(piuRuntime).toContain('navigation={chatNavigation}');
    expect(piuRuntime).toContain('isConversationSurfaceVisible={isConversationSurfaceVisible}');
    expect(piuRuntime).toContain('isCustomPanel');
  });
});
