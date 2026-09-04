import { AI_AGENT_PIU_DEPS, AI_AGENT_PIU_NAME, getPrel } from '../host/prel.ts';

const HOST_PIU_NAME = 'AIAgentPIUHost';
const TEST_CONTAINER_ID = 'ai-agent-container';

function ensureTestContainer(): void {
  let container = document.getElementById(TEST_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = TEST_CONTAINER_ID;
    container.setAttribute('data-testid', TEST_CONTAINER_ID);
  }

  if (new URLSearchParams(window.location.search).get('dock') === 'left') {
    container.style.position = 'fixed';
    container.style.left = '16px';
    container.style.right = 'auto';
    container.style.top = '10px';
    container.style.zIndex = '1201';
    document.body.appendChild(container);
    return;
  }

  container.removeAttribute('style');
  const target = document.getElementById('prel-mock-menu-right') ?? document.body;
  target.appendChild(container);
}

getPrel().ready(() => {
  ensureTestContainer();
  getPrel().start(HOST_PIU_NAME, __NEXTAGENT_PACKAGE_VERSION__, AI_AGENT_PIU_DEPS, async (piu) => {
    await getPrel().autoLoad({ [AI_AGENT_PIU_NAME]: __NEXTAGENT_PACKAGE_VERSION__ });
    piu.emit('loadAIAgent', { containerId: TEST_CONTAINER_ID });
  });
});
