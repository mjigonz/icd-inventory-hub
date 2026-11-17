import React, { createContext, useContext } from 'react';
import {
  BackgroundIconTheme,
  isCharacterFreeEnterpriseTheme,
} from './TelegramDoodleBackground';

export type DecorationAnchorPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-border'
  | 'sidebar-edge'
  | 'header-edge'
  | 'empty-state'
  | 'inside-corner';

export type DecorationTier = 'major' | 'secondary' | 'playful';

export interface DecorationContextValue {
  activeTheme: BackgroundIconTheme;
  selectedTheme: BackgroundIconTheme;
  seasonalDecorations: boolean;
  onSetSeasonalDecorations?: (enabled: boolean) => void;
}

const DecorationContext = createContext<DecorationContextValue>({
  activeTheme: 'default',
  selectedTheme: 'default',
  seasonalDecorations: true,
});

export const DecorationProvider: React.FC<{
  value: DecorationContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => {
  return <DecorationContext.Provider value={value}>{children}</DecorationContext.Provider>;
};

export const useDecorationSettings = () => useContext(DecorationContext);

interface PanelDecorationProps {
  /** Anchor placement relative to the parent panel (`relative` parent container) */
  position: DecorationAnchorPosition;
  /** Density tier: 'major' shows in Minimal+, 'secondary' & 'playful' show in Balanced+ */
  tier?: DecorationTier;
  /** Character/object variation index (0..5) so panels show diverse characters from the theme */
  variant?: 0 | 1 | 2 | 3 | 4 | 5;
  /** Optional override theme ID */
  themeOverride?: BackgroundIconTheme;
  /** Optional extra classes for fine-tuned placement */
  className?: string;
  /** Whether to hide on very small mobile screens to keep compact panels uncluttered */
  hideOnMobile?: boolean;
}

/**
 * Renders theme-specific 2D vector SVG characters, animals, and ornaments physically
 * perched on, hanging from, peeking behind, or resting inside UI panels across ALL 16 themes.
 */
function renderThemeCharacterSvg(
  theme: BackgroundIconTheme,
  position: DecorationAnchorPosition,
  variant: number
): React.ReactNode {
  const v = ((variant % 4) + 4) % 4;
  const isHanging =
    position === 'header-edge' ||
    position === 'sidebar-edge' ||
    (position === 'top-border' && (v === 1 || v === 3));
  const isPeeking = position === 'bottom-left' || position === 'bottom-right';

  switch (theme) {
    // =========================================================================
    // 1. CHRISTMAS
    // Characters: Tiny Santa Claus, Christmas elves, Miniature reindeer,
    // Snowmen, Gingerbread man, Hanging stockings, Candy canes, Ornaments
    // =========================================================================
    case 'christmas': {
      if (isHanging) {
        if (v % 2 === 0) {
          // Hanging Christmas Stocking, Candy Cane & Pine Garland
          return (
            <svg className="w-10 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 42 42" fill="none">
              <path d="M3 2C13 6 29 6 39 2" stroke="#15803D" strokeWidth="2.6" strokeLinecap="round" />
              <circle cx="10" cy="4" r="1.7" fill="#DC2626" />
              <circle cx="21" cy="4.8" r="1.7" fill="#FBBF24" />
              <circle cx="32" cy="4" r="1.7" fill="#DC2626" />
              {/* Hanging Stocking */}
              <path d="M16 4v5" stroke="#B91C1C" strokeWidth="1.8" strokeLinecap="round" />
              <rect x="10" y="8" width="12" height="5" rx="2.5" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1" />
              <path d="M11.5 13h9v11c0 3.5-2.5 6-6 6H9c-2.2 0-4-1.8-4-4 0-2 1.6-3.6 3.6-3.8l2.9-.3V13z" fill="#DC2626" />
              <path d="M5 26c0 2.2 1.8 4 4 4h2v-4.2l-2.4.2C6.6 26 5 26 5 26z" fill="#F8FAFC" />
              {/* Hanging Candy Cane on right */}
              <path d="M31 5v15c0 2.5 2 4.5 4.5 4.5S40 22.5 40 20" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
              <path d="M31 7v3M31 13v3M31 19v2" stroke="#DC2626" strokeWidth="3.2" strokeLinecap="round" />
            </svg>
          );
        }
        // Hanging Red & Gold Bauble Ornaments + Gingerbread Star
        return (
          <svg className="w-11 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 46 40" fill="none">
            <line x1="12" y1="0" x2="12" y2="11" stroke="#94A3B8" strokeWidth="1.2" />
            <rect x="9.5" y="10" width="5" height="2.5" rx="1" fill="#F59E0B" />
            <circle cx="12" cy="18.5" r="6.5" fill="#DC2626" />
            <path d="M8.5 16.5c2-1.5 5-1.5 7 0" stroke="#FCA5A5" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="28" y1="0" x2="28" y2="15" stroke="#94A3B8" strokeWidth="1.2" />
            <rect x="25.5" y="14" width="5" height="2.5" rx="1" fill="#D97706" />
            <circle cx="28" cy="22" r="5.5" fill="#FBBF24" />
            <circle cx="26.2" cy="20.2" r="1.5" fill="#FEF08A" />
            <polygon points="39,8 40.2,11 43.5,11.3 41,13.4 41.8,16.5 39,14.8 36.2,16.5 37,13.4 34.5,11.3 37.8,11" fill="#FDE047" />
          </svg>
        );
      }

      if (isPeeking) {
        // Peeking Miniature Reindeer & Baby Penguin Duo
        return (
          <svg className="w-12 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 50 36" fill="none">
            {/* Reindeer */}
            <path d="M10 12L6 5M8 8l-3 1M10 9l2-3" stroke="#78350F" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M26 12l4-7M28 8l3 1M26 9l-2-3" stroke="#78350F" strokeWidth="1.8" strokeLinecap="round" />
            <ellipse cx="9" cy="16" rx="2.8" ry="1.6" transform="rotate(-20 9 16)" fill="#92400E" />
            <ellipse cx="27" cy="16" rx="2.8" ry="1.6" transform="rotate(20 27 16)" fill="#92400E" />
            <path d="M10 30c0-7 3.8-13 8-13s8 6 8 13H10z" fill="#B45309" />
            <ellipse cx="18" cy="27" rx="5" ry="3.8" fill="#FDE68A" />
            <circle cx="14.5" cy="21" r="1.3" fill="#1E293B" className="char-anim-blink" />
            <circle cx="21.5" cy="21" r="1.3" fill="#1E293B" className="char-anim-blink" />
            <circle cx="18" cy="25.5" r="2.3" fill="#EF4444" />
            <rect x="7.5" y="28" width="4" height="3.2" rx="1.5" fill="#78350F" />
            <rect x="24.5" y="28" width="4" height="3.2" rx="1.5" fill="#78350F" />
            {/* Gingerbread buddy peeking next to reindeer */}
            <circle cx="39" cy="21" r="6" fill="#B45309" stroke="#FEF3C7" strokeWidth="1" />
            <circle cx="37" cy="20" r="1" fill="#FFFFFF" />
            <circle cx="41" cy="20" r="1" fill="#FFFFFF" />
            <path d="M37 23c1.2 1 2.8 1 4 0" stroke="#EF4444" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        );
      }

      if (v === 0) {
        // Tiny Santa Claus sitting on card edge with Gift Sack
        return (
          <svg className="w-11 h-10 drop-shadow-2xs" viewBox="0 0 46 44" fill="none">
            {/* Gift Box beside Santa */}
            <rect x="29" y="25" width="10" height="9" rx="1.5" fill="#16A34A" stroke="#15803D" strokeWidth="1" />
            <line x1="34" y1="25" x2="34" y2="34" stroke="#FBBF24" strokeWidth="2" />
            <line x1="29" y1="29.5" x2="39" y2="29.5" stroke="#FBBF24" strokeWidth="2" />
            {/* Santa Hat */}
            <path d="M10 15c2-7 9-10 16-7l3 5-19 2z" fill="#DC2626" />
            <circle cx="30" cy="13" r="2.8" fill="#FFFFFF" />
            <rect x="8.5" y="13.5" width="17" height="4" rx="2" fill="#FFFFFF" />
            {/* Face & Fluffy Beard */}
            <circle cx="17" cy="20" r="5.5" fill="#FDBA74" />
            <circle cx="15" cy="19" r="1.1" fill="#0F172A" className="char-anim-blink" />
            <circle cx="19" cy="19" r="1.1" fill="#0F172A" className="char-anim-blink" />
            <circle cx="17" cy="20.8" r="1.3" fill="#EF4444" />
            <path d="M10.5 21.5c0 5 3 8.5 6.5 8.5s6.5-3.5 6.5-8.5c-2 1-4.2 1.2-6.5 1.2s-4.5-.2-6.5-1.2z" fill="#FFFFFF" />
            {/* Coat */}
            <rect x="10" y="27" width="14" height="8" rx="3" fill="#DC2626" />
            <rect x="10" y="31" width="14" height="2" fill="#1E293B" />
            <rect x="15.5" y="30.5" width="3" height="3" rx="0.5" stroke="#FBBF24" strokeWidth="1.2" />
            {/* Dangling Boots */}
            <g className="char-anim-swing">
              <rect x="12" y="35" width="3.5" height="5.5" rx="1.5" fill="#1E293B" />
              <rect x="18.5" y="35" width="3.5" height="5.5" rx="1.5" fill="#1E293B" />
            </g>
          </svg>
        );
      }

      if (v === 1) {
        // Christmas Elf sitting & swinging legs + Candy Cane
        return (
          <svg className="w-10 h-10 drop-shadow-2xs" viewBox="0 0 42 44" fill="none">
            <path d="M12 15L21 4l7 11H12z" fill="#16A34A" />
            <circle cx="21" cy="4" r="2.2" fill="#FDE047" />
            <rect x="11" y="14" width="18" height="3" rx="1.5" fill="#DC2626" />
            <path d="M9 19l3-1.5v3.5L9 19zM31 19l-3-1.5v3.5L31 19z" fill="#FDBA74" />
            <circle cx="20" cy="20" r="5" fill="#FDBA74" />
            <circle cx="18" cy="19.5" r="1" fill="#0F172A" className="char-anim-blink" />
            <circle cx="22" cy="19.5" r="1" fill="#0F172A" className="char-anim-blink" />
            <path d="M18 22c1.2 1 2.8 1 4 0" stroke="#B45309" strokeWidth="1.1" strokeLinecap="round" />
            <rect x="14" y="25" width="12" height="9" rx="2.5" fill="#16A34A" />
            <path d="M14 25l3 2.5 3-2.5 3 2.5 3-2.5" fill="#DC2626" />
            <g className="char-anim-swing">
              <rect x="15.5" y="34" width="3" height="6.5" rx="1.5" fill="#DC2626" />
              <line x1="15.5" y1="36.5" x2="18.5" y2="36.5" stroke="#FFFFFF" strokeWidth="1.3" />
              <rect x="21.5" y="34" width="3" height="6.5" rx="1.5" fill="#DC2626" />
              <line x1="21.5" y1="36.5" x2="24.5" y2="36.5" stroke="#FFFFFF" strokeWidth="1.3" />
            </g>
          </svg>
        );
      }

      if (v === 2) {
        // Gingerbread Man & Tiny Pine Tree Duo
        return (
          <svg className="w-11 h-9 char-anim-bounce drop-shadow-2xs" viewBox="0 0 44 38" fill="none">
            {/* Pine Tree */}
            <polygon points="33,8 26,20 40,20" fill="#15803D" />
            <polygon points="33,15 25,29 41,29" fill="#16A34A" />
            <rect x="31.5" y="29" width="3" height="4" fill="#78350F" />
            <circle cx="33" cy="7.5" r="1.8" fill="#FACC15" />
            {/* Gingerbread Character */}
            <circle cx="15" cy="14" r="5.5" fill="#B45309" />
            <rect x="10.5" y="19" width="9" height="10" rx="4" fill="#B45309" />
            <path d="M7 21h16" stroke="#B45309" strokeWidth="4" strokeLinecap="round" />
            <circle cx="13.2" cy="13.2" r="1" fill="#FFFFFF" className="char-anim-blink" />
            <circle cx="16.8" cy="13.2" r="1" fill="#FFFFFF" className="char-anim-blink" />
            <path d="M13.2 16c1 .9 2.6.9 3.6 0" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="15" cy="22" r="1.2" fill="#EF4444" />
            <circle cx="15" cy="25.5" r="1.2" fill="#22C55E" />
          </svg>
        );
      }

      // Snowman with cozy red scarf + Cardinal Bird perched on hat
      return (
        <svg className="w-10 h-10 char-anim-tilt drop-shadow-2xs" viewBox="0 0 42 40" fill="none">
          <rect x="13" y="5" width="12" height="6" rx="1" fill="#1E293B" />
          <rect x="10.5" y="10" width="17" height="2" rx="1" fill="#1E293B" />
          <rect x="13" y="9" width="12" height="1.5" fill="#DC2626" />
          {/* Tiny red cardinal on hat */}
          <circle cx="23" cy="3.5" r="2.2" fill="#EF4444" />
          <polygon points="25,3.5 27,4 25,4.5" fill="#F59E0B" />
          {/* Snowman */}
          <circle cx="19" cy="17" r="6" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
          <circle cx="19" cy="29" r="8" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
          <circle cx="17" cy="16" r="1" fill="#0F172A" className="char-anim-blink" />
          <circle cx="21" cy="16" r="1" fill="#0F172A" className="char-anim-blink" />
          <polygon points="19,17 25,18.5 19,19.2" fill="#F97316" />
          <rect x="13" y="21.5" width="12" height="3" rx="1.5" fill="#DC2626" />
          <rect x="21" y="23" width="3" height="6" rx="1.2" fill="#DC2626" />
          <circle cx="19" cy="27.5" r="1" fill="#1E293B" />
          <circle cx="19" cy="31" r="1" fill="#1E293B" />
        </svg>
      );
    }

    // =========================================================================
    // 2. HALLOWEEN
    // Characters: Cute ghosts, Tiny bats, Black cats, Pumpkins,
    // Miniature witches, Spiders hanging from threads, Candy corn
    // =========================================================================
    case 'halloween': {
      if (isHanging) {
        if (v % 2 === 0) {
          // Tiny Bat hanging upside down & Spider on silk thread
          return (
            <svg className="w-11 h-10 drop-shadow-2xs" viewBox="0 0 44 40" fill="none">
              <line x1="10" y1="0" x2="10" y2="21" stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 1" />
              <g className="char-anim-sway">
                <circle cx="10" cy="23" r="3.4" fill="#1E1B4B" />
                <path d="M6.8 21l-2.8-1.5M6.8 23l-3 0M6.8 25l-2.8 1.5M13.2 21l2.8-1.5M13.2 23l3 0M13.2 25l2.8 1.5" stroke="#1E1B4B" strokeWidth="1" strokeLinecap="round" />
                <circle cx="8.8" cy="23.5" r="0.8" fill="#FB923C" />
                <circle cx="11.2" cy="23.5" r="0.8" fill="#FB923C" />
              </g>
              <path d="M28 0v4M32 0v4" stroke="#312E81" strokeWidth="1.3" strokeLinecap="round" />
              <g className="char-anim-wing">
                <path d="M30 10c-5-4-10-2-11 3 3-1 5 0 7 2 2-2 4-5 4-5z" fill="#312E81" />
                <path d="M30 10c5-4 10-2 11 3-3-1-5 0-7 2-2-2-4-5-4-5z" fill="#312E81" />
              </g>
              <ellipse cx="30" cy="11" rx="4.2" ry="5.2" fill="#1E1B4B" />
              <polygon points="27,15 28.5,19 30,15.5" fill="#1E1B4B" />
              <polygon points="33,15 31.5,19 30,15.5" fill="#1E1B4B" />
              <circle cx="28.5" cy="12" r="0.9" fill="#FBBF24" className="char-anim-blink" />
              <circle cx="31.5" cy="12" r="0.9" fill="#FBBF24" className="char-anim-blink" />
            </svg>
          );
        }
        // Corner Cobweb + Hanging Pumpkin Lantern + Mini Ghost
        return (
          <svg className="w-11 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 40" fill="none">
            <path d="M2 2l22 6M2 2l16 16M2 2l6 22M10 4c0 4-2 6-6 6M16 6c-1 6-4 9-10 10" stroke="#94A3B8" strokeOpacity="0.6" strokeWidth="1.1" strokeLinecap="round" />
            <line x1="30" y1="0" x2="30" y2="12" stroke="#78350F" strokeWidth="1.2" />
            <ellipse cx="30" cy="18" rx="6.5" ry="5.5" fill="#F97316" />
            <polygon points="27.5,16.5 29,18.5 26.5,18.5" fill="#FEF08A" />
            <polygon points="32.5,16.5 33.5,18.5 31,18.5" fill="#FEF08A" />
            <path d="M27.5 20.5c1.5 1 3.5 1 5 0" stroke="#FEF08A" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        );
      }

      if (isPeeking) {
        // Black Cat & Mini Pumpkin peeking from bottom edge
        return (
          <svg className="w-12 h-8 drop-shadow-2xs" viewBox="0 0 48 32" fill="none">
            <polygon points="9,16 11,6 17,13" fill="#18181B" />
            <polygon points="10.5,14 11.8,8.5 15.5,13" fill="#F472B6" fillOpacity="0.6" />
            <polygon points="27,16 25,6 19,13" fill="#18181B" />
            <polygon points="25.5,14 24.2,8.5 20.5,13" fill="#F472B6" fillOpacity="0.6" />
            <path d="M8 28c0-7.5 4.5-13 10-13s10 5.5 10 13H8z" fill="#18181B" />
            <g className="char-anim-blink">
              <ellipse cx="14.2" cy="20.5" rx="2.1" ry="2.3" fill="#FACC15" />
              <ellipse cx="14.2" cy="20.5" rx="0.7" ry="1.8" fill="#09090B" />
              <ellipse cx="21.8" cy="20.5" rx="2.1" ry="2.3" fill="#FACC15" />
              <ellipse cx="21.8" cy="20.5" rx="0.7" ry="1.8" fill="#09090B" />
            </g>
            <polygon points="18,23.5 16.8,22.2 19.2,22.2" fill="#F472B6" />
            <ellipse cx="10" cy="28" rx="2.8" ry="1.8" fill="#27272A" />
            <ellipse cx="26" cy="28" rx="2.8" ry="1.8" fill="#27272A" />
            {/* Tiny pumpkin companion */}
            <ellipse cx="38" cy="24" rx="6" ry="5" fill="#F97316" />
            <circle cx="36" cy="23" r="0.9" fill="#FEF08A" />
            <circle cx="40" cy="23" r="0.9" fill="#FEF08A" />
          </svg>
        );
      }

      if (v === 0) {
        // Cute Ghost gently floating on panel corner with tiny witch hat
        return (
          <svg className="w-10 h-10 char-anim-float drop-shadow-2xs" viewBox="0 0 40 42" fill="none">
            <path d="M15 12L21 3l5 9H15z" fill="#581C87" />
            <ellipse cx="20.5" cy="12" rx="8.5" ry="2" fill="#581C87" />
            <rect x="16.2" y="10" width="8.5" height="1.6" rx="0.8" fill="#F97316" />
            <path d="M11 23c0-5.5 4.2-10 9.5-10S30 17.5 30 23v12c-2-2-3.2 0-4.8 0-1.6 0-2.6-2-4.7-2-2.1 0-3.1 2-4.7 2-1.6 0-2.8-2-4.8 0V23z" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1" />
            <circle cx="17.5" cy="21" r="1.4" fill="#1E293B" className="char-anim-blink" />
            <circle cx="23.5" cy="21" r="1.4" fill="#1E293B" className="char-anim-blink" />
            <ellipse cx="15.2" cy="23" rx="1.5" ry="0.9" fill="#FDA4AF" />
            <ellipse cx="25.8" cy="23" rx="1.5" ry="0.9" fill="#FDA4AF" />
            <ellipse cx="20.5" cy="23.2" rx="1.3" ry="1.6" fill="#1E293B" />
          </svg>
        );
      }

      if (v === 1) {
        // Miniature Witch Cat sitting with Purple Hat & Wand
        return (
          <svg className="w-10 h-10 char-anim-tilt drop-shadow-2xs" viewBox="0 0 42 40" fill="none">
            <polygon points="12,14 20,2 28,14" fill="#6B21A8" />
            <ellipse cx="20" cy="14" rx="9" ry="2.2" fill="#581C87" />
            <circle cx="20" cy="21" r="6.5" fill="#18181B" />
            <path d="M12 34c0-5 3.5-9 8-9s8 4 8 9H12z" fill="#18181B" />
            <circle cx="17.5" cy="20.5" r="1.3" fill="#FACC15" className="char-anim-blink" />
            <circle cx="22.5" cy="20.5" r="1.3" fill="#FACC15" className="char-anim-blink" />
            <path d="M28 32c5 0 8-4 7-8" stroke="#18181B" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        );
      }

      // Perched Jack-o'-Lantern Pumpkin Trio
      return (
        <svg className="w-11 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 44 36" fill="none">
          <path d="M17 9c0-3 2-5 4-4" stroke="#15803D" strokeWidth="2.2" strokeLinecap="round" />
          <ellipse cx="17" cy="21" rx="10" ry="8.5" fill="#EA580C" />
          <ellipse cx="17" cy="21" rx="6.5" ry="8.5" fill="#F97316" />
          <polygon points="12.5,19 14.5,16 16,19" fill="#FEF08A" />
          <polygon points="18.5,19 20,16 22,19" fill="#FEF08A" />
          <path d="M13 23c2.2 2.2 5.8 2.2 8 0" stroke="#FEF08A" strokeWidth="1.6" strokeLinecap="round" />
          {/* Second smaller pumpkin */}
          <ellipse cx="33" cy="24" rx="6.5" ry="5.5" fill="#FB923C" />
          <circle cx="31" cy="23" r="0.9" fill="#FEF08A" />
          <circle cx="35" cy="23" r="0.9" fill="#FEF08A" />
        </svg>
      );
    }

    // =========================================================================
    // 3. HEARTS & VALENTINE'S
    // Characters: Tiny Cupid, Lovebirds, Hanging hearts, Teddy bears, Roses, Balloons
    // =========================================================================
    case 'valentines': {
      if (isHanging) {
        return (
          <svg className="w-11 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 38" fill="none">
            <line x1="11" y1="0" x2="11" y2="12" stroke="#FDA4AF" strokeWidth="1.2" />
            <path d="M11 22l-1-0.9C6.4 17.8 4 15.6 4 13c0-2.1 1.7-3.8 3.8-3.8 1.2 0 2.3.6 3.2 1.5.9-.9 2-1.5 3.2-1.5 2.1 0 3.8 1.7 3.8 3.8 0 2.6-2.4 4.8-6 8.1L11 22z" fill="#E11D48" />
            <line x1="25" y1="0" x2="25" y2="17" stroke="#FDA4AF" strokeWidth="1.2" />
            <path d="M25 25l-.8-.7C21.3 21.7 19.5 20 19.5 18c0-1.6 1.3-2.9 2.9-2.9.9 0 1.8.4 2.6 1.1.8-.7 1.7-1.1 2.6-1.1 1.6 0 2.9 1.3 2.9 2.9 0 2-1.8 3.7-4.7 6.3L25 25z" fill="#FB7185" />
            <line x1="37" y1="0" x2="37" y2="10" stroke="#FDA4AF" strokeWidth="1.2" />
            <circle cx="37" cy="13" r="3.5" fill="#F43F5E" />
          </svg>
        );
      }

      if (v === 0) {
        // Pair of Lovebirds perched together with floating heart
        return (
          <svg className="w-11 h-9 drop-shadow-2xs" viewBox="0 0 44 36" fill="none">
            <path className="char-anim-bounce" d="M22 10l-.6-.5C19.2 7.5 18 6.3 18 4.8 18 3.5 19 2.5 20.2 2.5c.7 0 1.4.3 1.8.9.4-.6 1.1-.9 1.8-.9 1.2 0 2.2 1 2.2 2.3 0 1.5-1.2 2.7-3.4 4.7L22 10z" fill="#E11D48" />
            <path d="M9 28c0-6 3.5-10 8-10 3.5 0 5 2.5 5 6v4H9z" fill="#FB7185" />
            <circle cx="17.5" cy="21" r="1" fill="#1F1216" className="char-anim-blink" />
            <polygon points="22,21.5 24.5,22.2 22,23" fill="#F59E0B" />
            <path d="M35 28c0-6-3.5-10-8-10-3.5 0-5 2.5-5 6v4h13z" fill="#F43F5E" />
            <circle cx="26.5" cy="21" r="1" fill="#1F1216" className="char-anim-blink" />
            <polygon points="22,21.5 19.5,22.2 22,23" fill="#F59E0B" />
          </svg>
        );
      }

      if (v === 1) {
        // Tiny Winged Cupid Character with Golden Bow & Heart
        return (
          <svg className="w-11 h-10 char-anim-float drop-shadow-2xs" viewBox="0 0 44 40" fill="none">
            {/* Angel wings */}
            <path d="M14 21c-5-3-9-1-9 3 2 1 5 1 9-3z" fill="#FFF1F2" stroke="#FDA4AF" strokeWidth="1" />
            <path d="M28 21c5-3 9-1 9 3-2 1-5 1-9-3z" fill="#FFF1F2" stroke="#FDA4AF" strokeWidth="1" />
            {/* Halo & Head */}
            <ellipse cx="21" cy="8" rx="4.5" ry="1.3" stroke="#FBBF24" strokeWidth="1.4" />
            <circle cx="21" cy="15" r="5.5" fill="#FDBA74" />
            <circle cx="19" cy="14.5" r="1" fill="#1E293B" className="char-anim-blink" />
            <circle cx="23" cy="14.5" r="1" fill="#1E293B" className="char-anim-blink" />
            <rect x="15" y="20" width="12" height="10" rx="4" fill="#FFE4E6" />
            <path d="M21 29l-.7-.6c-2.5-2.2-4-3.6-4-5.2 0-1.3 1-2.3 2.3-2.3.8 0 1.6.4 2.4 1.1.8-.7 1.6-1.1 2.4-1.1 1.3 0 2.3 1 2.3 2.3 0 1.6-1.5 3-4 5.2L21 29z" fill="#E11D48" />
          </svg>
        );
      }

      // Cute Teddy Bear holding a crimson heart + Blooming Rose
      return (
        <svg className="w-10 h-10 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 38" fill="none">
          <circle cx="11.5" cy="11" r="4" fill="#92400E" />
          <circle cx="11.5" cy="11" r="2.2" fill="#FDE68A" />
          <circle cx="26.5" cy="11" r="4" fill="#92400E" />
          <circle cx="26.5" cy="11" r="2.2" fill="#FDE68A" />
          <circle cx="19" cy="17" r="7.5" fill="#B45309" />
          <ellipse cx="19" cy="29" rx="8" ry="6.5" fill="#B45309" />
          <ellipse cx="19" cy="18.8" rx="3.2" ry="2.4" fill="#FEF3C7" />
          <circle cx="16" cy="15.8" r="1.1" fill="#1C1917" className="char-anim-blink" />
          <circle cx="22" cy="15.8" r="1.1" fill="#1C1917" className="char-anim-blink" />
          <ellipse cx="19" cy="18" rx="1.3" ry="0.9" fill="#451A03" />
          <path className="char-anim-bounce" d="M19 32.5l-.8-.7C15 29 13 27.2 13 25c0-1.8 1.4-3.2 3.2-3.2 1 0 2 .5 2.8 1.3.8-.8 1.8-1.3 2.8-1.3 1.8 0 3.2 1.4 3.2 3.2 0 2.2-2 4-5.2 6.8l-.8.7z" fill="#E11D48" />
        </svg>
      );
    }

    // =========================================================================
    // 4. NEW YEAR
    // Characters: Miniature fireworks, Party hats, Hanging stars, Celebration owls/bears
    // =========================================================================
    case 'new_year': {
      if (isHanging) {
        return (
          <svg className="w-11 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 38" fill="none">
            <line x1="12" y1="0" x2="12" y2="11" stroke="#FBBF24" strokeWidth="1.2" />
            <polygon points="12,10 13.8,14 18,14.5 14.8,17.3 15.7,21.5 12,19.3 8.3,21.5 9.2,17.3 6,14.5 10.2,14" fill="#FBBF24" />
            <line x1="28" y1="0" x2="28" y2="16" stroke="#F59E0B" strokeWidth="1.2" />
            <polygon points="28,15 29.4,18.2 33,18.6 30.2,21 31,24.5 28,22.6 25,24.5 25.8,21 23,18.6 26.6,18.2" fill="#FDE047" />
            <circle cx="20" cy="8" r="1.6" fill="#EC4899" />
            <circle cx="38" cy="11" r="1.5" fill="#38BDF8" />
          </svg>
        );
      }

      if (v % 2 === 1) {
        // Celebration Bear with Party Blower & Confetti Star
        return (
          <svg className="w-11 h-10 char-anim-tilt drop-shadow-2xs" viewBox="0 0 44 38" fill="none">
            <polygon points="14,12 19,3 24,12" fill="#EC4899" />
            <circle cx="19" cy="2.5" r="1.8" fill="#FDE047" />
            <circle cx="12" cy="13" r="3" fill="#F59E0B" />
            <circle cx="26" cy="13" r="3" fill="#F59E0B" />
            <path d="M10 31c0-6.5 4-12 9-12s9 5.5 9 12H10z" fill="#FBBF24" />
            <circle cx="16.5" cy="21" r="1.1" fill="#1E293B" className="char-anim-blink" />
            <circle cx="21.5" cy="21" r="1.1" fill="#1E293B" className="char-anim-blink" />
            {/* Party horn */}
            <path d="M21 24l11-2" stroke="#4F46E5" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="33" cy="22" r="2.2" fill="#EC4899" />
          </svg>
        );
      }

      // Festive Party Character with Gold Cone Hat & Miniature Fireworks
      return (
        <svg className="w-11 h-9 char-anim-bounce drop-shadow-2xs" viewBox="0 0 44 38" fill="none">
          <path d="M34 6v6M31 9h6M32 7l4 4M36 7l-4 4" stroke="#FBBF24" strokeWidth="1.5" strokeLinecap="round" />
          <polygon points="11,22 18,5 25,22" fill="#4F46E5" />
          <path d="M13.5 16h9M15.5 11h5" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="18" cy="4.5" r="2.2" fill="#FDE047" />
          <path d="M10 34c0-6 3.6-11 8-11s8 5 8 11H10z" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1.2" />
          <circle cx="15.5" cy="27.5" r="1.2" fill="#1E293B" className="char-anim-blink" />
          <circle cx="20.5" cy="27.5" r="1.2" fill="#1E293B" className="char-anim-blink" />
          <path d="M16 30.5c1.2 1.2 2.8 1.2 4 0" stroke="#D97706" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    }

    // =========================================================================
    // 5. MIDNIGHT PROFESSIONAL
    // Characters: Astro-Bots, Cyber Cats, Midnight Owls & Constellation Stars
    // =========================================================================
    case 'midnight_professional': {
      if (isHanging) {
        // Hanging Cyber Drone & Glowing Constellation Star
        return (
          <svg className="w-11 h-9 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 36" fill="none">
            <line x1="15" y1="0" x2="15" y2="11" stroke="#38BDF8" strokeWidth="1.2" strokeDasharray="2 1" />
            <rect x="8" y="11" width="14" height="9" rx="3" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.3" />
            <circle cx="12.5" cy="15.5" r="1.3" fill="#38BDF8" className="char-anim-blink" />
            <circle cx="17.5" cy="15.5" r="1.3" fill="#38BDF8" className="char-anim-blink" />
            <line x1="32" y1="0" x2="32" y2="15" stroke="#38BDF8" strokeWidth="1" />
            <polygon points="32,14 33.5,17.5 37,18 34.2,20.2 35,23.8 32,22 29,23.8 29.8,20.2 27,18 30.5,17.5" fill="#38BDF8" />
          </svg>
        );
      }

      if (v % 2 === 1) {
        // Sleek Midnight Cyber-Cat with Glowing Cyan Eyes & Crescent Moon
        return (
          <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
            <polygon points="11,15 13,6 18,13" fill="#0F172A" stroke="#38BDF8" strokeWidth="1" />
            <polygon points="27,15 25,6 20,13" fill="#0F172A" stroke="#38BDF8" strokeWidth="1" />
            <path d="M10 29c0-7 4-13 9-13s9 6 9 13H10z" fill="#0F172A" stroke="#334155" strokeWidth="1.2" />
            <circle cx="16" cy="20.5" r="1.5" fill="#38BDF8" className="char-anim-blink" />
            <circle cx="22" cy="20.5" r="1.5" fill="#38BDF8" className="char-anim-blink" />
            <path d="M28 27c5 0 8-4 7-8" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
      }

      // Cute Astro-Bot sitting on panel border with glowing antenna
      return (
        <svg className="w-10 h-9 char-anim-float drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
          <line x1="20" y1="9" x2="20" y2="4" stroke="#38BDF8" strokeWidth="1.6" />
          <circle cx="20" cy="3.5" r="2" fill="#7DD3FC" />
          <rect x="9" y="9" width="22" height="14" rx="4.5" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.4" />
          <rect x="12" y="12" width="16" height="8" rx="2.5" fill="#1E293B" />
          <circle cx="16.5" cy="16" r="1.6" fill="#38BDF8" className="char-anim-blink" />
          <circle cx="23.5" cy="16" r="1.6" fill="#38BDF8" className="char-anim-blink" />
          <g className="char-anim-swing">
            <rect x="14" y="23" width="3.5" height="5.5" rx="1.5" fill="#334155" />
            <rect x="22.5" y="23" width="3.5" height="5.5" rx="1.5" fill="#334155" />
          </g>
        </svg>
      );
    }

    // =========================================================================
    // 15. EMERALD OPERATIONS
    // Characters: Emerald Tree Frogs, Sprout Spirits, Chameleons & Eucalyptus Vines
    // =========================================================================
    case 'emerald_operations': {
      if (isHanging) {
        // Hanging Eucalyptus Vine & Emerald Lantern
        return (
          <svg className="w-11 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 42 40" fill="none">
            <path d="M12 0c-2 9 3 16 0 26" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" />
            <ellipse cx="9" cy="10" rx="3.8" ry="2" transform="rotate(-20 9 10)" fill="#10B981" />
            <ellipse cx="16" cy="17" rx="3.8" ry="2" transform="rotate(20 16 17)" fill="#34D399" />
            <line x1="29" y1="0" x2="29" y2="12" stroke="#059669" strokeWidth="1.3" />
            <rect x="24" y="12" width="10" height="11" rx="2.5" fill="#065F46" stroke="#34D399" strokeWidth="1.2" />
            <circle cx="29" cy="17.5" r="2.2" fill="#A7F3D0" />
          </svg>
        );
      }

      if (v % 2 === 1) {
        // Cute Emerald Tree Frog perched on panel border
        return (
          <svg className="w-10 h-8 char-anim-bounce drop-shadow-2xs" viewBox="0 0 40 32" fill="none">
            <ellipse cx="20" cy="22" rx="9" ry="6" fill="#10B981" />
            <ellipse cx="20" cy="24" rx="6" ry="3.5" fill="#D1FAE5" />
            <circle cx="14.5" cy="15.5" r="3.2" fill="#10B981" />
            <circle cx="25.5" cy="15.5" r="3.2" fill="#10B981" />
            <circle cx="14.5" cy="15.5" r="1.4" fill="#064E3B" className="char-anim-blink" />
            <circle cx="25.5" cy="15.5" r="1.4" fill="#064E3B" className="char-anim-blink" />
            <path d="M16.5 20.5c2 1.5 5 1.5 7 0" stroke="#065F46" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        );
      }

      // Cute Emerald Sprout Spirit Companion with Leaf Hat
      return (
        <svg className="w-10 h-9 char-anim-sway drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
          <path d="M20 14V7" stroke="#059669" strokeWidth="2" strokeLinecap="round" />
          <path d="M20 10c-5-1-8-4-7-7 4-1 7 2 7 7z" fill="#10B981" />
          <path d="M20 9c5-1 8-4 7-7-4-1-7 2-7 7z" fill="#34D399" />
          <path d="M11 29c0-6.5 4-12 9-12s9 5.5 9 12H11z" fill="#D1FAE5" stroke="#10B981" strokeWidth="1.3" />
          <circle cx="17" cy="22" r="1.2" fill="#064E3B" className="char-anim-blink" />
          <circle cx="23" cy="22" r="1.2" fill="#064E3B" className="char-anim-blink" />
          <path d="M18 24.8c1.2 1 2.8 1 4 0" stroke="#059669" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    }

    // =========================================================================
    // 16. MODERN ENTERPRISE (DEFAULT)
    // Characters: Friendly Blue Audit Bot, Wise Owl Auditor, Office Cat & Scanner Mascot
    // =========================================================================
    case 'default':
    default: {
      if (isHanging) {
        // Hanging Blue Inventory Badge & Cloud Companion
        return (
          <svg className="w-11 h-9 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 36" fill="none">
            <line x1="15" y1="0" x2="15" y2="11" stroke="#3B82F6" strokeWidth="1.4" />
            <rect x="9" y="11" width="12" height="14" rx="2.5" fill="#2563EB" />
            <rect x="11.5" y="14" width="7" height="5" rx="1" fill="#EFF6FF" />
            <circle cx="13.5" cy="16.5" r="0.9" fill="#1D4ED8" className="char-anim-blink" />
            <circle cx="16.5" cy="16.5" r="0.9" fill="#1D4ED8" className="char-anim-blink" />
            <line x1="31" y1="0" x2="31" y2="14" stroke="#60A5FA" strokeWidth="1.2" />
            <polygon points="31,13 32.5,16.5 36,17 33.2,19.2 34,22.8 31,21 28,22.8 28.8,19.2 26,17 29.5,16.5" fill="#3B82F6" />
          </svg>
        );
      }

      if (isPeeking) {
        // Friendly Blue Audit Robot peeking over bottom edge
        return (
          <svg className="w-10 h-8 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 32" fill="none">
            <line x1="20" y1="11" x2="20" y2="6" stroke="#2563EB" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="20" cy="5" r="2" fill="#60A5FA" />
            <rect x="10" y="11" width="20" height="15" rx="4.5" fill="#2563EB" />
            <rect x="13" y="14" width="14" height="7.5" rx="2.5" fill="#EFF6FF" />
            <circle cx="17" cy="17.8" r="1.4" fill="#1D4ED8" className="char-anim-blink" />
            <circle cx="23" cy="17.8" r="1.4" fill="#1D4ED8" className="char-anim-blink" />
            <rect x="8" y="24" width="4" height="3.2" rx="1.5" fill="#1D4ED8" />
            <rect x="28" y="24" width="4" height="3.2" rx="1.5" fill="#1D4ED8" />
          </svg>
        );
      }

      if (v === 1) {
        // Wise Blue Owl Auditor with Glasses perched on panel edge
        return (
          <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
            <path d="M11 29c0-8 3.6-14 9-14s9 6 9 14H11z" fill="#1D4ED8" />
            <ellipse cx="20" cy="25" rx="5.5" ry="4.5" fill="#DBEAFE" />
            <circle cx="16.8" cy="19.5" r="2.8" fill="#FFFFFF" stroke="#1E3A8A" strokeWidth="1.2" />
            <circle cx="23.2" cy="19.5" r="2.8" fill="#FFFFFF" stroke="#1E3A8A" strokeWidth="1.2" />
            <circle cx="16.8" cy="19.5" r="1.1" fill="#0F172A" className="char-anim-blink" />
            <circle cx="23.2" cy="19.5" r="1.1" fill="#0F172A" className="char-anim-blink" />
            <polygon points="20,22 18.8,20.5 21.2,20.5" fill="#F59E0B" />
          </svg>
        );
      }

      if (v === 2) {
        // Cute Office Cat wearing a tiny Blue Tie sitting on the panel edge
        return (
          <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
            <polygon points="11,15 13,7 18,13" fill="#64748B" />
            <polygon points="29,15 27,7 22,13" fill="#64748B" />
            <path d="M10 30c0-7.5 4.5-13 10-13s10 5.5 10 13H10z" fill="#94A3B8" />
            <circle cx="16.5" cy="20" r="1.2" fill="#0F172A" className="char-anim-blink" />
            <circle cx="23.5" cy="20" r="1.2" fill="#0F172A" className="char-anim-blink" />
            {/* Tiny Blue Corporate Tie */}
            <polygon points="20,23 18.5,28 20,30 21.5,28" fill="#2563EB" />
          </svg>
        );
      }

      // Friendly Blue Bot Mascot sitting on card edge swinging legs
      return (
        <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
          <line x1="20" y1="9" x2="20" y2="4.5" stroke="#3B82F6" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="20" cy="3.8" r="2" fill="#60A5FA" />
          <rect x="9" y="9" width="22" height="15" rx="4.5" fill="#2563EB" />
          <rect x="12.5" y="12" width="15" height="8" rx="2.5" fill="#EFF6FF" />
          <circle cx="16.8" cy="16" r="1.4" fill="#1D4ED8" className="char-anim-blink" />
          <circle cx="23.2" cy="16" r="1.4" fill="#1D4ED8" className="char-anim-blink" />
          <g className="char-anim-swing">
            <rect x="14.5" y="24" width="3.5" height="5.5" rx="1.5" fill="#1E40AF" />
            <rect x="22" y="24" width="3.5" height="5.5" rx="1.5" fill="#1E40AF" />
          </g>
        </svg>
      );
    }
  }
}

const PANEL_EDGE_POSITIONS: DecorationAnchorPosition[] = [
  'top-left',
  'top-border',
  'top-right',
  'bottom-left',
  'bottom-right',
];

const PANEL_EDGE_PERMUTATIONS: number[][] = [
  [0, 1, 2, 3, 4],
  [2, 0, 4, 1, 3],
  [1, 2, 0, 4, 3],
  [3, 2, 1, 0, 4],
  [4, 0, 1, 2, 3],
  [2, 4, 0, 3, 1],
  [1, 3, 4, 2, 0],
  [4, 2, 3, 1, 0],
  [0, 2, 1, 4, 3],
  [3, 0, 2, 4, 1],
  [2, 1, 3, 0, 4],
  [1, 4, 2, 0, 3],
];

function getThemePositionSeed(theme: BackgroundIconTheme): number {
  switch (theme) {
    case 'christmas':
      return 0;
    case 'halloween':
      return 1;
    case 'valentines':
      return 2;
    case 'new_year':
      return 3;
    default:
      return 0;
  }
}

/**
 * Permutes panel edge slots per theme so switching themes moves characters to
 * different corners/borders of each panel without causing two decorations on
 * the same panel to collide.
 */
function resolveThemePosition(
  theme: BackgroundIconTheme,
  position: DecorationAnchorPosition
): DecorationAnchorPosition {
  const slotIdx = PANEL_EDGE_POSITIONS.indexOf(position);
  if (slotIdx === -1) return position;
  const seed = getThemePositionSeed(theme);
  const perm = PANEL_EDGE_PERMUTATIONS[seed % PANEL_EDGE_PERMUTATIONS.length];
  return PANEL_EDGE_POSITIONS[perm[slotIdx]];
}

/**
 * Computes relative anchor positioning classes with theme-specific horizontal/vertical
 * offsets so characters sit on, hang from, peek behind, or rest in distinct places
 * for each theme without overlapping interactive controls.
 */
function getPositionWrapperClasses(
  theme: BackgroundIconTheme,
  position: DecorationAnchorPosition,
  variant: number
): string {
  const seed = getThemePositionSeed(theme);
  const offsetPick = (seed + Math.abs(variant) * 3) % 5;

  switch (position) {
    case 'top-left': {
      const leftOffsets = ['left-3', 'left-6', 'left-10', 'left-14', 'left-[18%]'];
      return `absolute -top-7 ${leftOffsets[offsetPick]} z-20 origin-bottom`;
    }
    case 'top-right': {
      const rightOffsets = ['right-3', 'right-7', 'right-11', 'right-16', 'right-[18%]'];
      return `absolute -top-7 ${rightOffsets[offsetPick]} z-20 origin-bottom`;
    }
    case 'top-border': {
      const borderOffsets = ['left-1/3', 'left-[44%]', 'right-1/3', 'right-1/4', 'left-1/4'];
      return `absolute -top-7 ${borderOffsets[offsetPick]} z-20 origin-bottom`;
    }
    case 'bottom-left': {
      const bottomLeftOffsets = ['left-4', 'left-8', 'left-12', 'left-16', 'left-[20%]'];
      return `absolute -bottom-2.5 ${bottomLeftOffsets[offsetPick]} z-10 origin-bottom`;
    }
    case 'bottom-right': {
      const bottomRightOffsets = ['right-4', 'right-8', 'right-12', 'right-16', 'right-[20%]'];
      return `absolute -bottom-2.5 ${bottomRightOffsets[offsetPick]} z-10 origin-bottom`;
    }
    case 'header-edge': {
      const headerZones = [
        ['left-[16%]', 'left-[48%]', 'left-[78%]'],
        ['left-[24%]', 'left-[58%]', 'left-[84%]'],
        ['left-[12%]', 'left-[42%]', 'left-[72%]'],
        ['left-[28%]', 'left-[62%]', 'left-[86%]'],
        ['left-[19%]', 'left-[52%]', 'left-[80%]'],
        ['left-[14%]', 'left-[46%]', 'left-[75%]'],
      ];
      const zoneSet = headerZones[seed % headerZones.length];
      const zoneClass = zoneSet[Math.abs(variant) % zoneSet.length];
      return `absolute top-full ${zoneClass} -translate-y-1 z-30 origin-top`;
    }
    case 'sidebar-edge': {
      const sidebarZones = [
        ['top-14', 'top-40', 'top-68'],
        ['top-20', 'top-48', 'top-76'],
        ['top-12', 'top-36', 'top-60'],
        ['top-24', 'top-52', 'top-80'],
        ['top-16', 'top-44', 'top-72'],
      ];
      const vSet = sidebarZones[seed % sidebarZones.length];
      const vClass = vSet[Math.abs(variant) % vSet.length];
      return `absolute ${vClass} -left-8 z-30 origin-top-right`;
    }
    case 'empty-state':
      return 'relative inline-flex items-center justify-center mx-auto mb-2 z-10 origin-center';
    case 'inside-corner': {
      const insideOffsets = [
        'bottom-2.5 right-3.5',
        'bottom-2.5 left-3.5',
        'bottom-3 right-8',
        'bottom-3 left-8',
        'bottom-2 right-5',
      ];
      return `absolute ${insideOffsets[offsetPick]} z-10 opacity-90 origin-bottom-right`;
    }
  }
}

export const PanelDecoration: React.FC<PanelDecorationProps> = ({
  position,
  tier = 'major',
  variant = 0,
  themeOverride,
  className = '',
  hideOnMobile = false,
}) => {
  const { activeTheme, seasonalDecorations } = useDecorationSettings();
  const effectiveTheme = themeOverride || activeTheme;

  // 1. Default and Core Enterprise Themes do NOT display decorative characters
  if (isCharacterFreeEnterpriseTheme(effectiveTheme)) {
    return null;
  }

  // 2. Respect Seasonal Decorations On/Off
  if (!seasonalDecorations) {
    return null;
  }

  const resolvedPosition = resolveThemePosition(effectiveTheme, position);
  const resolvedVariant = (variant + getThemePositionSeed(effectiveTheme)) % 4;
  const svgNode = renderThemeCharacterSvg(effectiveTheme, resolvedPosition, resolvedVariant);
  if (!svgNode) return null;

  const anchorClasses = getPositionWrapperClasses(effectiveTheme, resolvedPosition, variant);
  const responsiveClasses =
    hideOnMobile || resolvedPosition === 'header-edge' || resolvedPosition === 'sidebar-edge'
      ? 'hidden sm:block sm:scale-[1.42]'
      : 'scale-125 sm:scale-[1.45]';

  return (
    <div
      className={`pointer-events-none select-none ${anchorClasses} ${responsiveClasses} ${className}`}
      aria-hidden="true"
    >
      <div className="inline-flex items-end gap-1.5">
        {svgNode}
      </div>
    </div>
  );
};
