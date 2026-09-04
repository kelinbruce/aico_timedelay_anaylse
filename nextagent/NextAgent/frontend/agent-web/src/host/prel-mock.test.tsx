import { fireEvent, screen } from '@testing-library/dom';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PiuMessage } from '../features/chat/components/structured/PiuMessage.tsx';
import { PiuContext } from '../features/chat/context/PiuContext.tsx';
import { mockPiu, mockPrel, mockSite } from './prel-mock.ts';

describe('local Prel mock PIU rendering', () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    delete window.Prel;
  });

  it('renders an interactive network diagnostic card into the requested container', () => {
    const container = document.createElement('div');
    container.id = 'network-diagnostic-host';
    document.body.append(container);

    mockPiu.emit('render', {
      piuName: 'network-diagnostic',
      piuVersion: '1.0.0',
      containerId: container.id,
      data: {
        title: '骨干网络链路诊断',
        latencyMs: 63,
        packetLossPercent: 0.01,
        status: 'DEGRADED',
      },
    });

    expect(screen.getByTestId('mock-network-diagnostic-piu').textContent).toContain('骨干网络链路诊断');
    expect(screen.getByTestId('mock-network-diagnostic-piu').textContent).toContain('63 ms');
    expect(screen.getByTestId('mock-network-diagnostic-piu').textContent).toContain('0.01%');
    expect(screen.getByTestId('mock-network-diagnostic-state').textContent).toContain('本地交互次数：0');

    fireEvent.click(screen.getByRole('button', { name: '记录一次本地检查' }));

    expect(screen.getByTestId('mock-network-diagnostic-state').textContent).toContain('本地交互次数：1');
  });

  it('renders through the PiuMessage host integration path', async () => {
    window.Prel = mockPrel;

    render(
      <PiuContext.Provider value={{ piu: mockPiu, site: mockSite }}>
        <PiuMessage
          content={{
            piuName: 'network-diagnostic',
            piuVersion: '1.0.0',
            method: 'render',
            data: {
              title: '骨干网络链路诊断',
              latencyMs: 63,
              packetLossPercent: 0.01,
              status: 'DEGRADED',
            },
          }}
        />
      </PiuContext.Provider>,
    );

    expect(await screen.findByTestId('mock-network-diagnostic-piu')).toBeTruthy();
    expect(screen.getByRole('button', { name: '记录一次本地检查' })).toBeTruthy();
  });

  it('leaves unknown PIU containers unchanged', () => {
    const container = document.createElement('div');
    container.id = 'unknown-piu-host';
    container.textContent = '等待宿主渲染';
    document.body.append(container);

    mockPiu.emit('render', {
      piuName: 'unknown-piu',
      piuVersion: '1.0.0',
      containerId: container.id,
    });

    expect(container.textContent).toBe('等待宿主渲染');
    expect(container.querySelector("[data-testid='mock-network-diagnostic-piu']")).toBeNull();
  });
});
