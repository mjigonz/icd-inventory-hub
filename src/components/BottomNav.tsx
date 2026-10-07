import React from 'react';
import { Store, ClipboardList, PackageSearch, Activity } from 'lucide-react';

export type NavTab = 'branch' | 'count' | 'inventory' | 'monitoring';

interface BottomNavProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  countItemTotal?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  countItemTotal = 0,
}) => {
  const tabs = [
    {
      id: 'branch' as NavTab,
      label: 'Branch',
      icon: Store,
    },
    {
      id: 'count' as NavTab,
      label: 'Count',
      icon: ClipboardList,
      badge: countItemTotal > 0 ? countItemTotal : null,
    },
    {
      id: 'inventory' as NavTab,
      label: 'Inventory',
      icon: PackageSearch,
    },
    {
      id: 'monitoring' as NavTab,
      label: 'Monitoring',
      icon: Activity,
    },
  ];

  return (
    <nav id="app-bottom-nav" className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] pb-[env(safe-area-inset-bottom,0px)] transition-colors duration-280">
      <div className="max-w-md mx-auto grid grid-cols-4 h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 transition-all relative cursor-pointer select-none active:scale-95 ${
                isActive
                  ? 'text-zinc-900 dark:text-zinc-100 font-bold'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 font-medium'
              }`}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    isActive ? 'scale-110 text-zinc-900 dark:text-zinc-100 stroke-[2.4]' : 'stroke-[1.8]'
                  }`}
                />
                {tab.badge !== null && tab.badge !== undefined && (
                  <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 bg-zinc-900 dark:bg-zinc-700 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-xs border border-zinc-700 dark:border-zinc-600">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[11px] tracking-tight leading-none ${isActive ? 'text-zinc-900 dark:text-zinc-100 font-bold' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute top-0 w-8 h-0.5 bg-zinc-900 dark:bg-zinc-200 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
