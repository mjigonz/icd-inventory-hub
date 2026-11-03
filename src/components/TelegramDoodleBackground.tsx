import React from 'react';

export type BackgroundIconTheme =
  | 'default'
  | 'modern_enterprise'
  | 'minimal_monochrome'
  | 'midnight_professional'
  | 'emerald_operations'
  | 'christmas'
  | 'halloween'
  | 'valentines'
  | 'new_year'
  | 'spring_blossom'
  | 'summer_breeze'
  | 'autumn_harvest'
  | 'winter_frost'
  | 'easter'
  | 'nature_forest'
  | 'ocean_breeze'
  | 'sakura_dream';

export type CharacterDensity = 'off' | 'minimal' | 'balanced' | 'playful';

/**
 * Returns true if the theme is the Default theme or one of the Core Enterprise themes,
 * which must remain strictly clean and free of decorative characters.
 */
export function isCharacterFreeEnterpriseTheme(theme: BackgroundIconTheme): boolean {
  return (
    theme === 'default' ||
    theme === 'modern_enterprise' ||
    theme === 'minimal_monochrome' ||
    theme === 'midnight_professional' ||
    theme === 'emerald_operations'
  );
}

export interface ThemePaletteTokens {
  background: string;
  sidebar: string;
  cards: string;
  primary: string;
  text: string;
  borders: string;
}

export interface BackgroundIconThemeOption {
  id: BackgroundIconTheme;
  name: string;
  subtitle: string;
  regionBadge: string;
  category: 'enterprise' | 'seasonal';
  charactersSummary: string;
  strokeClass: string;
  gradientClass: string;
  accentClass: string;
  /** Preview color swatches [lightBg/Card, primary, darkBg/Card] */
  windowSwatches: [string, string, string];
  light: ThemePaletteTokens;
  dark: ThemePaletteTokens;
}

/**
 * Resolves the appropriate seasonal theme automatically based on calendar date.
 */
export function getAutoSeasonalTheme(date: Date = new Date()): BackgroundIconTheme {
  const month = date.getMonth() + 1; // 1..12
  const day = date.getDate();

  // New Year: Dec 30 – Jan 10
  if ((month === 12 && day >= 30) || (month === 1 && day <= 10)) {
    return 'new_year';
  }
  // Winter Frost: Jan 11 – Feb 4
  if (month === 1 || (month === 2 && day <= 4)) {
    return 'winter_frost';
  }
  // Hearts & Valentine's: Feb 5 – Feb 20
  if (month === 2 && day >= 5 && day <= 20) {
    return 'valentines';
  }
  // Sakura Dream: Feb 21 – Mar 19
  if (month === 2 || (month === 3 && day <= 19)) {
    return 'sakura_dream';
  }
  // Easter: Mar 20 – Apr 20
  if ((month === 3 && day >= 20) || (month === 4 && day <= 20)) {
    return 'easter';
  }
  // Spring Blossom: Apr 21 – May 31
  if (month === 4 || month === 5) {
    return 'spring_blossom';
  }
  // Summer Breeze: Jun 1 – Jul 20
  if (month === 6 || (month === 7 && day <= 20)) {
    return 'summer_breeze';
  }
  // Ocean Breeze: Jul 21 – Aug 31
  if (month === 7 || month === 8) {
    return 'ocean_breeze';
  }
  // Nature Forest: Sep 1 – Sep 30
  if (month === 9) {
    return 'nature_forest';
  }
  // Halloween: Oct 15 – Nov 2
  if ((month === 10 && day >= 15) || (month === 11 && day <= 2)) {
    return 'halloween';
  }
  // Autumn Harvest: Oct 1–14 or Nov 3–30
  if (month === 10 || month === 11) {
    return 'autumn_harvest';
  }
  // Christmas: Dec 1 – Dec 29
  return 'christmas';
}

export const BACKGROUND_ICON_THEMES: BackgroundIconThemeOption[] = [
  // ===========================================================================
  // DEFAULT + CORE ENTERPRISE THEMES (Character-Free)
  // ===========================================================================
  {
    id: 'default',
    name: 'Default',
    subtitle: 'Standard clean ICD Inventory Hub theme without decorative characters',
    regionBadge: 'Default',
    category: 'enterprise',
    charactersSummary: 'No decorative characters (Standard clean interface)',
    strokeClass: 'text-transparent',
    gradientClass: 'from-transparent to-transparent',
    accentClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
    windowSwatches: ['#F8FAFC', '#2563EB', '#0B1220'],
    light: {
      background: '#F8FAFC',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#2563EB',
      text: '#0F172A',
      borders: '#E2E8F0',
    },
    dark: {
      background: '#0B1220',
      sidebar: '#111827',
      cards: '#1E293B',
      primary: '#60A5FA',
      text: '#F1F5F9',
      borders: '#334155',
    },
  },
  {
    id: 'modern_enterprise',
    name: 'Modern Enterprise',
    subtitle: 'Professional, modern, and corporate interface for inventory & auditing',
    regionBadge: 'Enterprise',
    category: 'enterprise',
    charactersSummary: 'No decorative characters (Corporate clean)',
    strokeClass: 'text-blue-600/[0.04] dark:text-blue-400/[0.04]',
    gradientClass: 'from-blue-500/[0.03] via-transparent to-slate-500/[0.03]',
    accentClass: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
    windowSwatches: ['#F8FAFC', '#2563EB', '#0B1220'],
    light: {
      background: '#F8FAFC',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#2563EB',
      text: '#0F172A',
      borders: '#E2E8F0',
    },
    dark: {
      background: '#0B1220',
      sidebar: '#111827',
      cards: '#1E293B',
      primary: '#60A5FA',
      text: '#F1F5F9',
      borders: '#334155',
    },
  },
  {
    id: 'minimal_monochrome',
    name: 'Minimal Monochrome',
    subtitle: 'Extremely clean, simple, and distraction-free monochrome interface',
    regionBadge: 'Minimal',
    category: 'enterprise',
    charactersSummary: 'No decorative characters (Distraction-free)',
    strokeClass: 'text-transparent',
    gradientClass: 'from-transparent to-transparent',
    accentClass: 'bg-zinc-500/15 text-zinc-800 dark:text-zinc-200 border-zinc-500/30',
    windowSwatches: ['#FAFAFA', '#18181B', '#09090B'],
    light: {
      background: '#FAFAFA',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#18181B',
      text: '#18181B',
      borders: '#E4E4E7',
    },
    dark: {
      background: '#09090B',
      sidebar: '#18181B',
      cards: '#18181B',
      primary: '#FAFAFA',
      text: '#FAFAFA',
      borders: '#3F3F46',
    },
  },
  {
    id: 'midnight_professional',
    name: 'Midnight Professional',
    subtitle: 'Premium, sophisticated, and technology-oriented deep slate & sky palette',
    regionBadge: 'Tech Pro',
    category: 'enterprise',
    charactersSummary: 'No decorative characters (Executive clean)',
    strokeClass: 'text-sky-500/[0.04] dark:text-sky-400/[0.04]',
    gradientClass: 'from-slate-500/[0.04] via-transparent to-sky-500/[0.04]',
    accentClass: 'bg-sky-500/15 text-slate-800 dark:text-sky-300 border-sky-500/30',
    windowSwatches: ['#F1F5F9', '#38BDF8', '#020617'],
    light: {
      background: '#F1F5F9',
      sidebar: '#E2E8F0',
      cards: '#FFFFFF',
      primary: '#334155',
      text: '#0F172A',
      borders: '#CBD5E1',
    },
    dark: {
      background: '#020617',
      sidebar: '#0F172A',
      cards: '#1E293B',
      primary: '#38BDF8',
      text: '#F8FAFC',
      borders: '#334155',
    },
  },
  {
    id: 'emerald_operations',
    name: 'Emerald Operations',
    subtitle: 'Structured operational compliance, warehouse & logistics emerald palette',
    regionBadge: 'Operations',
    category: 'enterprise',
    charactersSummary: 'No decorative characters (Operations clean)',
    strokeClass: 'text-emerald-600/[0.04] dark:text-emerald-400/[0.04]',
    gradientClass: 'from-emerald-500/[0.03] via-transparent to-teal-500/[0.03]',
    accentClass: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
    windowSwatches: ['#F4FBF7', '#059669', '#061612'],
    light: {
      background: '#F4FBF7',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#059669',
      text: '#0F172A',
      borders: '#D1FAE5',
    },
    dark: {
      background: '#061612',
      sidebar: '#0B221B',
      cards: '#113027',
      primary: '#34D399',
      text: '#ECFDF5',
      borders: '#1E463A',
    },
  },

  // ===========================================================================
  // SEASONAL & NATURE THEMES (12)
  // ===========================================================================
  {
    id: 'christmas',
    name: 'Christmas',
    subtitle: 'Festive pine & crimson palette with Santa, elves, reindeer, stockings & ornaments',
    regionBadge: 'Holiday',
    category: 'seasonal',
    charactersSummary: 'Santa, Elves, Reindeer, Snowmen, Stockings, Candy Canes & Garlands',
    strokeClass: 'text-red-600/[0.05] dark:text-red-400/[0.05]',
    gradientClass: 'from-red-500/[0.04] via-transparent to-emerald-600/[0.04]',
    accentClass: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    windowSwatches: ['#FDF8F6', '#DC2626', '#0D1914'],
    light: {
      background: '#FDF8F6',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#DC2626',
      text: '#1C1917',
      borders: '#FECACA',
    },
    dark: {
      background: '#0D1914',
      sidebar: '#12231C',
      cards: '#182E25',
      primary: '#F87171',
      text: '#F5F5F4',
      borders: '#264638',
    },
  },
  {
    id: 'halloween',
    name: 'Halloween',
    subtitle: 'Spooky twilight & pumpkin amber with cute ghosts, bats, black cats & cobwebs',
    regionBadge: 'Spooky',
    category: 'seasonal',
    charactersSummary: 'Cute Ghosts, Tiny Bats, Black Cats, Pumpkins, Witches & Spiders',
    strokeClass: 'text-orange-500/[0.05] dark:text-orange-400/[0.05]',
    gradientClass: 'from-orange-500/[0.04] via-transparent to-purple-600/[0.04]',
    accentClass: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    windowSwatches: ['#FFFBF5', '#EA580C', '#110C1D'],
    light: {
      background: '#FFFBF5',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#EA580C',
      text: '#1C1917',
      borders: '#FED7AA',
    },
    dark: {
      background: '#110C1D',
      sidebar: '#19122B',
      cards: '#231A3A',
      primary: '#FB923C',
      text: '#FAF5FF',
      borders: '#3B2B5E',
    },
  },
  {
    id: 'valentines',
    name: "Hearts & Valentine's",
    subtitle: 'Warm rose & blush palette with Cupid, lovebirds, hanging hearts, bears & roses',
    regionBadge: 'Romance',
    category: 'seasonal',
    charactersSummary: 'Cupid, Lovebirds, Hanging Hearts, Teddy Bears, Roses & Balloons',
    strokeClass: 'text-rose-500/[0.05] dark:text-rose-400/[0.05]',
    gradientClass: 'from-rose-500/[0.04] via-transparent to-pink-500/[0.04]',
    accentClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    windowSwatches: ['#FFF5F7', '#E11D48', '#1C0D14'],
    light: {
      background: '#FFF5F7',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#E11D48',
      text: '#1F1216',
      borders: '#FECDD3',
    },
    dark: {
      background: '#1C0D14',
      sidebar: '#26121C',
      cards: '#331826',
      primary: '#FB7185',
      text: '#FFF1F2',
      borders: '#4C2438',
    },
  },
  {
    id: 'new_year',
    name: 'New Year',
    subtitle: 'Midnight champagne & gold celebration with fireworks, party hats & hanging stars',
    regionBadge: 'Festive',
    category: 'seasonal',
    charactersSummary: 'Miniature Fireworks, Party Hats, Hanging Stars, Confetti & Sparklers',
    strokeClass: 'text-amber-500/[0.05] dark:text-amber-400/[0.05]',
    gradientClass: 'from-amber-500/[0.04] via-transparent to-indigo-500/[0.04]',
    accentClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
    windowSwatches: ['#FEFCE8', '#D97706', '#0D1021'],
    light: {
      background: '#FEFCE8',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#D97706',
      text: '#1E1B18',
      borders: '#FDE68A',
    },
    dark: {
      background: '#0D1021',
      sidebar: '#141830',
      cards: '#1D2242',
      primary: '#FBBF24',
      text: '#FEF9C3',
      borders: '#313866',
    },
  },
  {
    id: 'spring_blossom',
    name: 'Spring Blossom',
    subtitle: 'Fresh meadow & petal palette with small birds, butterflies, blossoms & rabbits',
    regionBadge: 'Spring',
    category: 'seasonal',
    charactersSummary: 'Small Birds, Butterflies, Cherry Blossoms, Tiny Rabbits & Hanging Flowers',
    strokeClass: 'text-pink-500/[0.05] dark:text-pink-400/[0.05]',
    gradientClass: 'from-pink-400/[0.04] via-transparent to-emerald-400/[0.04]',
    accentClass: 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30',
    windowSwatches: ['#FDF7FA', '#DB2777', '#131C18'],
    light: {
      background: '#FDF7FA',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#DB2777',
      text: '#1E1B18',
      borders: '#FBCFE8',
    },
    dark: {
      background: '#131C18',
      sidebar: '#192621',
      cards: '#22332C',
      primary: '#F472B6',
      text: '#FDF2F8',
      borders: '#344E43',
    },
  },
  {
    id: 'summer_breeze',
    name: 'Summer Breeze',
    subtitle: 'Coastal turquoise & sun-kissed coral with miniature suns, tropical birds & crabs',
    regionBadge: 'Summer',
    category: 'seasonal',
    charactersSummary: 'Miniature Suns, Tropical Birds, Palm Leaves, Small Crabs & Beach Gear',
    strokeClass: 'text-cyan-500/[0.05] dark:text-cyan-400/[0.05]',
    gradientClass: 'from-amber-400/[0.04] via-transparent to-cyan-500/[0.04]',
    accentClass: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-500/30',
    windowSwatches: ['#F0FDFA', '#0891B2', '#081C24'],
    light: {
      background: '#F0FDFA',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#0891B2',
      text: '#0F172A',
      borders: '#A5F3FC',
    },
    dark: {
      background: '#081C24',
      sidebar: '#0D2833',
      cards: '#133544',
      primary: '#22D3EE',
      text: '#ECFEFF',
      borders: '#1E4E63',
    },
  },
  {
    id: 'autumn_harvest',
    name: 'Autumn Harvest',
    subtitle: 'Warm terracotta & maple amber with tiny foxes, falling leaves, squirrels & acorns',
    regionBadge: 'Autumn',
    category: 'seasonal',
    charactersSummary: 'Tiny Foxes, Falling Leaves, Miniature Squirrels, Acorns & Pumpkins',
    strokeClass: 'text-amber-700/[0.05] dark:text-amber-500/[0.05]',
    gradientClass: 'from-amber-600/[0.04] via-transparent to-orange-600/[0.04]',
    accentClass: 'bg-amber-600/15 text-amber-800 dark:text-amber-300 border-amber-600/30',
    windowSwatches: ['#FFFBEB', '#B45309', '#1C140D'],
    light: {
      background: '#FFFBEB',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#B45309',
      text: '#271C15',
      borders: '#FDE68A',
    },
    dark: {
      background: '#1C140D',
      sidebar: '#261C12',
      cards: '#332519',
      primary: '#F59E0B',
      text: '#FEF3C7',
      borders: '#4D3826',
    },
  },
  {
    id: 'winter_frost',
    name: 'Winter Frost',
    subtitle: 'Crisp glacier blue & arctic slate with tiny penguins, polar bears, snowflakes & icicles',
    regionBadge: 'Winter',
    category: 'seasonal',
    charactersSummary: 'Tiny Penguins, Polar Bears, Snowflakes, Snowmen & Hanging Icicles',
    strokeClass: 'text-sky-500/[0.05] dark:text-sky-300/[0.05]',
    gradientClass: 'from-sky-400/[0.04] via-transparent to-blue-600/[0.04]',
    accentClass: 'bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/30',
    windowSwatches: ['#F0F9FF', '#0284C7', '#081420'],
    light: {
      background: '#F0F9FF',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#0284C7',
      text: '#0C1928',
      borders: '#BAE6FD',
    },
    dark: {
      background: '#081420',
      sidebar: '#0E1F30',
      cards: '#152C44',
      primary: '#38BDF8',
      text: '#F0F9FF',
      borders: '#214366',
    },
  },
  {
    id: 'easter',
    name: 'Easter',
    subtitle: 'Soft pastel lavender & mint with miniature rabbits, painted eggs & baby chicks',
    regionBadge: 'Pastel',
    category: 'seasonal',
    charactersSummary: 'Miniature Rabbits, Easter Eggs, Baby Chicks & Hanging Pastel Bunting',
    strokeClass: 'text-violet-500/[0.05] dark:text-violet-400/[0.05]',
    gradientClass: 'from-violet-400/[0.04] via-transparent to-teal-400/[0.04]',
    accentClass: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
    windowSwatches: ['#FAF5FF', '#7C3AED', '#161124'],
    light: {
      background: '#FAF5FF',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#7C3AED',
      text: '#1E1433',
      borders: '#E9D5FF',
    },
    dark: {
      background: '#161124',
      sidebar: '#1F1833',
      cards: '#2A2144',
      primary: '#A78BFA',
      text: '#F5F3FF',
      borders: '#403266',
    },
  },
  {
    id: 'nature_forest',
    name: 'Nature Forest',
    subtitle: 'Botanical woodland sage & moss with tiny forest animals, hanging vines & mushrooms',
    regionBadge: 'Nature',
    category: 'seasonal',
    charactersSummary: 'Woodland Animals, Hanging Vines, Toadstool Mushrooms, Birds & Butterflies',
    strokeClass: 'text-emerald-600/[0.05] dark:text-emerald-400/[0.05]',
    gradientClass: 'from-emerald-600/[0.04] via-transparent to-lime-600/[0.04]',
    accentClass: 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/30',
    windowSwatches: ['#F2F9F4', '#15803D', '#0A1910'],
    light: {
      background: '#F2F9F4',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#15803D',
      text: '#111C15',
      borders: '#BBF7D0',
    },
    dark: {
      background: '#0A1910',
      sidebar: '#102418',
      cards: '#163222',
      primary: '#4ADE80',
      text: '#F0FDF4',
      borders: '#234D34',
    },
  },
  {
    id: 'ocean_breeze',
    name: 'Ocean Breeze',
    subtitle: 'Deep marine azure & reef aqua with miniature turtles, fish, seashells & octopuses',
    regionBadge: 'Marine',
    category: 'seasonal',
    charactersSummary: 'Miniature Turtles, Small Fish, Seashells, Starfish & Tiny Octopuses',
    strokeClass: 'text-teal-500/[0.05] dark:text-teal-400/[0.05]',
    gradientClass: 'from-teal-500/[0.04] via-transparent to-blue-500/[0.04]',
    accentClass: 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-500/30',
    windowSwatches: ['#F0FDFA', '#0D9488', '#061A1E'],
    light: {
      background: '#F0FDFA',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#0D9488',
      text: '#0F1E22',
      borders: '#99F6E4',
    },
    dark: {
      background: '#061A1E',
      sidebar: '#0B252B',
      cards: '#11333B',
      primary: '#2DD4BF',
      text: '#F0FDFA',
      borders: '#1C4D59',
    },
  },
  {
    id: 'sakura_dream',
    name: 'Sakura Dream',
    subtitle: 'Serene Japanese cherry blossom pink & ink slate with tiny cats & sakura branches',
    regionBadge: 'Sakura',
    category: 'seasonal',
    charactersSummary: 'Maneki-Neko Charms, Cherry Blossom Branches, Tiny Cats & Floating Petals',
    strokeClass: 'text-pink-400/[0.05] dark:text-pink-300/[0.05]',
    gradientClass: 'from-pink-400/[0.04] via-transparent to-rose-400/[0.04]',
    accentClass: 'bg-pink-500/15 text-pink-800 dark:text-pink-300 border-pink-500/30',
    windowSwatches: ['#FFF7F9', '#E11D48', '#171118'],
    light: {
      background: '#FFF7F9',
      sidebar: '#FFFFFF',
      cards: '#FFFFFF',
      primary: '#DB2777',
      text: '#24151E',
      borders: '#FBCFE8',
    },
    dark: {
      background: '#171118',
      sidebar: '#221924',
      cards: '#2E2231',
      primary: '#F472B6',
      text: '#FDF2F8',
      borders: '#49354D',
    },
  },
];

interface TelegramDoodleBackgroundProps {
  className?: string;
  themeId?: BackgroundIconTheme;
  seasonalDecorations?: boolean;
  characterDensity?: CharacterDensity;
}

/**
 * Renders subtle peripheral "Floating Nearby" particles (snowflakes, petals, hearts,
 * autumn leaves, bubbles, or stars) ONLY in outer viewport margins—never over functional content.
 */
const THEME_PARTICLE_POSITION_SETS: string[][] = [
  [
    'top-16 left-3',
    'top-36 right-4',
    'bottom-24 left-5',
    'bottom-32 right-5',
    'top-1/2 left-2.5',
    'top-2/3 right-3',
    'top-24 left-10 hidden xl:block',
    'bottom-16 right-12 hidden xl:block',
    'top-1/3 left-4 hidden lg:block',
    'bottom-1/3 right-4 hidden lg:block',
    'top-20 right-10 hidden xl:block',
    'bottom-20 left-12 hidden xl:block',
    'top-3/4 left-3.5 hidden md:block',
    'top-1/4 right-3.5 hidden md:block',
  ],
  [
    'top-28 left-6',
    'top-14 right-7',
    'bottom-36 left-3',
    'bottom-14 right-4',
    'top-2/3 left-4',
    'top-1/3 right-2.5',
    'top-44 left-12 hidden xl:block',
    'bottom-28 right-10 hidden xl:block',
    'top-1/4 left-3 hidden lg:block',
    'bottom-1/4 right-6 hidden lg:block',
    'top-32 right-14 hidden xl:block',
    'bottom-12 left-10 hidden xl:block',
    'top-1/2 left-5 hidden md:block',
    'top-3/4 right-4 hidden md:block',
  ],
  [
    'top-20 left-8',
    'top-48 right-3',
    'bottom-16 left-7',
    'bottom-44 right-6',
    'top-1/3 left-2',
    'top-3/4 right-5',
    'top-12 left-14 hidden xl:block',
    'bottom-32 right-14 hidden xl:block',
    'top-2/5 left-5 hidden lg:block',
    'bottom-2/5 right-3 hidden lg:block',
    'top-16 right-12 hidden xl:block',
    'bottom-28 left-14 hidden xl:block',
    'top-4/5 left-4 hidden md:block',
    'top-1/5 right-5 hidden md:block',
  ],
  [
    'top-40 left-3.5',
    'top-20 right-5',
    'bottom-28 left-8',
    'bottom-20 right-3.5',
    'top-1/4 left-4',
    'top-1/2 right-4',
    'top-32 left-11 hidden xl:block',
    'bottom-40 right-11 hidden xl:block',
    'top-3/5 left-3.5 hidden lg:block',
    'bottom-1/5 right-5 hidden lg:block',
    'top-24 right-8 hidden xl:block',
    'bottom-14 left-9 hidden xl:block',
    'top-2/3 left-6 hidden md:block',
    'top-1/3 right-6 hidden md:block',
  ],
];

function getThemeSeedIndex(themeId: BackgroundIconTheme): number {
  const order: BackgroundIconTheme[] = [
    'christmas',
    'halloween',
    'valentines',
    'new_year',
    'spring_blossom',
    'summer_breeze',
    'autumn_harvest',
    'winter_frost',
    'easter',
    'nature_forest',
    'ocean_breeze',
    'sakura_dream',
  ];
  const idx = order.indexOf(themeId);
  return idx >= 0 ? idx : 0;
}

const AmbientFloatingParticles: React.FC<{
  themeId: BackgroundIconTheme;
  density: CharacterDensity;
}> = ({ themeId, density }) => {
  if (density === 'off' || isCharacterFreeEnterpriseTheme(themeId)) {
    return null;
  }

  const count = density === 'minimal' ? 5 : density === 'balanced' ? 10 : 14;
  const seed = getThemeSeedIndex(themeId);
  const baseSet = THEME_PARTICLE_POSITION_SETS[seed % THEME_PARTICLE_POSITION_SETS.length];
  const rotated = baseSet.map((_, i) => baseSet[(i + seed * 3) % baseSet.length]);
  const positions = rotated.slice(0, count);

  const renderParticleSvg = (idx: number) => {
    switch (themeId) {
      case 'christmas':
      case 'winter_frost':
        return (
          <svg className="w-5 h-5 text-sky-400/40 dark:text-sky-300/30 char-anim-float" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" />
          </svg>
        );
      case 'valentines':
        return (
          <svg className="w-5 h-5 text-rose-400/40 dark:text-rose-300/30 char-anim-bounce" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        );
      case 'sakura_dream':
      case 'spring_blossom':
        return (
          <svg className="w-5 h-5 text-pink-400/45 dark:text-pink-300/35 char-anim-sway" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C9 6 6 9 6 13a6 6 0 0012 0c0-4-3-7-6-11zm0 9a2 2 0 110 4 2 2 0 010-4z" />
          </svg>
        );
      case 'autumn_harvest':
        return (
          <svg className="w-5 h-5 text-amber-500/40 dark:text-amber-400/30 char-anim-sway" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 3c-3 0-6 2-8 5-2-1-4 0-5 2 2 1 3 3 2 5 2 0 4 1 5 3 1-2 3-3 5-3-1-2 0-4 2-5-1-2-1-4-1-7z" />
          </svg>
        );
      case 'halloween':
        return (
          <svg className="w-5 h-5 text-orange-400/40 dark:text-purple-300/30 char-anim-float" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4L12 2z" />
          </svg>
        );
      case 'new_year':
      case 'midnight_professional':
        return (
          <svg className="w-5 h-5 text-amber-400/40 dark:text-sky-300/35 char-anim-bounce" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="12 2 14.9 8.6 22 9.3 16.5 14 18.2 21 12 17.3 5.8 21 7.5 14 2 9.3 9.1 8.6 12 2" />
          </svg>
        );
      case 'ocean_breeze':
      case 'summer_breeze':
        return (
          <svg className="w-5 h-5 text-cyan-400/40 dark:text-cyan-300/30 char-anim-float" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r={idx % 2 === 0 ? '7' : '5'} />
            <circle cx="9.5" cy="9.5" r="1.5" fill="currentColor" />
          </svg>
        );
      case 'minimal_monochrome':
        return (
          <svg className="w-3 h-3 text-zinc-400/40 dark:text-zinc-500/35 char-anim-float" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4L12 2z" />
          </svg>
        );
      case 'default':
        return (
          <svg className="w-5 h-5 text-blue-400/35 dark:text-blue-300/30 char-anim-float" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4L12 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5 text-emerald-500/35 dark:text-emerald-300/30 char-anim-float" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66l.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z" />
          </svg>
        );
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none hidden sm:block" aria-hidden="true">
      {positions.map((posClass, idx) => (
        <div key={idx} className={`absolute ${posClass} transition-opacity duration-500`}>
          {renderParticleSvg(idx)}
        </div>
      ))}
    </div>
  );
};

/**
 * Clean, distraction-free surface backdrop that respects each theme's
 * visual aesthetic and optional peripheral seasonal particles.
 */
export const TelegramDoodleBackground: React.FC<TelegramDoodleBackgroundProps> = ({
  className = '',
  themeId = 'default',
  seasonalDecorations = true,
  characterDensity = 'balanced',
}) => {
  const activeTheme =
    BACKGROUND_ICON_THEMES.find((t) => t.id === themeId) || BACKGROUND_ICON_THEMES[0];

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden select-none ${className}`}
      aria-hidden="true"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${activeTheme.gradientClass}`} />
      {seasonalDecorations && (
        <AmbientFloatingParticles themeId={activeTheme.id} density={characterDensity} />
      )}
    </div>
  );
};
