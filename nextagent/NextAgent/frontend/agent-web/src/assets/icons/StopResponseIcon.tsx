import { memo } from 'react';

interface StopResponseIconProps {
  readonly size?: number;
}

/**
 * Stop response icon — a circle with a rounded square inside.
 * Uses currentColor for the stroke so theme is controlled via CSS.
 *
 * Light: stroke #0067D1
 * Dark:  stroke #5CA2E9
 */
function StopResponseIconImpl({ size = 22 }: StopResponseIconProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', color: 'var(--stop-icon-color)' }}
      aria-hidden="true"
    >
      <ellipse cx="24" cy="24" rx="22" ry="21.999304" stroke="currentColor" strokeWidth="2.4" />
      <path
        d="M30 15C31.65 15 33 16.34 33 18L33 30C33 31.65 31.65 33 30 33L18 33C16.34 33 15 31.65 15 30L15 18C15 16.34 16.34 15 18 15L30 15Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const StopResponseIcon = memo(StopResponseIconImpl);
