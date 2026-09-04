import { create } from 'zustand';
import type { ToolMessageType } from '../chat/presentation/answerContent.ts';
import type { ReactNode } from 'react';

export const EXPAND_PANEL_DIV_ID = 'nextagent-expand-panel-container';

export type ExpandPanelContentSource = 'react' | 'dsl' | 'view' | null;

export interface ExpandPanelContent {
  readonly toolMessageType: ToolMessageType;
  readonly content: unknown;
}

export interface ExpandPanelState {
  readonly isOpen: boolean;
  readonly content: ExpandPanelContent | null;
  readonly sourceKey: string | null;
  readonly view: ReactNode | null;
  readonly contentSource: ExpandPanelContentSource;
  readonly open: () => void;
  readonly close: () => void;
  readonly openDsl: () => void;
  readonly closeDsl: () => void;
  readonly setContent: (content: ExpandPanelContent, sourceKey: string) => void;
  readonly setView: (view: ReactNode) => void;
  readonly registerDslClearHandler: (handler: (() => void) | null) => void;
}

let dslClearHandler: (() => void) | null = null;

function clearDslState(): void {
  dslClearHandler?.();
}

export const expandPanelStore = create<ExpandPanelState>((set, get) => ({
  isOpen: false,
  content: null,
  sourceKey: null,
  view: null,
  contentSource: null,
  open: () => set({ isOpen: true }),
  openDsl: () => set({ isOpen: true, contentSource: 'dsl' }),
  close: () => {
    if (get().contentSource === 'dsl') {
      clearDslState();
    }
    set({ isOpen: false, content: null, sourceKey: null, view: null, contentSource: null });
  },
  closeDsl: () => {
    set({ isOpen: false, content: null, sourceKey: null, view: null, contentSource: null });
  },
  setContent: (content, sourceKey) => {
    if (get().contentSource === 'dsl') {
      clearDslState();
    }
    set({ content, sourceKey, view: null, contentSource: 'react' });
  },
  setView: (view) => {
    if (get().contentSource === 'dsl') {
      clearDslState();
    }
    set({ view, content: null, sourceKey: null, contentSource: 'view' });
  },
  registerDslClearHandler: (handler) => {
    dslClearHandler = handler;
  },
}));
