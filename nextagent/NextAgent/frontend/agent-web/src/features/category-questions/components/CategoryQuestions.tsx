import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CategoryL1, CategoryQuestionResult } from '../../../state/contracts.ts';
import { queryCategoryQuestions } from '../../../services/categoryQuestionService.ts';
import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { hostLocaleToSupportedLocale } from '../../../app/hostTypes.ts';
import { useCategorySelectionStore } from '../../../state/categorySelectionStore.ts';
import { CategoryQuestionBar } from './CategoryQuestionBar.tsx';
import { CategoryQuestionModal } from './CategoryQuestionModal.tsx';

export interface CategoryQuestionsProps {
  readonly onQuestionSelect?: ((question: string) => void) | undefined;
}

const cachedResults = new Map<string, CategoryQuestionResult>();
const pendingPromises = new Map<string, Promise<CategoryQuestionResult>>();

function loadCategoryQuestions(locale: string): Promise<CategoryQuestionResult> {
  const cached = cachedResults.get(locale);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = pendingPromises.get(locale);
  if (pending) {
    return pending;
  }
  const promise = queryCategoryQuestions(locale)
    .then((result) => {
      cachedResults.set(locale, result);
      return result;
    })
    .finally(() => {
      pendingPromises.delete(locale);
    });
  pendingPromises.set(locale, promise);
  return promise;
}

export function __resetCategoryQuestionCacheForTests(): void {
  cachedResults.clear();
  pendingPromises.clear();
}

export function CategoryQuestions({ onQuestionSelect }: CategoryQuestionsProps) {
  const { site } = useAppHostContext();
  const { t } = useTranslation();
  const allLabel = t('skillSelector.all');

  const [categories, setCategories] = useState<readonly CategoryL1[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(allLabel);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedCategoryName = useCategorySelectionStore((s) => s.selectedCategoryName);
  const selectCategory = useCategorySelectionStore((s) => s.selectCategory);
  const clearCategory = useCategorySelectionStore((s) => s.clearSelection);

  const locale = hostLocaleToSupportedLocale(site?.locale ?? 'zh-cn');

  useEffect(() => {
    let cancelled = false;
    loadCategoryQuestions(locale)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCategories(result.categories);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setCategories([]);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const handleSelectCategory = useCallback(
    (cat: CategoryL1, iconIndex: number) => {
      if (selectedCategoryName === cat.name) {
        clearCategory();
        setModalOpen(false);
        return;
      }
      selectCategory(cat.name, iconIndex);
      setActiveTab(cat.name === allLabel ? allLabel : cat.name);
      setModalOpen(true);
    },
    [selectedCategoryName, selectCategory, clearCategory, allLabel],
  );

  const handleQuestionClick = useCallback(
    (question: string) => {
      onQuestionSelect?.(question);
      setModalOpen(false);
    },
    [onQuestionSelect],
  );

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  if (!loaded || categories.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ visibility: modalOpen ? 'hidden' : 'visible' }}>
        <CategoryQuestionBar categories={categories} selectedCategory={selectedCategoryName} onSelectCategory={handleSelectCategory} />
      </div>
      {modalOpen && (
        <CategoryQuestionModal
          categories={categories}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onQuestionClick={handleQuestionClick}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
