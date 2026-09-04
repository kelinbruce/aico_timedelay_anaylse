import type { ReactNode } from 'react';

interface DSLRendererProps {
  readonly dataModel?: unknown | undefined;
  readonly response?: string | undefined;
  readonly isStreaming?: boolean | undefined;
}

interface StreamDSLContextProps {
  readonly children: ReactNode;
  readonly conversationId?: string | undefined;
  readonly local?: string | undefined;
  readonly theme?: string | undefined;
}

interface InitOptions {
  readonly instanceId?: string | undefined;
  readonly expandPanelId?: string | undefined;
  readonly handleExpandPanel?: ((isOpen: boolean) => void) | undefined;
  readonly handleConversation?: ((message: unknown) => void) | undefined;
}

export function DSLRenderer(_props: DSLRendererProps) {
  return <div style={{ padding: 12, color: '#999' }}>DSL Renderer stub (local dev only)</div>;
}

export function StreamDSLContext({ children }: StreamDSLContextProps) {
  return children;
}

export function init(_options: InitOptions): void {}
