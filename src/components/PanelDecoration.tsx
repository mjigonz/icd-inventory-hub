import React, { createContext, useContext } from 'react';
import {
  BackgroundIconTheme,
  CharacterDensity,
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

export type MotionPreference = 'off' | 'subtle' | 'smooth';

export interface DecorationContextValue {
  activeTheme: BackgroundIconTheme;
  selectedTheme: BackgroundIconTheme;
  seasonalDecorations: boolean;
  characterDensity: CharacterDensity;
  characterAnimation: boolean;
  autoSeasonalTheme: boolean;
  motionPreference?: MotionPreference;
  onSetSeasonalDecorations?: (enabled: boolean) => void;
  onSetCharacterDensity?: (density: CharacterDensity) => void;
  onSetCharacterAnimation?: (enabled: boolean) => void;
  onSetAutoSeasonalTheme?: (enabled: boolean) => void;
  onSetMotionPreference?: (pref: MotionPreference) => void;
}

const DecorationContext = createContext<DecorationContextValue>({
  activeTheme: 'default',
  selectedTheme: 'default',
  seasonalDecorations: true,
  characterDensity: 'balanced',
  characterAnimation: false,
  autoSeasonalTheme: false,
  motionPreference: 'smooth',
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
    // 5. SPRING BLOSSOM
    // Characters: Small birds, Butterflies, Cherry blossoms, Tiny rabbits, Hanging flowers
    // =========================================================================
    case 'spring_blossom': {
      if (isHanging) {
        return (
          <svg className="w-11 h-9 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 38" fill="none">
            <path d="M12 0c0 6 2 10 2 16" stroke="#16A34A" strokeWidth="1.5" />
            <circle cx="14" cy="18" r="4.8" fill="#F472B6" />
            <circle cx="14" cy="18" r="1.8" fill="#FDE047" />
            <path d="M28 0c0 8-2 13-2 20" stroke="#16A34A" strokeWidth="1.5" />
            <circle cx="26" cy="22" r="4.2" fill="#FB7185" />
            <circle cx="26" cy="22" r="1.6" fill="#FEF08A" />
          </svg>
        );
      }

      if (v === 1) {
        // Fluttering Spring Butterfly + Blossom
        return (
          <svg className="w-10 h-9 char-anim-flutter drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
            <path d="M19 18c-6-8-13-6-12 1 1 5 6 5 12-1z" fill="#EC4899" />
            <path d="M19 18c6-8 13-6 12 1-1 5-6 5-12-1z" fill="#EC4899" />
            <path d="M19 19c-5 2-9 7-6 10 2 2 6-2 6-10z" fill="#F472B6" />
            <path d="M19 19c5 2 9 7 6 10-2 2-6-2-6-10z" fill="#F472B6" />
            <line x1="19" y1="13" x2="19" y2="27" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M19 13l-3-4M19 13l3-4" stroke="#1E293B" strokeWidth="1" strokeLinecap="round" />
          </svg>
        );
      }

      if (v === 2) {
        // Tiny White Spring Rabbit with Pink Blossom Crown
        return (
          <svg className="w-10 h-10 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 40" fill="none">
            <ellipse cx="15" cy="10" rx="2.5" ry="7" transform="rotate(-10 15 10)" fill="#FFFFFF" stroke="#FBCFE8" strokeWidth="1" />
            <ellipse cx="23" cy="10" rx="2.5" ry="7" transform="rotate(10 23 10)" fill="#FFFFFF" stroke="#FBCFE8" strokeWidth="1" />
            <path d="M11 33c0-6 3.5-11 8-11s8 5 8 11H11z" fill="#FFFFFF" stroke="#FBCFE8" strokeWidth="1" />
            <circle cx="19" cy="21" r="6.5" fill="#FFFFFF" stroke="#FBCFE8" strokeWidth="1" />
            <circle cx="19" cy="15" r="2.2" fill="#EC4899" />
            <circle cx="16.5" cy="20.5" r="1.1" fill="#1E293B" className="char-anim-blink" />
            <circle cx="21.5" cy="20.5" r="1.1" fill="#1E293B" className="char-anim-blink" />
          </svg>
        );
      }

      // Small Meadow Bird perched on a blooming twig
      return (
        <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 34" fill="none">
          <path d="M4 29h32" stroke="#15803D" strokeWidth="2" strokeLinecap="round" />
          <circle cx="9" cy="28" r="2.8" fill="#F472B6" />
          <circle cx="9" cy="28" r="1" fill="#FDE047" />
          <path d="M14 28c0-7 4.5-12 10-12 4 0 6 3 6 7 0 3-2 5-5 5H14z" fill="#38BDF8" />
          <path d="M17 23c2-1 5 0 6 2" stroke="#0284C7" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="25.5" cy="20" r="1.1" fill="#0F172A" className="char-anim-blink" />
          <polygon points="30,20.5 33.5,21.5 30,22.5" fill="#F59E0B" />
        </svg>
      );
    }

    // =========================================================================
    // 6. SUMMER BREEZE
    // Characters: Miniature suns, Tropical birds, Palm leaves, Small crabs, Beach gear
    // =========================================================================
    case 'summer_breeze': {
      if (isHanging) {
        return (
          <svg className="w-11 h-9 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 36" fill="none">
            <path d="M4 2c10 2 18 8 22 16-6-2-14-3-22-16z" fill="#10B981" />
            <path d="M4 2c12-1 22 3 28 10-7 0-16-2-28-10z" fill="#059669" />
            <circle cx="33" cy="12" r="5" fill="#FBBF24" />
          </svg>
        );
      }

      if (v === 0) {
        // Small Red Crab perched on card border
        return (
          <svg className="w-11 h-8 char-anim-tilt drop-shadow-2xs" viewBox="0 0 42 32" fill="none">
            <path d="M12 18c-3-3-4-7-1-9 1.5 2 3 2 4 0 1 3 0 6-3 9z" fill="#EF4444" />
            <path d="M30 18c3-3 4-7 1-9-1.5 2-3 2-4 0-1 3 0 6 3 9z" fill="#EF4444" />
            <path d="M11 24l-4 3M12 26l-3 3M31 24l4 3M30 26l3 3" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" />
            <ellipse cx="21" cy="23" rx="9" ry="5.5" fill="#EF4444" />
            <line x1="18" y1="18" x2="18" y2="14.5" stroke="#DC2626" strokeWidth="1.8" />
            <line x1="24" y1="18" x2="24" y2="14.5" stroke="#DC2626" strokeWidth="1.8" />
            <circle cx="18" cy="14" r="1.5" fill="#0F172A" className="char-anim-blink" />
            <circle cx="24" cy="14" r="1.5" fill="#0F172A" className="char-anim-blink" />
            <path d="M18.5 23.5c1.5 1.2 3.5 1.2 5 0" stroke="#FEF2F2" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        );
      }

      if (v === 2) {
        // Tropical Toucan Bird perched on border
        return (
          <svg className="w-11 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 44 36" fill="none">
            <path d="M10 30c0-8 4-14 9-14s8 6 8 14H10z" fill="#0F172A" />
            <ellipse cx="19" cy="23" rx="4" ry="4.5" fill="#FACC15" />
            <circle cx="18" cy="19.5" r="1.2" fill="#0F172A" className="char-anim-blink" />
            {/* Big colorful Toucan beak */}
            <path d="M23 17c6 0 11 2 11 5.5H23V17z" fill="#F97316" />
            <path d="M31 18.2c2 .8 3 2.2 3 4.3h-3v-4.3z" fill="#0F172A" />
          </svg>
        );
      }

      // Smiling Miniature Sun with cool shades
      return (
        <svg className="w-10 h-10 char-anim-float drop-shadow-2xs" viewBox="0 0 38 38" fill="none">
          <path d="M19 3v4M19 31v4M3 19h4M31 19h4M7.7 7.7l2.8 2.8M27.5 27.5l2.8 2.8M30.3 7.7l-2.8 2.8M10.5 27.5l-2.8 2.8" stroke="#F59E0B" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="19" cy="19" r="9.5" fill="#FBBF24" />
          <rect x="12.5" y="15.5" width="5.5" height="3.8" rx="1" fill="#0F172A" />
          <rect x="20" y="15.5" width="5.5" height="3.8" rx="1" fill="#0F172A" />
          <line x1="18" y1="16.8" x2="20" y2="16.8" stroke="#0F172A" strokeWidth="1.4" />
          <path d="M16.5 22.5c1.5 1.4 3.5 1.4 5 0" stroke="#92400E" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    }

    // =========================================================================
    // 7. AUTUMN HARVEST
    // Characters: Tiny foxes, Falling leaves, Miniature squirrels, Acorns, Pumpkins
    // =========================================================================
    case 'autumn_harvest': {
      if (isHanging) {
        return (
          <svg className="w-11 h-9 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 36" fill="none">
            <line x1="14" y1="0" x2="14" y2="10" stroke="#78350F" strokeWidth="1.3" />
            <path d="M9 13c0-2.5 2.2-4 5-4s5 1.5 5 4H9z" fill="#78350F" />
            <path d="M10 13h8v4.5c0 2.5-1.8 4.5-4 4.5s-4-2-4-4.5V13z" fill="#D97706" />
            <line x1="29" y1="0" x2="29" y2="13" stroke="#92400E" strokeWidth="1.2" />
            <path d="M29 12l3 4 4-1-2 4 3 2-5 1-1 4-2-4-5-1 3-2-2-4 4 1 1-4z" fill="#EA580C" />
          </svg>
        );
      }

      if (v % 2 === 0) {
        // Tiny Woodland Fox sitting on card edge
        return (
          <svg className="w-11 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 42 36" fill="none">
            <path d="M27 28c6 0 11-4 10-9-2-1-5 1-7 4-1.5 2-3 5-3 5z" fill="#EA580C" />
            <path d="M37 19c-1.5-.8-3.2.2-4.5 2 1.5 1 3.2 1 4.5-2z" fill="#FFFBEB" />
            <polygon points="11,15 13,6 18,13" fill="#EA580C" />
            <polygon points="27,15 25,6 20,13" fill="#EA580C" />
            <path d="M11 29c0-6 3.5-10 8-10s8 4 8 10H11z" fill="#EA580C" />
            <circle cx="19" cy="17" r="7" fill="#EA580C" />
            <path d="M12.5 18c2 0 4.5 1.5 6.5 4 2-2.5 4.5-4 6.5-4-1 4-3.5 6-6.5 6s-5.5-2-6.5-6z" fill="#FFFBEB" />
            <circle cx="16" cy="16.5" r="1.1" fill="#1C1917" className="char-anim-blink" />
            <circle cx="22" cy="16.5" r="1.1" fill="#1C1917" className="char-anim-blink" />
            <circle cx="19" cy="21" r="1.3" fill="#1C1917" />
          </svg>
        );
      }

      // Miniature Squirrel holding an Acorn + Maple Leaf
      return (
        <svg className="w-11 h-9 drop-shadow-2xs" viewBox="0 0 42 36" fill="none">
          <path d="M25 28c6 0 10-5 9-11s-6-6-7-2c-.5 2 1 4 0 7-1 2-2 6-2 6z" fill="#92400E" />
          <circle cx="17" cy="15" r="5.5" fill="#B45309" />
          <ellipse cx="14" cy="10" rx="1.8" ry="2.5" fill="#92400E" />
          <ellipse cx="18" cy="24" rx="6.5" ry="6" fill="#B45309" />
          <circle cx="15.5" cy="14.5" r="1.1" fill="#1C1917" className="char-anim-blink" />
          <circle cx="12" cy="23" r="2.8" fill="#D97706" />
          <path d="M9.5 21.5c0-1.5 1.1-2.5 2.5-2.5s2.5 1 2.5 2.5h-5z" fill="#451A03" />
        </svg>
      );
    }

    // =========================================================================
    // 8. WINTER FROST
    // Characters: Tiny penguins, Polar bears, Snowflakes, Snowmen, Icicles
    // =========================================================================
    case 'winter_frost': {
      if (isHanging) {
        return (
          <svg className="w-12 h-8 drop-shadow-2xs" viewBox="0 0 48 32" fill="none">
            <polygon points="4,0 10,0 7,18" fill="#BAE6FD" fillOpacity="0.85" />
            <polygon points="11,0 16,0 13.5,12" fill="#7DD3FC" fillOpacity="0.8" />
            <polygon points="17,0 24,0 20.5,24" fill="#BAE6FD" fillOpacity="0.9" />
            <polygon points="25,0 30,0 27.5,14" fill="#38BDF8" fillOpacity="0.75" />
            <polygon points="31,0 37,0 34,20" fill="#BAE6FD" fillOpacity="0.85" />
          </svg>
        );
      }

      if (v % 2 === 0) {
        // Tiny Penguin tilting its head slightly with warm earmuffs
        return (
          <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 38 36" fill="none">
            <path d="M10 17c0-6 4-10 9-10s9 4 9 10" stroke="#0284C7" strokeWidth="1.8" />
            <path d="M11 30c0-8 3.5-15 8-15s8 7 8 15H11z" fill="#0F172A" />
            <path d="M14 30c0-5.5 2.2-10 5-10s5 4.5 5 10H14z" fill="#F8FAFC" />
            <circle cx="10" cy="18" r="2.5" fill="#38BDF8" />
            <circle cx="28" cy="18" r="2.5" fill="#38BDF8" />
            <circle cx="16.8" cy="18.5" r="1.1" fill="#0F172A" className="char-anim-blink" />
            <circle cx="21.2" cy="18.5" r="1.1" fill="#0F172A" className="char-anim-blink" />
            <polygon points="19,21.5 17.2,19.8 20.8,19.8" fill="#F59E0B" />
            <ellipse cx="15" cy="30.5" rx="2.5" ry="1.4" fill="#F59E0B" />
            <ellipse cx="23" cy="30.5" rx="2.5" ry="1.4" fill="#F59E0B" />
          </svg>
        );
      }

      // Cute Polar Bear Cub peeking over panel edge
      return (
        <svg className="w-10 h-8 drop-shadow-2xs" viewBox="0 0 38 32" fill="none">
          <circle cx="11.5" cy="11" r="3.5" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1" />
          <circle cx="26.5" cy="11" r="3.5" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1" />
          <path d="M10 28c0-7 4-13 9-13s9 6 9 13H10z" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
          <ellipse cx="19" cy="22.5" rx="3.5" ry="2.6" fill="#E2E8F0" />
          <circle cx="15.8" cy="19" r="1.1" fill="#0F172A" className="char-anim-blink" />
          <circle cx="22.2" cy="19" r="1.1" fill="#0F172A" className="char-anim-blink" />
          <ellipse cx="19" cy="21.8" rx="1.5" ry="1.1" fill="#0F172A" />
          <ellipse cx="12" cy="28" rx="2.6" ry="1.6" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth="1" />
          <ellipse cx="26" cy="28" rx="2.6" ry="1.6" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth="1" />
        </svg>
      );
    }

    // =========================================================================
    // 9. EASTER
    // Characters: Miniature rabbits, Easter eggs, Baby chicks, Hanging pastel decorations
    // =========================================================================
    case 'easter': {
      if (isHanging) {
        return (
          <svg className="w-11 h-9 char-anim-sway drop-shadow-2xs" viewBox="0 0 42 36" fill="none">
            <line x1="13" y1="0" x2="13" y2="10" stroke="#C4B5FD" strokeWidth="1.2" />
            <ellipse cx="13" cy="16" rx="5" ry="6.5" fill="#DDD6FE" stroke="#8B5CF6" strokeWidth="1" />
            <path d="M8.5 16l2.2-1.5 2.3 1.5 2.3-1.5 2.2 1.5" stroke="#EC4899" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="29" y1="0" x2="29" y2="14" stroke="#99F6E4" strokeWidth="1.2" />
            <ellipse cx="29" cy="19.5" rx="4.5" ry="5.8" fill="#FEF08A" stroke="#F59E0B" strokeWidth="1" />
            <circle cx="29" cy="19.5" r="1.3" fill="#8B5CF6" />
          </svg>
        );
      }

      if (v % 2 === 1) {
        // Fluffy Yellow Baby Chick & Pastel Egg
        return (
          <svg className="w-11 h-8 char-anim-bounce drop-shadow-2xs" viewBox="0 0 40 34" fill="none">
            <ellipse cx="29" cy="24" rx="4.8" ry="6.2" fill="#C4B5FD" />
            <path d="M24.5 24h9" stroke="#F472B6" strokeWidth="1.5" />
            <circle cx="16" cy="22" r="7" fill="#FACC15" />
            <circle cx="16" cy="13.5" r="5" fill="#FDE047" />
            <circle cx="14.5" cy="13" r="1" fill="#1E293B" className="char-anim-blink" />
            <circle cx="17.5" cy="13" r="1" fill="#1E293B" className="char-anim-blink" />
            <polygon points="16,14.2 14.5,15.8 17.5,15.8" fill="#F97316" />
          </svg>
        );
      }

      // Miniature Easter Bunny with long pastel ears peeking/sitting
      return (
        <svg className="w-10 h-10 char-anim-tilt drop-shadow-2xs" viewBox="0 0 38 40" fill="none">
          <ellipse cx="15" cy="10" rx="2.6" ry="7.5" transform="rotate(-8 15 10)" fill="#FFFFFF" stroke="#DDD6FE" strokeWidth="1" />
          <ellipse cx="15" cy="10.5" rx="1.3" ry="5" transform="rotate(-8 15 10.5)" fill="#FBCFE8" />
          <ellipse cx="23" cy="10" rx="2.6" ry="7.5" transform="rotate(8 23 10)" fill="#FFFFFF" stroke="#DDD6FE" strokeWidth="1" />
          <ellipse cx="23" cy="10.5" rx="1.3" ry="5" transform="rotate(8 23 10.5)" fill="#FBCFE8" />
          <path d="M11 33c0-6.5 3.6-12 8-12s8 5.5 8 12H11z" fill="#FFFFFF" stroke="#DDD6FE" strokeWidth="1" />
          <circle cx="19" cy="21" r="6.8" fill="#FFFFFF" stroke="#DDD6FE" strokeWidth="1" />
          <circle cx="16.5" cy="20" r="1.1" fill="#1E1B4B" className="char-anim-blink" />
          <circle cx="21.5" cy="20" r="1.1" fill="#1E1B4B" className="char-anim-blink" />
          <polygon points="19,22.5 17.8,21.2 20.2,21.2" fill="#F472B6" />
        </svg>
      );
    }

    // =========================================================================
    // 10. NATURE FOREST
    // Characters: Woodland animals, Hanging vines, Mushrooms, Small birds, Butterflies
    // =========================================================================
    case 'nature_forest': {
      if (isHanging) {
        return (
          <svg className="w-11 h-11 char-anim-sway drop-shadow-2xs" viewBox="0 0 40 44" fill="none">
            <path d="M14 0c-2 10 4 18 0 30" stroke="#15803D" strokeWidth="1.6" strokeLinecap="round" />
            <ellipse cx="10" cy="10" rx="4" ry="2.2" transform="rotate(-25 10 10)" fill="#22C55E" />
            <ellipse cx="18" cy="17" rx="4" ry="2.2" transform="rotate(25 18 17)" fill="#16A34A" />
            <ellipse cx="11" cy="25" rx="3.8" ry="2" transform="rotate(-20 11 25)" fill="#22C55E" />
            <path d="M28 0c2 8-3 14 0 22" stroke="#15803D" strokeWidth="1.4" strokeLinecap="round" />
            <ellipse cx="31" cy="12" rx="3.5" ry="2" transform="rotate(20 31 12)" fill="#4ADE80" />
          </svg>
        );
      }

      if (v % 2 === 0) {
        // Red-Spotted Woodland Toadstool Mushrooms + Tiny Forest Bird
        return (
          <svg className="w-11 h-9 drop-shadow-2xs" viewBox="0 0 42 36" fill="none">
            <rect x="13" y="21" width="6" height="10" rx="2" fill="#FEF3C7" />
            <path d="M7 22c0-6 4-10 9-10s9 4 9 10H7z" fill="#EF4444" />
            <circle cx="13" cy="16" r="1.6" fill="#FFFFFF" />
            <circle cx="19" cy="15" r="1.2" fill="#FFFFFF" />
            <circle cx="16" cy="19" r="1.4" fill="#FFFFFF" />
            <rect x="27" y="25" width="4" height="6" rx="1.5" fill="#FEF3C7" />
            <path d="M24 26c0-3.5 2.2-6 5-6s5 2.5 5 6H24z" fill="#DC2626" />
            <circle cx="28" cy="23" r="1" fill="#FFFFFF" />
          </svg>
        );
      }

      // Cute Woodland Hedgehog resting on panel edge
      return (
        <svg className="w-11 h-8 char-anim-tilt drop-shadow-2xs" viewBox="0 0 42 32" fill="none">
          <path d="M9 27c0-8 5-13 13-13 7 0 11 5 11 13H9z" fill="#78350F" />
          <path d="M7 27c0-4 3-7 7-7s6 3 6 7H7z" fill="#FDE68A" />
          <circle cx="12" cy="23" r="1.1" fill="#1C1917" className="char-anim-blink" />
          <circle cx="7.5" cy="24.5" r="1.5" fill="#1C1917" />
          <ellipse cx="22" cy="13" rx="3.5" ry="1.8" transform="rotate(-15 22 13)" fill="#22C55E" />
        </svg>
      );
    }

    // =========================================================================
    // 11. OCEAN BREEZE
    // Characters: Miniature turtles, Small fish, Seashells, Starfish, Tiny octopuses
    // =========================================================================
    case 'ocean_breeze': {
      if (isHanging) {
        return (
          <svg className="w-10 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="14" r="7.5" fill="#FB7185" />
            <circle cx="17.5" cy="13.5" r="1.2" fill="#0F172A" className="char-anim-blink" />
            <circle cx="22.5" cy="13.5" r="1.2" fill="#0F172A" className="char-anim-blink" />
            <path d="M18.5 16.2c1 .8 2 .8 3 0" stroke="#881337" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M14 20c-2 4-4 6-2 9M18 21c-1 4 0 7-1 9M22 21c1 4 0 7 1 9M26 20c2 4 4 6 2 9" stroke="#FB7185" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        );
      }

      if (v % 2 === 0) {
        // Miniature Sea Turtle resting on card edge
        return (
          <svg className="w-11 h-8 char-anim-float drop-shadow-2xs" viewBox="0 0 42 32" fill="none">
            <ellipse cx="12" cy="25" rx="3.5" ry="1.8" transform="rotate(-20 12 25)" fill="#10B981" />
            <ellipse cx="28" cy="25" rx="3.5" ry="1.8" transform="rotate(20 28 25)" fill="#10B981" />
            <path d="M10 24c0-6 4.5-10 10-10s10 4 10 10H10z" fill="#047857" />
            <path d="M14 24c0-4 2.5-7 6-7s6 3 6 7" stroke="#34D399" strokeWidth="1.2" />
            <circle cx="33" cy="21" r="3.8" fill="#10B981" />
            <circle cx="34.2" cy="20.2" r="0.9" fill="#0F172A" className="char-anim-blink" />
          </svg>
        );
      }

      // Coral Starfish & Pearl Scallop Seashell
      return (
        <svg className="w-11 h-8 char-anim-tilt drop-shadow-2xs" viewBox="0 0 42 32" fill="none">
          <path d="M8 26c0-5.5 4-10 9-10s9 4.5 9 10H8z" fill="#FDE68A" stroke="#F59E0B" strokeWidth="1" />
          <path d="M17 26v-9M13 26l2-8M21 26l-2-8" stroke="#F59E0B" strokeWidth="1" />
          <polygon points="31,14 32.8,18.2 37.2,18.8 33.8,21.8 34.8,26.2 31,23.8 27.2,26.2 28.2,21.8 24.8,18.8 29.2,18.2" fill="#FB7185" />
          <circle cx="31" cy="20.5" r="1" fill="#FFF1F2" />
        </svg>
      );
    }

    // =========================================================================
    // 12. SAKURA DREAM
    // Characters: Maneki-Neko lucky cats, Cherry blossom branches, Daruma dolls, Petals
    // =========================================================================
    case 'sakura_dream': {
      if (isHanging) {
        return (
          <svg className="w-11 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 44 40" fill="none">
            <path d="M2 4c12 2 22 0 36 4" stroke="#78350F" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="5" r="3.8" fill="#FBCFE8" />
            <circle cx="12" cy="5" r="1.2" fill="#DB2777" />
            <circle cx="28" cy="6" r="3.5" fill="#F472B6" />
            <circle cx="28" cy="6" r="1.1" fill="#FEF08A" />
            <line x1="20" y1="5" x2="20" y2="13" stroke="#DB2777" strokeWidth="1" />
            <path d="M15 18c0-3 2.2-5 5-5s5 2 5 5H15z" fill="#BAE6FD" fillOpacity="0.85" stroke="#38BDF8" strokeWidth="1" />
            <line x1="20" y1="18" x2="20" y2="24" stroke="#DB2777" strokeWidth="1" />
            <rect x="18" y="24" width="4" height="8" rx="0.8" fill="#F472B6" />
          </svg>
        );
      }

      // Lucky Maneki-Neko / Calico Cat sitting among Cherry Blossom Petals
      return (
        <svg className="w-10 h-9 drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
          <polygon points="11,15 13,7 18,13" fill="#FFFFFF" stroke="#FBCFE8" strokeWidth="1" />
          <polygon points="12.5,14 13.5,9 16.5,13" fill="#F472B6" />
          <polygon points="29,15 27,7 22,13" fill="#F97316" />
          <path d="M10 30c0-7.5 4.5-13 10-13s10 5.5 10 13H10z" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1" />
          <rect x="13" y="23" width="14" height="2.2" rx="1.1" fill="#E11D48" />
          <circle cx="20" cy="25" r="1.8" fill="#FBBF24" />
          <g className="char-anim-blink">
            <path d="M15 19c1-1.2 2.5-1.2 3.5 0" stroke="#1E293B" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M21.5 19c1-1.2 2.5-1.2 3.5 0" stroke="#1E293B" strokeWidth="1.4" strokeLinecap="round" />
          </g>
          <ellipse cx="12" cy="22" rx="2.2" ry="3.2" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" className="char-anim-tilt" />
          <circle cx="31" cy="27" r="3.2" fill="#F472B6" />
          <circle cx="31" cy="27" r="1" fill="#FEF08A" />
        </svg>
      );
    }

    // =========================================================================
    // 13. MINIMAL MONOCHROME
    // Characters: Monochrome Tuxedo Cats, Origami Cranes, Sketch Owls & Line-Art Birds
    // =========================================================================
    case 'minimal_monochrome': {
      if (isHanging) {
        // Hanging Origami Paper Crane & Monochrome Geometric Star
        return (
          <svg className="w-10 h-10 char-anim-sway drop-shadow-2xs" viewBox="0 0 42 40" fill="none">
            <line x1="15" y1="0" x2="15" y2="12" stroke="#71717A" strokeWidth="1.2" strokeDasharray="2 1" />
            <polygon points="15,12 6,18 15,21 24,18" fill="#FAFAFA" stroke="#18181B" strokeWidth="1.3" />
            <polygon points="15,12 15,26 22,19" fill="#E4E4E7" stroke="#18181B" strokeWidth="1.2" />
            <line x1="31" y1="0" x2="31" y2="16" stroke="#71717A" strokeWidth="1.1" />
            <polygon points="31,15 32.5,18.5 36,19 33.2,21.2 34,24.8 31,23 28,24.8 28.8,21.2 26,19 29.5,18.5" fill="#18181B" stroke="#FAFAFA" strokeWidth="0.8" />
          </svg>
        );
      }

      if (isPeeking) {
        // Monochrome Tuxedo Cat peeking over bottom edge
        return (
          <svg className="w-10 h-8 drop-shadow-2xs" viewBox="0 0 40 32" fill="none">
            <polygon points="11,16 13,6 19,13" fill="#18181B" />
            <polygon points="29,16 27,6 21,13" fill="#18181B" />
            <path d="M10 28c0-7.5 4.5-13 10-13s10 5.5 10 13H10z" fill="#18181B" />
            <path d="M15 28c0-3.5 2.2-6 5-6s5 2.5 5 6H15z" fill="#FAFAFA" />
            <circle cx="16.2" cy="20" r="1.6" fill="#FAFAFA" className="char-anim-blink" />
            <circle cx="23.8" cy="20" r="1.6" fill="#FAFAFA" className="char-anim-blink" />
            <ellipse cx="12" cy="28" rx="2.6" ry="1.6" fill="#FAFAFA" stroke="#18181B" strokeWidth="1.2" />
            <ellipse cx="28" cy="28" rx="2.6" ry="1.6" fill="#FAFAFA" stroke="#18181B" strokeWidth="1.2" />
          </svg>
        );
      }

      if (v % 2 === 0) {
        // Minimalist Ink-Sketch Tuxedo Cat sitting on panel corner
        return (
          <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
            <path d="M27 28c5 0 9-4 8-8" stroke="#18181B" strokeWidth="2.4" strokeLinecap="round" />
            <polygon points="12,14 14,6 18,12" fill="#18181B" />
            <polygon points="26,14 24,6 20,12" fill="#18181B" />
            <circle cx="19" cy="17" r="6.5" fill="#18181B" />
            <path d="M12 30c0-5.5 3.2-10 7-10s7 4.5 7 10H12z" fill="#18181B" />
            <ellipse cx="19" cy="26" rx="3.8" ry="4" fill="#FAFAFA" />
            <circle cx="16.5" cy="16.5" r="1.2" fill="#FAFAFA" className="char-anim-blink" />
            <circle cx="21.5" cy="16.5" r="1.2" fill="#FAFAFA" className="char-anim-blink" />
          </svg>
        );
      }

      // Monochrome Wise Sketch Owl with round glasses
      return (
        <svg className="w-10 h-9 char-anim-tilt drop-shadow-2xs" viewBox="0 0 40 36" fill="none">
          <path d="M11 29c0-8 3.6-14 9-14s9 6 9 14H11z" fill="#27272A" stroke="#FAFAFA" strokeWidth="1" />
          <ellipse cx="20" cy="25" rx="5.5" ry="4.5" fill="#F4F4F5" />
          <circle cx="16.8" cy="19.5" r="2.8" fill="#FAFAFA" stroke="#18181B" strokeWidth="1.3" />
          <circle cx="23.2" cy="19.5" r="2.8" fill="#FAFAFA" stroke="#18181B" strokeWidth="1.3" />
          <circle cx="16.8" cy="19.5" r="1" fill="#18181B" className="char-anim-blink" />
          <circle cx="23.2" cy="19.5" r="1" fill="#18181B" className="char-anim-blink" />
          <polygon points="20,22 18.8,20.5 21.2,20.5" fill="#71717A" />
        </svg>
      );
    }

    // =========================================================================
    // 14. MIDNIGHT PROFESSIONAL
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
    case 'spring_blossom':
      return 4;
    case 'summer_breeze':
      return 5;
    case 'autumn_harvest':
      return 6;
    case 'winter_frost':
      return 7;
    case 'easter':
      return 8;
    case 'nature_forest':
      return 9;
    case 'ocean_breeze':
      return 10;
    case 'sakura_dream':
      return 11;
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
  const { activeTheme, seasonalDecorations, characterDensity } = useDecorationSettings();
  const effectiveTheme = themeOverride || activeTheme;

  // 1. Default and Core Enterprise Themes do NOT display decorative characters
  if (isCharacterFreeEnterpriseTheme(effectiveTheme)) {
    return null;
  }

  // 2. Respect Seasonal Decorations On/Off and Decorative Characters Density
  if (!seasonalDecorations || characterDensity === 'off') {
    return null;
  }

  // 3. Filter by Decoration Density tier (for Seasonal & Nature themes):
  // - 'minimal': shows 'major' + 'secondary'
  // - 'balanced' (default): shows all placements ('major' + 'secondary' + 'playful')
  // - 'playful': shows all placements + extra companion character on major panels
  if (characterDensity === 'minimal' && tier === 'playful') {
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
        {characterDensity === 'playful' &&
          tier === 'major' &&
          (resolvedPosition === 'top-border' || resolvedPosition === 'top-right') && (
            <span className="scale-85 origin-bottom -ml-1">
              {renderThemeCharacterSvg(effectiveTheme, 'top-left', (resolvedVariant + 2) % 4)}
            </span>
          )}
      </div>
    </div>
  );
};
