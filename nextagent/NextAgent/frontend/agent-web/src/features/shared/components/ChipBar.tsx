import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { SKILL_ICONS, skillAllIcon } from '../../../constants/skillIcons.ts';

export interface ChipBarItem {
  readonly key: string;
  readonly label: string;
  readonly tooltip?: string;
}

export interface ChipBarProps {
  readonly items: readonly ChipBarItem[];
  readonly selectedKey: string | null;
  readonly testIdPrefix: string;
  readonly allLabel: string;
  readonly onSelect: (key: string, index: number) => void;
  readonly onOpenAll: () => void;
}

const CHIP_GAP = 8;
const CHIP_MAX_WIDTH = 400;

export function ChipBar({ items, selectedKey, testIdPrefix, allLabel, onSelect, onOpenAll }: ChipBarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const hideOverflowItems = useCallback((): void => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const allChildren = Array.from(container.children) as HTMLElement[];
    const allButton = allChildren.find((el) => el.hasAttribute('data-overflow-skip'));
    const chips = allChildren.filter((el) => !el.hasAttribute('data-overflow-skip'));
    for (const chip of chips) {
      chip.style.display = '';
    }
    const containerRight = container.getBoundingClientRect().right;
    const allButtonSpace = allButton ? allButton.offsetWidth + CHIP_GAP : 0;
    const availableRight = containerRight - allButtonSpace;
    let overflowIndex = -1;
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      if (!chip) {
        break;
      }
      if (chip.getBoundingClientRect().right > availableRight + 1) {
        overflowIndex = i;
        break;
      }
    }
    if (overflowIndex !== -1) {
      for (let i = overflowIndex; i < chips.length; i++) {
        const chip = chips[i];
        if (chip) {
          chip.style.display = 'none';
        }
      }
    }
  }, []);

  useLayoutEffect(() => {
    hideOverflowItems();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => hideOverflowItems());
    observer.observe(container);
    return () => observer.disconnect();
  }, [hideOverflowItems, items]);

  return (
    <div
      data-testid={`${testIdPrefix}-bar`}
      ref={containerRef}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: CHIP_GAP,
        flexWrap: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {items.map((item, index) => {
        const iconSrc = SKILL_ICONS[index % SKILL_ICONS.length];
        const isSelected = selectedKey === item.key;
        return (
          <div
            key={item.key}
            data-testid={`${testIdPrefix}-chip-${item.key}`}
            style={{ flex: '0 0 auto', maxWidth: CHIP_MAX_WIDTH, overflow: 'hidden' }}
          >
            <Tooltip
              rootClassName="app-common-tooltip"
              title={
                item.tooltip === undefined ? undefined : (
                  <div
                    className="skill-chip-description-scroll"
                    style={{ maxWidth: 360, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', padding: '2px 0', paddingRight: 2 }}
                  >
                    {item.tooltip}
                  </div>
                )
              }
              placement="top"
            >
              <button
                type="button"
                onClick={() => onSelect(item.key, index)}
                style={{
                  height: 32,
                  padding: '7px 12px',
                  borderRadius: 16,
                  border: isSelected ? '1px solid var(--color-primary, #1677ff)' : '1px solid var(--color-composer-border, #e5e7eb)',
                  background: isSelected ? 'var(--color-bg-active, #e6f4ff)' : 'var(--color-composer-bg, #ffffff)',
                  color: isSelected ? 'var(--color-primary, #1677ff)' : 'var(--color-text-secondary, #6b7280)',
                  fontSize: 12,
                  lineHeight: '18px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                  userSelect: 'none',
                  transition: 'border-color 120ms ease, background 120ms ease',
                }}
              >
                <img
                  src={iconSrc}
                  alt=""
                  aria-hidden="true"
                  style={{ width: 16, height: 16, flexShrink: 0, marginRight: 8, verticalAlign: 'middle' }}
                />
                {item.label}
              </button>
            </Tooltip>
          </div>
        );
      })}

      <button
        type="button"
        data-testid={`${testIdPrefix}-all-button`}
        data-overflow-skip
        onClick={onOpenAll}
        style={{
          height: 32,
          padding: '7px 12px',
          borderRadius: 16,
          border: '1px solid var(--color-composer-border)',
          background: 'var(--color-composer-bg)',
          color: 'var(--color-text-secondary)',
          fontSize: 12,
          lineHeight: '18px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          flex: '0 0 auto',
        }}
      >
        <img src={skillAllIcon} alt="" aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0, marginRight: 8, verticalAlign: 'middle' }} />
        {allLabel}
      </button>
    </div>
  );
}
