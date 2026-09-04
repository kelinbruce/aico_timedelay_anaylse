import { closePanel, defaultDisplayState, normalizeDisplayState, openPanel, type AIAgentDisplayState } from './displayState.ts';
import {
  clampFloatingLayout,
  clampDockedWidth,
  DOCKED_DEFAULT_WIDTH,
  defaultDockedLayout,
  defaultFloatingLayout,
  floatingLayoutFromDockedLayout,
  maximizeLayout,
  resizeFloatingLayout,
  resizeFloatingFromTop,
  restoreLayout,
  type CollaborativePanelLayout,
  type DockedSide,
  type FloatingResizeDirection,
  type ViewportSize,
} from './layout.ts';
import { normalizeHostLocale, normalizeHostTheme, type HostLocale, type HostSiteContext, type HostTheme } from '../app/hostTypes.ts';
import type { PIU } from '../host/prel.ts';
import { expandPanelStore } from '../features/expand-panel/ExpandPanelStore.ts';
import { historicalChatReplayStore } from './historicalChatReplayStore.ts';
import { readAIAgentPiuActiveSessionId, writeAIAgentPiuActiveSessionId } from './activeSessionStorage.ts';

export interface SendQuestionToLuiPayload {
  readonly question: string;
  readonly isSend?: boolean;
}

export interface AIAgentPiuSnapshot {
  readonly display: AIAgentDisplayState;
  readonly layout: CollaborativePanelLayout;
  readonly site: HostSiteContext;
  readonly piu: PIU | null;
  readonly activeSessionId: string | null;
  readonly activeSessionTitle: string | null;
  readonly pendingQuestion: (SendQuestionToLuiPayload & { readonly id: number }) | null;
}

type Listener = () => void;

class AIAgentPiuRuntimeStore {
  private dockSide: DockedSide = 'right';
  private dockedMinWidth = DOCKED_DEFAULT_WIDTH;
  private clearStorageOnClose = false;
  private closeBehavior: 'hide' | 'minimize' = 'hide';
  private snapshot: AIAgentPiuSnapshot = {
    display: defaultDisplayState,
    layout: defaultDockedLayout(),
    site: { locale: 'zh-cn', theme: 'lightday' },
    piu: null,
    activeSessionId: readAIAgentPiuActiveSessionId(),
    activeSessionTitle: null,
    pendingQuestion: null,
  };
  private listeners = new Set<Listener>();
  private nextQuestionId = 1;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AIAgentPiuSnapshot => this.snapshot;

  setSite(site: HostSiteContext): void {
    this.update({
      site: {
        ...site,
        locale: site.locale ?? 'zh-cn',
        theme: normalizeHostTheme(site.theme),
      },
    });
  }

  setPiu(piu: PIU): void {
    this.update({ piu });
  }

  display(display: Partial<AIAgentDisplayState>): void {
    if (normalizeDisplayState(display).showPanel === false) {
      expandPanelStore.getState().close();
    }
    this.update({ display: normalizeDisplayState(display) });
  }

  openPanel(): void {
    this.update({ display: openPanel(this.snapshot.display) });
  }

  closePanel(): void {
    if (this.closeBehavior === 'minimize') {
      this.minimize();
      return;
    }
    if (this.clearStorageOnClose) {
      this.openNewSession();
    } else {
      expandPanelStore.getState().close();
      historicalChatReplayStore.getState().clearAllReplays();
    }
    this.update({ display: closePanel(this.snapshot.display) });
  }

  minimize(): void {
    if (expandPanelStore.getState().isOpen) {
      expandPanelStore.getState().close();
    }
    this.update({ display: normalizeDisplayState({ ...this.snapshot.display, minimized: true }) });
  }
  restoreFromMinimized(): void {
    this.update({ display: normalizeDisplayState({ ...this.snapshot.display, minimized: false }) });
  }

  setClearStorageOnClose(enabled: boolean): void {
    this.clearStorageOnClose = enabled;
  }

  setCloseBehavior(behavior: 'hide' | 'minimize'): void {
    this.closeBehavior = behavior;
  }

  switchTheme(theme: HostTheme): void {
    this.update({
      site: {
        ...this.snapshot.site,
        theme,
      },
    });
  }

  switchLocale(locale: HostLocale): void {
    this.update({
      site: {
        ...this.snapshot.site,
        locale: normalizeHostLocale(locale),
      },
    });
  }

  setDockSide(side: DockedSide): void {
    this.dockSide = side;
    if (this.snapshot.layout.kind !== 'docked' || this.snapshot.layout.side === side) {
      return;
    }
    this.update({ layout: { ...this.snapshot.layout, side } });
  }

  setDocked(width = DOCKED_DEFAULT_WIDTH, side: DockedSide = this.dockSide): void {
    this.dockSide = side;
    this.update({ layout: { kind: 'docked', side, width: clampDockedWidth(width, undefined, this.dockedMinWidth) } });
  }

  setDockedMinWidth(minWidth: number): void {
    this.dockedMinWidth = minWidth;
  }

  enterFloating(viewport?: ViewportSize): void {
    const current = this.snapshot.layout;
    if (current.kind === 'docked') {
      this.update({ layout: floatingLayoutFromDockedLayout(current, viewport) });
      return;
    }
    this.update({ layout: defaultFloatingLayout(viewport) });
  }

  moveFloating(deltaX: number, deltaY: number, viewport?: ViewportSize): void {
    const current = this.snapshot.layout.kind === 'floating' ? this.snapshot.layout : defaultFloatingLayout(viewport);
    this.update({
      layout: clampFloatingLayout(
        {
          ...current,
          x: current.x + deltaX,
          y: current.y + deltaY,
        },
        viewport,
      ),
    });
  }

  resizeDocked(width: number, viewport?: ViewportSize): void {
    const side = this.snapshot.layout.kind === 'docked' ? this.snapshot.layout.side : this.dockSide;
    this.update({ layout: { kind: 'docked', side, width: clampDockedWidth(width, viewport, this.dockedMinWidth) } });
  }

  resizeFloatingFromTop(top: number, height: number, viewport?: ViewportSize): void {
    const current = this.snapshot.layout.kind === 'floating' ? this.snapshot.layout : defaultFloatingLayout(viewport);
    this.update({ layout: resizeFloatingFromTop(current, top, height, viewport) });
  }

  resizeFloating(
    baseLayout: Extract<CollaborativePanelLayout, { kind: 'floating' }>,
    direction: FloatingResizeDirection,
    deltaX: number,
    deltaY: number,
    viewport?: ViewportSize,
  ): void {
    this.update({ layout: resizeFloatingLayout(baseLayout, direction, deltaX, deltaY, viewport) });
  }

  maximize(): void {
    this.update({ layout: maximizeLayout(this.snapshot.layout) });
  }

  restore(): void {
    this.update({ layout: restoreLayout(this.snapshot.layout) });
  }

  openSession(sessionId: string, displayTitle?: string): void {
    const normalized = sessionId.trim();
    if (normalized.length === 0) {
      this.openNewSession();
      return;
    }
    const normalizedTitle = displayTitle?.trim() || null;
    writeAIAgentPiuActiveSessionId(normalized);
    historicalChatReplayStore.getState().clearAllReplays();
    this.update({ activeSessionId: normalized, activeSessionTitle: normalizedTitle });
  }

  openNewSession(): void {
    writeAIAgentPiuActiveSessionId(null);
    historicalChatReplayStore.getState().clearAllReplays();
    this.update({ activeSessionId: null, activeSessionTitle: null });
  }

  clearActiveSessionForReplay(): void {
    writeAIAgentPiuActiveSessionId(null);
    this.update({ activeSessionId: null, activeSessionTitle: null });
  }

  clearActiveSession(sessionId?: string): void {
    if (sessionId && this.snapshot.activeSessionId !== sessionId) {
      return;
    }
    this.openNewSession();
  }

  queueQuestion(payload: SendQuestionToLuiPayload): void {
    this.update({
      display: openPanel(this.snapshot.display),
      pendingQuestion: {
        ...payload,
        isSend: payload.isSend ?? false,
        id: this.nextQuestionId,
      },
    });
    this.nextQuestionId += 1;
  }

  clearPendingQuestion(id: number): void {
    if (this.snapshot.pendingQuestion?.id !== id) {
      return;
    }
    this.update({ pendingQuestion: null });
  }

  private update(patch: Partial<AIAgentPiuSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const aiAgentPiuRuntimeStore = new AIAgentPiuRuntimeStore();
