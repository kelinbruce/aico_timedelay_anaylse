import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { CategoryL1 } from '../../../state/contracts.ts';
import { useCategorySelectionStore } from '../../../state/categorySelectionStore.ts';
import collectingFilesIcon from '../../../assets/category-icons/collecting-files.svg';

export interface CategoryQuestionModalProps {
  readonly categories: readonly CategoryL1[];
  readonly activeTab: string;
  readonly onSelectTab: (tab: string) => void;
  readonly onQuestionClick: (question: string) => void;
  readonly onClose: () => void;
}

const MODAL_MAX_HEIGHT = 516;
const MODAL_PADDING = 16;
const MODAL_RADIUS = 16;
const BLOCK_HEIGHT = 64;
const BLOCK_RADIUS = 12;
const BLOCK_GAP = 8;
const PIU_TWO_COL_THRESHOLD = 1080;

// The skillSelectorSlot wrapper has marginBottom: 16 (MessageInput.tsx).
// bottom: -12 makes the modal bottom edge sit 4px above the input box (16 - 12 = 4).
const MODAL_BOTTOM_OFFSET = -12;

interface FlattenedQuestion {
  readonly text: string;
  readonly fixed: boolean;
  readonly subCategoryName: string | null;
}

export function CategoryQuestionModal({ categories, activeTab, onSelectTab, onQuestionClick, onClose }: CategoryQuestionModalProps) {
  const { t } = useTranslation();
  const tabListRef = useRef<HTMLDivElement | null>(null);

  const selectCategory = useCategorySelectionStore((s) => s.selectCategory);
  const clearCategory = useCategorySelectionStore((s) => s.clearSelection);

  const isCollaborative = typeof document !== 'undefined' && document.body.dataset.nextagentHostMode === 'collaborative';

  const [piuPanelWidth, setPiuPanelWidth] = useState(0);

  useEffect(() => {
    if (!isCollaborative) {
      return undefined;
    }
    const panel = document.querySelector<HTMLElement>("[data-testid='ai-agent-piu-panel']");
    if (!panel) {
      return undefined;
    }
    const measure = () => setPiuPanelWidth(panel.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isCollaborative]);

  const columns = isCollaborative && piuPanelWidth < PIU_TWO_COL_THRESHOLD ? 1 : 2;

  const handleTabWheel = useCallback((e: React.WheelEvent) => {
    const container = tabListRef.current;
    if (!container) {
      return;
    }
    e.preventDefault();
    container.scrollLeft += e.deltaY;
  }, []);

  const allLabel = t('skillSelector.all');

  const handleTabSelect = useCallback(
    (tab: string) => {
      onSelectTab(tab);
      if (tab === allLabel) {
        clearCategory();
      } else {
        const catIndex = categories.findIndex((c) => c.name === tab);
        if (catIndex >= 0) {
          selectCategory(tab, catIndex);
        }
      }
    },
    [onSelectTab, clearCategory, selectCategory, categories, allLabel],
  );

  const collectQuestions = useCallback((): readonly FlattenedQuestion[] => {
    const collect = (cat: CategoryL1): FlattenedQuestion[] => {
      const result: FlattenedQuestion[] = [];

      if (cat.subCategories) {
        for (const sub of cat.subCategories) {
          for (const q of sub.questions) {
            result.push({
              text: q.text,
              fixed: q.fixed,
              subCategoryName: sub.name,
            });
          }
        }
      }
      if (cat.questions) {
        for (const q of cat.questions) {
          result.push({
            text: q.text,
            fixed: q.fixed,
            subCategoryName: null,
          });
        }
      }
      return result;
    };

    if (activeTab === allLabel) {
      return categories.flatMap(collect);
    }
    const cat = categories.find((c) => c.name === activeTab);
    return cat ? collect(cat) : [];
  }, [activeTab, categories, allLabel]);

  const tabs = [allLabel, ...categories.map((c) => c.name)];
  const questionList = collectQuestions();

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: BLOCK_GAP,
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  };

  const blockStyle: CSSProperties = {
    height: BLOCK_HEIGHT,
    borderRadius: BLOCK_RADIUS,
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 8,
    cursor: 'pointer',
    background: 'var(--color-category-block-bg)',
    border: '1px solid var(--color-composer-border)',
    transition: 'border-color 120ms ease, background 120ms ease',
    userSelect: 'none',
  };

  return (
    <div
      data-testid="category-question-modal"
      style={{
        position: 'absolute',
        bottom: MODAL_BOTTOM_OFFSET,
        left: 0,
        width: '100%',
        maxHeight: MODAL_MAX_HEIGHT,
        padding: MODAL_PADDING,
        borderRadius: MODAL_RADIUS,
        background: 'var(--color-category-modal-bg)',
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('categoryQuestions.title')}</span>
        <button
          type="button"
          data-testid="category-question-modal-close"
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <CloseOutlined style={{ fontSize: 14 }} />
        </button>
      </div>

      <div
        ref={tabListRef}
        onWheel={handleTabWheel}
        style={
          {
            display: 'flex',
            gap: 4,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            flexShrink: 0,
            marginBottom: 12,
          } as CSSProperties
        }
      >
        {tabs.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              data-testid={`category-tab-${tab}`}
              onClick={() => handleTabSelect(tab)}
              style={{
                flex: '0 0 auto',
                height: 28,
                padding: '0 12px',
                borderRadius: 8,
                border: 'none',
                background: isActive ? 'var(--color-primary, #1677ff)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--color-text-secondary)',
                fontSize: 12,
                lineHeight: '20px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      <div className="nextagent-trackless-scrollbar" style={gridStyle}>
        {questionList.map((q, index) => {
          const iconSrc = collectingFilesIcon;
          return (
            <div
              key={`${q.text}-${index}`}
              data-testid={`question-block-${index}`}
              onClick={() => onQuestionClick(q.text)}
              style={blockStyle}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary, #1677ff)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-composer-border)';
              }}
            >
              <img src={iconSrc} alt="" aria-hidden="true" style={{ width: 24, height: 24, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                {q.subCategoryName && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-tertiary)',
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {q.subCategoryName}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-primary)',
                    lineHeight: '18px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {q.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
