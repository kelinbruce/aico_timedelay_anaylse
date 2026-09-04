type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function appendMetric(parent: HTMLElement, label: string, value: string): void {
  const metric = document.createElement('div');
  metric.style.cssText = [
    'display:grid',
    'gap:4px',
    'min-width:110px',
    'padding:10px 12px',
    'border-radius:8px',
    'background:var(--color-bg-layout, #f6f8fa)',
  ].join(';');

  const metricLabel = document.createElement('span');
  metricLabel.textContent = label;
  metricLabel.style.cssText = 'font-size:12px;color:var(--color-text-tertiary, #6b7280)';

  const metricValue = document.createElement('strong');
  metricValue.textContent = value;
  metricValue.style.cssText = 'font-size:16px;color:var(--color-text, #1f2937)';

  metric.append(metricLabel, metricValue);
  parent.append(metric);
}

function renderNetworkDiagnostic(container: HTMLElement, state: UnknownRecord): void {
  const data = asRecord(state.data) ?? {};
  const card = document.createElement('section');
  card.dataset.testid = 'mock-network-diagnostic-piu';
  card.setAttribute('aria-label', '本地 PIU 骨干网络诊断卡片');
  card.style.cssText = [
    'display:grid',
    'gap:12px',
    'padding:14px',
    'border:1px solid var(--color-border-secondary, #d9dee7)',
    'border-radius:10px',
    'background:var(--color-bg-container, #fff)',
    'box-shadow:0 2px 8px rgba(15, 23, 42, 0.06)',
    'color:var(--color-text, #1f2937)',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';

  const title = document.createElement('strong');
  title.textContent = textValue(data.title, '网络链路诊断');
  title.style.cssText = 'font-size:14px';

  const status = document.createElement('span');
  status.textContent = textValue(data.status, 'UNKNOWN');
  status.style.cssText = ['padding:2px 8px', 'border-radius:999px', 'font-size:12px', 'font-weight:600', 'color:#9a3412', 'background:#ffedd5'].join(
    ';',
  );
  header.append(title, status);

  const metrics = document.createElement('div');
  metrics.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  appendMetric(metrics, '平均时延', `${textValue(data.latencyMs, '—')} ms`);
  appendMetric(metrics, '丢包率', `${textValue(data.packetLossPercent, '—')}%`);

  const stateRow = document.createElement('div');
  stateRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';

  const stateText = document.createElement('span');
  stateText.dataset.testid = 'mock-network-diagnostic-state';
  stateText.style.cssText = 'font-size:12px;color:var(--color-text-secondary, #4b5563)';
  let interactionCount = 0;
  const updateStateText = () => {
    stateText.textContent = `本地交互次数：${interactionCount}`;
  };
  updateStateText();

  const action = document.createElement('button');
  action.type = 'button';
  action.textContent = '记录一次本地检查';
  action.style.cssText = [
    'border:1px solid #91caff',
    'border-radius:6px',
    'padding:5px 10px',
    'background:#e6f4ff',
    'color:#0958d9',
    'cursor:pointer',
    'font-size:12px',
  ].join(';');
  action.addEventListener('click', () => {
    interactionCount += 1;
    updateStateText();
  });
  stateRow.append(stateText, action);

  const note = document.createElement('small');
  note.textContent = '开发环境 PIU：折叠后重新展开若计数归零，说明组件发生了重新挂载。';
  note.style.cssText = 'color:var(--color-text-tertiary, #6b7280)';

  card.append(header, metrics, stateRow, note);
  container.replaceChildren(card);
}

export function renderLocalMockPiu(key: string, rawState: unknown): boolean {
  const state = asRecord(rawState);
  if (key !== 'render' || state?.piuName !== 'network-diagnostic' || state.piuVersion !== '1.0.0' || typeof state.containerId !== 'string') {
    return false;
  }

  const container = document.getElementById(state.containerId);
  if (!container) {
    return false;
  }

  renderNetworkDiagnostic(container, state);
  return true;
}
