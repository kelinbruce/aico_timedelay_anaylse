import { fireEvent, screen } from '@testing-library/react';

/**
 * Finds a button by testid, checking the primary row first, then the
 * overflow Dropdown. Opens the Dropdown if the button is not in the DOM yet.
 */
export function getActionButton(testid: string): HTMLElement {
  const primary = screen.queryByTestId(testid);
  if (primary) {
    return primary;
  }
  const moreBtn = screen.getByTestId('btn-more-actions');
  fireEvent.click(moreBtn);
  return screen.getByTestId(testid);
}

/**
 * Queries (without throwing) for a button by testid across primary and overflow.
 */
export function queryActionButton(testid: string): HTMLElement | null {
  const primary = screen.queryByTestId(testid);
  if (primary) {
    return primary;
  }
  const moreBtn = screen.queryByTestId('btn-more-actions');
  if (!moreBtn) {
    return null;
  }
  fireEvent.click(moreBtn);
  return screen.queryByTestId(testid);
}
