import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';

import copyLight from '../../../assets/turn-icons/copy-light.svg';
import copyDark from '../../../assets/turn-icons/copy-dark.svg';
import checkLight from '../../../assets/turn-icons/check-light.svg';
import checkDark from '../../../assets/turn-icons/check-dark.svg';
import forkLight from '../../../assets/turn-icons/fork-light.svg';
import forkDark from '../../../assets/turn-icons/fork-dark.svg';
import shareLight from '../../../assets/turn-icons/share-light.svg';
import shareDark from '../../../assets/turn-icons/share-dark.svg';
import likeLight from '../../../assets/turn-icons/like-light.svg';
import likeDark from '../../../assets/turn-icons/like-dark.svg';
import likeActiveLight from '../../../assets/turn-icons/like-active-light.svg';
import likeActiveDark from '../../../assets/turn-icons/like-active-dark.svg';
import dislikeLight from '../../../assets/turn-icons/dislike-light.svg';
import dislikeDark from '../../../assets/turn-icons/dislike-dark.svg';
import dislikeActiveLight from '../../../assets/turn-icons/dislike-active-light.svg';
import dislikeActiveDark from '../../../assets/turn-icons/dislike-active-dark.svg';
import favoriteLight from '../../../assets/turn-icons/favorite-light.svg';
import favoriteDark from '../../../assets/turn-icons/favorite-dark.svg';
import favoriteActiveLight from '../../../assets/turn-icons/favorite-active-light.svg';
import favoriteActiveDark from '../../../assets/turn-icons/favorite-active-dark.svg';
import retryLight from '../../../assets/turn-icons/retry-light.svg';
import retryDark from '../../../assets/turn-icons/retry-dark.svg';
import reportLight from '../../../assets/turn-icons/report-light.svg';
import reportDark from '../../../assets/turn-icons/report-dark.svg';
import moreLight from '../../../assets/turn-icons/more-light.svg';
import moreDark from '../../../assets/turn-icons/more-dark.svg';

export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' || theme === 'evening';
  });
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDark(theme === 'dark' || theme === 'evening');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

const iconStyle: CSSProperties = { width: 16, height: 16, display: 'block' };

interface IconProps {
  readonly isDark: boolean;
  readonly style?: CSSProperties;
}

export function CopyIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? copyDark : copyLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function CheckIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? checkDark : checkLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function ForkIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? forkDark : forkLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function LikeIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? likeDark : likeLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function LikeActiveIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? likeActiveDark : likeActiveLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function DislikeIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? dislikeDark : dislikeLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function DislikeActiveIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? dislikeActiveDark : dislikeActiveLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function FavoriteIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? favoriteDark : favoriteLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function FavoriteActiveIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? favoriteActiveDark : favoriteActiveLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function RetryIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? retryDark : retryLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function ShareIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? shareDark : shareLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function ReportIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? reportDark : reportLight} alt="" style={{ ...iconStyle, ...style }} />;
}
export function MoreIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? moreDark : moreLight} alt="" style={{ ...iconStyle, ...style }} />;
}

import complaintFeedbackLight from '../../../assets/turn-icons/complaint-feedback-light.svg';
import complaintFeedbackDark from '../../../assets/turn-icons/complaint-feedback-dark.svg';

export function ComplaintIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? complaintFeedbackDark : complaintFeedbackLight} alt="" style={{ ...iconStyle, ...style }} />;
}

import editLight from '../../../assets/turn-icons/edit-light.svg';
import editDark from '../../../assets/turn-icons/edit-dark.svg';

export function EditIcon({ isDark, style }: IconProps) {
  return <img src={isDark ? editDark : editLight} alt="" style={{ ...iconStyle, ...style }} />;
}
