import '@ant-design/v5-patch-for-react-19';
import 'antd/dist/reset.css';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { Tooltip } from 'antd';
import { loadRuntimeConfig } from '../config/runtimeConfig.ts';
import { init } from '@cloudsop/dsl-engine-web/genui-components';
import { EXPAND_PANEL_DIV_ID, expandPanelStore } from '../features/expand-panel/ExpandPanelStore.ts';
import logoSvg from '../assets/logo.svg';

export type RenderRootMode = 'local' | 'immersive' | 'piu';

let dslEngineInitialized = false;

function ensureDslEngineInit(): void {
  if (dslEngineInitialized) {
    return;
  }
  init({
    expandPanelId: EXPAND_PANEL_DIV_ID,
    handleExpandPanel: (open: boolean) => {
      if (open) {
        expandPanelStore.getState().openDsl();
      } else {
        expandPanelStore.getState().closeDsl();
      }
    },
    handleConversation: () => {},
  });
  dslEngineInitialized = true;
}

function isZhLocale(): boolean {
  try {
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/);
    return match?.[1]?.toLowerCase().startsWith('zh') === true;
  } catch {
    return false;
  }
}

const MESSAGES = {
  serviceUnavailable: { zh: '服务不可用，请稍后重试', en: 'Service unavailable, please try again later.' },
  retry: { zh: '重试', en: 'Retry' },
  reload: { zh: '重新加载', en: 'Reload' },
} as const;

export async function renderRoot(
  container: HTMLElement,
  node: ReactNode,
  options: {
    readonly mode?: RenderRootMode;
    readonly onRuntimeConfigError?: (error: unknown) => void;
  } = {},
): Promise<Root> {
  container.setAttribute('data-nextagent-root', '');
  const root = createRoot(container);
  try {
    await loadRuntimeConfig();
  } catch (error) {
    options.onRuntimeConfigError?.(error);
    if (!import.meta.env.DEV) {
      root.render(<RuntimeConfigError mode={options.mode ?? 'local'} />);
      return root;
    }
  }
  ensureDslEngineInit();
  root.render(node);
  return root;
}

export function requireRootElement(id = 'root'): HTMLElement {
  const rootElement = document.getElementById(id);
  if (!rootElement) {
    throw new Error(`Root element '#${id}' was not found.`);
  }
  return rootElement;
}

function RuntimeConfigError({ mode }: { readonly mode: RenderRootMode }) {
  if (mode === 'piu') {
    return <PiuEntranceDisabled />;
  }
  return <FullConfigError mode={mode} />;
}

function PiuEntranceDisabled() {
  const zh = isZhLocale();
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Tooltip title={zh ? MESSAGES.serviceUnavailable.zh : MESSAGES.serviceUnavailable.en} placement="bottom">
        <button
          type="button"
          data-testid="ai-agent-entrance-disabled"
          style={{
            cursor: 'not-allowed',
            opacity: 0.45,
            filter: 'grayscale(0.8)',
            width: 36,
            height: 36,
            border: 'none',
            borderRadius: '50%',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <img src={logoSvg} alt="" style={{ width: 28, height: 28 }} />
        </button>
      </Tooltip>
    </div>
  );
}

function ConfigErrorIllustration() {
  return (
    <svg width="100" height="80" viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="40" r="34" fill="#f0f5ff" stroke="#91d5ff" strokeWidth="1.5" strokeDasharray="4 3" />
      <g transform="translate(50,40)">
        <path
          d="M-15,-2.5 L-11.5,-2.5 L-10,-6.5 L-6.5,-6.5 L-5,-2.5 L-2.5,-2.5 L-2.5,-5 L2.5,-5 L2.5,-2.5 L5,-2.5 L6.5,-6.5 L10,-6.5 L11.5,-2.5 L15,-2.5 L15,2.5 L11.5,2.5 L10,6.5 L6.5,6.5 L5,2.5 L2.5,2.5 L2.5,5 L-2.5,5 L-2.5,2.5 L-5,2.5 L-6.5,6.5 L-10,6.5 L-11.5,2.5 L-15,2.5 Z"
          fill="#1890ff"
          opacity="0.85"
        />
        <circle r="4" fill="#fff" />
      </g>
      <path d="M43,12 L40,20 L45,20 L41,32 L50,22 L46,22 L49,12 Z" fill="#faad14" strokeLinejoin="round" />
    </svg>
  );
}

function FullConfigError({ mode }: { readonly mode: 'local' | 'immersive' }) {
  const isLocal = mode === 'local';
  const zh = isZhLocale();
  return (
    <main
      style={{
        width: '100%',
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: isLocal ? 40 : 32,
        fontFamily: 'var(--font-family-app, system-ui, -apple-system, sans-serif)',
        background: isLocal ? 'linear-gradient(135deg, #f9f0ff 0%, #f0f5ff 100%)' : 'linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%)',
        color: '#2c3e50',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: isLocal ? 400 : 360 }}>
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
          <ConfigErrorIllustration />
        </div>
        <p style={{ fontSize: isLocal ? 16 : 15, fontWeight: 600, marginBottom: 20, color: '#1a1a1a', whiteSpace: 'nowrap' }}>
          {zh ? MESSAGES.serviceUnavailable.zh : MESSAGES.serviceUnavailable.en}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '6px 20px',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
            border: 'none',
            fontWeight: 500,
            background: '#1890ff',
            color: '#fff',
          }}
        >
          {zh ? (isLocal ? MESSAGES.reload.zh : MESSAGES.retry.zh) : isLocal ? MESSAGES.reload.en : MESSAGES.retry.en}
        </button>
      </div>
    </main>
  );
}
