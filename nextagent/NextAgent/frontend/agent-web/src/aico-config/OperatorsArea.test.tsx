import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { OperatorsArea } from './OperatorsArea.tsx';
import { aicoConfigStore, resetAICOConfigStoreForTesting } from './AICOConfigStore.ts';
import type { Operator } from './types.ts';
import i18n from '../i18n/index.ts';

const baseOperator: Operator = {
  lightIcon: 'data:image/png;base64,abc',
  darkIcon: 'data:image/png;base64,abc',
  enName: 'Diagnose',
  zhName: '网络诊断',
  position: 'OUTER',
  type: 'MODAL',
  data: { piuName: 'network-diagnostic', piuVersion: '1.0.0', renderFunc: 'render' },
};

describe('OperatorsArea', () => {
  beforeEach(() => {
    resetAICOConfigStoreForTesting();
  });

  afterEach(() => {
    cleanup();
    void i18n.changeLanguage('zh-CN');
  });

  it('renders OUTER operator buttons in header variant', () => {
    aicoConfigStore.setConfig({ operators: [baseOperator] });
    const { queryByTestId } = render(<OperatorsArea isDark={false} variant="header" />);
    expect(queryByTestId('operator-button-Diagnose')).not.toBeNull();
  });

  it('renders INNER more menu by default', () => {
    const innerOperator: Operator = { ...baseOperator, position: 'INNER', enName: 'Inner', zhName: '内部' };
    aicoConfigStore.setConfig({ operators: [innerOperator] });
    const { queryByTestId } = render(<OperatorsArea isDark={false} variant="header" />);
    expect(queryByTestId('operators-more-menu')).not.toBeNull();
  });

  it('hides INNER more menu when showInnerMenu is false', () => {
    const innerOperator: Operator = { ...baseOperator, position: 'INNER', enName: 'Inner', zhName: '内部' };
    aicoConfigStore.setConfig({ operators: [innerOperator] });
    const { queryByTestId } = render(<OperatorsArea isDark={false} variant="header" showInnerMenu={false} />);
    expect(queryByTestId('operators-more-menu')).toBeNull();
  });

  it('renders OUTER buttons but not INNER more menu when showInnerMenu is false', () => {
    const outerOperator: Operator = { ...baseOperator, enName: 'Outer1', zhName: '外部1' };
    const innerOperator: Operator = { ...baseOperator, position: 'INNER', enName: 'Inner1', zhName: '内部1' };
    aicoConfigStore.setConfig({ operators: [outerOperator, innerOperator] });
    const { queryByTestId } = render(<OperatorsArea isDark={false} variant="header" showInnerMenu={false} />);
    expect(queryByTestId('operator-button-Outer1')).not.toBeNull();
    expect(queryByTestId('operators-more-menu')).toBeNull();
  });

  it('uses Chinese name for INNER operator label in zh-CN locale', async () => {
    await i18n.changeLanguage('zh-CN');
    const innerOperator: Operator = { ...baseOperator, position: 'INNER', enName: 'Diagnose', zhName: '网络诊断' };
    aicoConfigStore.setConfig({ operators: [innerOperator] });
    render(<OperatorsArea isDark={false} variant="header" />);
    fireEvent.click(screen.getByTestId('operators-more-menu'));
    const menuItem = document.body.querySelector('.ant-dropdown-menu-item');
    expect(menuItem?.textContent).toContain('网络诊断');
  });

  it('uses English name for INNER operator label in en-US locale', async () => {
    await i18n.changeLanguage('en-US');
    const innerOperator: Operator = { ...baseOperator, position: 'INNER', enName: 'Diagnose', zhName: '网络诊断' };
    aicoConfigStore.setConfig({ operators: [innerOperator] });
    render(<OperatorsArea isDark={false} variant="header" />);
    fireEvent.click(screen.getByTestId('operators-more-menu'));
    const menuItem = document.body.querySelector('.ant-dropdown-menu-item');
    expect(menuItem?.textContent).toContain('Diagnose');
    expect(menuItem?.textContent).not.toContain('网络诊断');
  });

  it('uses English name for OUTER operator button label in en-US locale', async () => {
    await i18n.changeLanguage('en-US');
    aicoConfigStore.setConfig({ operators: [baseOperator] });
    render(<OperatorsArea isDark={false} variant="sidebar" />);
    const button = screen.getByTestId('operator-button-Diagnose');
    expect(button.textContent).toContain('Diagnose');
    expect(button.textContent).not.toContain('网络诊断');
  });

  it('uses Chinese name for OUTER operator button label in zh-CN locale', async () => {
    await i18n.changeLanguage('zh-CN');
    aicoConfigStore.setConfig({ operators: [baseOperator] });
    render(<OperatorsArea isDark={false} variant="sidebar" />);
    const button = screen.getByTestId('operator-button-Diagnose');
    expect(button.textContent).toContain('网络诊断');
  });
});
