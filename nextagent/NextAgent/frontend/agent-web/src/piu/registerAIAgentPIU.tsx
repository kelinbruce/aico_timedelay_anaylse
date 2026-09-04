import { type Root } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import { renderRoot } from '../entries/renderRoot.tsx';
import {
  AI_AGENT_PIU_DEPS,
  AI_AGENT_PIU_NAME,
  getPrel,
  isValidSwitchLocale,
  isValidSwitchTheme,
  normalizeSiteContext,
  type PIU,
} from '../host/prel.ts';
import { AIAgentPiuRuntime } from './AIAgentPiuRuntime.tsx';
import { aiAgentPiuRuntimeStore, type SendQuestionToLuiPayload } from './runtimeStore.ts';
import { normalizeDisplayState, type AIAgentDisplayState } from './displayState.ts';
import type { DockedSide } from './layout.ts';
import { validateAICOConfig } from '../aico-config/validateAICOConfig.ts';
import { aicoConfigStore } from '../aico-config/AICOConfigStore.ts';
import { AppProviders } from '../app/AppProviders.tsx';
import { KnowledgeSourceList, type RenderKnowledgePayload, type KnowledgeSourceItem } from '../features/knowledge/KnowledgeSourceList.tsx';
import { historicalChatReplayStore, type ReplayEntry } from './historicalChatReplayStore.ts';
import { reportError, reportWarning } from '../utils/diagnostics.ts';

let activeContainerId: string | null = null;
let activeRoot: Root | null = null;
let activeContainer: HTMLElement | null = null;

// Independent root management for renderKnowledge (does not share state with loadAIAgent)
let knowledgeActiveContainerId: string | null = null;
let knowledgeActiveRoot: Root | null = null;
let knowledgeActiveContainer: HTMLElement | null = null;

const PIU_DISPLAY_CHANGE_EVENT = 'nextagent:piu-display-change';

export function registerAIAgentPIU(): void {
  const prel = getPrel();
  prel.ready(() => {
    prel.start(AI_AGENT_PIU_NAME, __NEXTAGENT_PACKAGE_VERSION__, AI_AGENT_PIU_DEPS, (piu, site) => {
      aiAgentPiuRuntimeStore.setSite(normalizeSiteContext(site));
      aiAgentPiuRuntimeStore.setPiu(piu);
      piu.attach(piu, createHandlers(piu));
      window.addEventListener(PIU_DISPLAY_CHANGE_EVENT, handlePiuDisplayChange);
    });
  });
}

function handlePiuDisplayChange(event: Event): void {
  const detail = (event as CustomEvent).detail;
  if (typeof detail === 'object' && detail !== null && detail.minimized === true) {
    aiAgentPiuRuntimeStore.minimize();
  }
}

function createHandlers(_piu: PIU): {
  $stateChange?: Record<string, (newValue: unknown, oldValue: unknown) => void>;
  userAction?: {
    febsMemuEvent?: (params: { event: string; type: string }) => void;
    logout?: () => void;
  };
  switchLocale?: (locale: unknown) => void;
  switchTheme?: (theme: unknown) => void;
  loadAIAgent?: (payload: unknown) => void;
  displayAIAgent?: (payload: unknown) => void;
  minimizeAIAgent?: () => void;
  sendQuestionToLui?: (payload: Partial<SendQuestionToLuiPayload>) => void;
  renderKnowledge?: (payload: unknown) => void;
  handleHistoricalChatReplay?: (payload: unknown) => void;
  updatePanelLayout?: (payload: unknown) => void;
} {
  const handleThemeChange = (theme: unknown): void => {
    if (!isValidSwitchTheme(theme)) {
      reportWarning("[AICOPIU] Unsupported theme. Expected 'lightday' or 'evening'.");
      return;
    }
    aiAgentPiuRuntimeStore.switchTheme(theme);
  };

  const handleLocaleChange = (locale: unknown): void => {
    if (!isValidSwitchLocale(locale)) {
      reportWarning("[AICOPIU] Unsupported locale. Expected 'zh-cn' or 'en-us'.");
      return;
    }
    aiAgentPiuRuntimeStore.switchLocale(locale);
  };

  return {
    $stateChange: {
      theme: (newValue: unknown) => {
        handleThemeChange(newValue);
      },
      locale: (newValue: unknown) => {
        handleLocaleChange(newValue);
      },
    },
    loadAIAgent: (payload: unknown) => {
      void loadAIAgentWithConfig(payload);
    },
    displayAIAgent: (payload: unknown) => {
      if (!isDisplayPayload(payload)) {
        reportWarning('[AICOPIU] displayAIAgent requires a display state payload.');
        return;
      }
      const current = aiAgentPiuRuntimeStore.getSnapshot().display;
      aiAgentPiuRuntimeStore.display({
        showEntrance: typeof payload.showEntrance === 'boolean' ? payload.showEntrance : current.showEntrance,
        showPanel: typeof payload.showPanel === 'boolean' ? payload.showPanel : current.showPanel,
        minimized: current.minimized,
      });
    },
    minimizeAIAgent: () => {
      aiAgentPiuRuntimeStore.minimize();
    },
    switchLocale: (locale: unknown) => {
      handleLocaleChange(locale);
    },
    switchTheme: (theme: unknown) => {
      handleThemeChange(theme);
    },
    renderKnowledge: (payload: unknown) => {
      void renderKnowledgeWithConfig(payload);
    },
    handleHistoricalChatReplay: (payload: unknown) => {
      const entry = normalizeReplayEntry(payload);
      if (!entry) {
        return;
      }
      if (aiAgentPiuRuntimeStore.getSnapshot().activeSessionId) {
        aiAgentPiuRuntimeStore.clearActiveSessionForReplay();
      }
      aiAgentPiuRuntimeStore.openPanel();
      aiAgentPiuRuntimeStore.restoreFromMinimized();
      historicalChatReplayStore.getState().startReplay(entry);
    },
    sendQuestionToLui: (payload: Partial<SendQuestionToLuiPayload>) => {
      if (typeof payload?.question !== 'string' || payload.question.trim().length === 0) {
        reportWarning('[AICOPIU] sendQuestionToLui requires a non-empty question.');
        return;
      }
      aiAgentPiuRuntimeStore.queueQuestion({
        question: payload.question,
        isSend: payload.isSend === true,
      });
    },
    updatePanelLayout: (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) {
        reportWarning('[AICOPIU] updatePanelLayout requires a payload object.');
        return;
      }
      const raw = payload as Record<string, unknown>;
      const current = aicoConfigStore.getSnapshot().config;
      if (!current) {
        reportWarning('[AICOPIU] updatePanelLayout requires loadAIAgent to be called first.');
        return;
      }
      const merged: Record<string, unknown> = { ...current };
      if (typeof raw.panelPosition === 'object' && raw.panelPosition !== null) {
        merged.panelPosition = { ...current.panelPosition, ...validateAICOConfig({ panelPosition: raw.panelPosition })?.panelPosition };
      }
      if (typeof raw.modalSize === 'object' && raw.modalSize !== null) {
        merged.modalSize = { ...current.modalSize, ...validateAICOConfig({ modalSize: raw.modalSize })?.modalSize };
      }
      if (typeof raw.minimizedStyle === 'object' && raw.minimizedStyle !== null) {
        merged.minimizedStyle = { ...current.minimizedStyle, ...validateAICOConfig({ minimizedStyle: raw.minimizedStyle })?.minimizedStyle };
      }
      aicoConfigStore.updateConfig(merged as import('../aico-config/types.ts').AICOConfig);
      if (typeof (merged.modalSize as { width?: unknown })?.width === 'number') {
        aiAgentPiuRuntimeStore.setDocked((merged.modalSize as { width: number }).width);
      }
    },
  };
}

function isDisplayPayload(payload: unknown): payload is Partial<AIAgentDisplayState> {
  return typeof payload === 'object' && payload !== null;
}

function normalizeReplayEntry(payload: unknown): ReplayEntry | null {
  if (typeof payload !== 'object' || payload === null) {
    reportWarning('[AICOPIU] handleHistoricalChatReplay requires a payload object.');
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const piuName = typeof obj.piuName === 'string' ? obj.piuName.trim() : '';
  const piuVersion = typeof obj.piuVersion === 'string' ? obj.piuVersion.trim() : '';
  const method = typeof obj.method === 'string' ? obj.method.trim() : '';
  const chatId = typeof obj.chatId === 'string' ? obj.chatId.trim() : '';
  if (piuName.length === 0 || piuVersion.length === 0 || method.length === 0 || chatId.length === 0) {
    reportWarning('[AICOPIU] handleHistoricalChatReplay requires non-empty piuName, piuVersion, method, and chatId.');
    return null;
  }
  const data = obj.data;
  const extraPayload: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key !== 'piuName' && key !== 'piuVersion' && key !== 'method' && key !== 'data') {
      extraPayload[key] = obj[key];
    }
  }
  return { chatId, piuName, piuVersion, method, data, extraPayload };
}

async function loadAIAgentWithConfig(rawPayload: unknown): Promise<void> {
  const config = validateAICOConfig(rawPayload);
  const containerId =
    config?.containerId ??
    (typeof (rawPayload as Record<string, unknown>)?.containerId === 'string' ? ((rawPayload as Record<string, unknown>).containerId as string) : '');
  if (!containerId) {
    reportWarning('[AICOPIU] loadAIAgent requires containerId.');
    return;
  }
  if (config) {
    aicoConfigStore.setConfig(config);
    aiAgentPiuRuntimeStore.setClearStorageOnClose(config.clearStorage === true);
    aiAgentPiuRuntimeStore.setCloseBehavior(config.closeBehavior ?? 'hide');
    if (typeof config.modalSize?.minWidth === 'number') {
      aiAgentPiuRuntimeStore.setDockedMinWidth(config.modalSize.minWidth);
    }
    if (typeof config.modalSize?.width === 'number') {
      aiAgentPiuRuntimeStore.setDocked(config.modalSize.width);
    }
  }
  const container = document.getElementById(containerId);
  if (!container) {
    reportWarning(`[AICOPIU] Container '${containerId}' was not found.`);
    return;
  }

  aiAgentPiuRuntimeStore.setDockSide(inferDockSide(container));

  if (config?.initialDisplayState) {
    aiAgentPiuRuntimeStore.display(config.initialDisplayState);
  }
  if (activeContainerId === containerId && activeRoot) {
    activeRoot.render(<AIAgentPiuRuntime />);
    return;
  }

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeContainer && activeContainer !== container) {
    activeContainer.replaceChildren();
  }

  activeContainerId = containerId;
  activeContainer = container;
  activeRoot = await renderRoot(container, <AIAgentPiuRuntime />, {
    mode: 'piu',
    onRuntimeConfigError: (error) => {
      reportError('[RuntimeConfig] Failed to load runtime bootstrap config', error);
    },
  });
}

function inferDockSide(container: HTMLElement): DockedSide {
  const rect = container.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  return centerX < window.innerWidth / 2 ? 'left' : 'right';
}

async function renderKnowledgeWithConfig(rawPayload: unknown): Promise<void> {
  const payload = rawPayload as Partial<RenderKnowledgePayload> | null | undefined;
  const containerId = typeof payload?.containerId === 'string' ? payload.containerId : '';
  if (!containerId) {
    reportWarning('[AICOPIU] renderKnowledge requires containerId.');
    return;
  }
  const container = document.getElementById(containerId);
  if (!container) {
    reportWarning(`[AICOPIU] renderKnowledge container '${containerId}' was not found.`);
    return;
  }
  const data = Array.isArray(payload?.data) ? (payload!.data as readonly KnowledgeSourceItem[]) : [];

  const node = <KnowledgeRoot data={data} />;

  if (knowledgeActiveContainerId === containerId && knowledgeActiveRoot) {
    knowledgeActiveRoot.render(node);
    return;
  }

  if (knowledgeActiveRoot) {
    knowledgeActiveRoot.unmount();
    knowledgeActiveRoot = null;
  }
  if (knowledgeActiveContainer && knowledgeActiveContainer !== container) {
    knowledgeActiveContainer.replaceChildren();
  }

  knowledgeActiveContainerId = containerId;
  knowledgeActiveContainer = container;
  knowledgeActiveRoot = await renderRoot(container, node, {
    mode: 'piu',
    onRuntimeConfigError: (error) => {
      reportError('[RuntimeConfig] Failed to load runtime bootstrap config', error);
    },
  });
}

function KnowledgeRoot({ data }: { readonly data: readonly KnowledgeSourceItem[] }) {
  const snapshot = useSyncExternalStore(aiAgentPiuRuntimeStore.subscribe, aiAgentPiuRuntimeStore.getSnapshot, aiAgentPiuRuntimeStore.getSnapshot);
  return (
    <AppProviders mode="piu" site={snapshot.site}>
      <KnowledgeSourceList data={data} />
    </AppProviders>
  );
}
