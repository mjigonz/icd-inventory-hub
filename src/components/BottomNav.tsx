import React from 'react';
import { Store, ClipboardList, PackageSearch, Activity, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../services/i18n';

export type NavTab = 'branch' | 'count' | 'inventory' | 'monitoring' | 'admin';

interface BottomNavProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  countItemTotal?: number;
  isAdminMode?: boolean;
  isUserAdmin?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  countItemTotal = 0,
}) => {
  const { t } = useLanguage();
  const isOverallCountActive =
    currentTab === 'branch' || currentTab === 'count' || currentTab === 'monitoring';
  const isInventoryActive = currentTab === 'inventory';

  const overallSubTabs: Array<{
    id: NavTab;
    label: string;
    icon: React.ElementType;
    badge?: number | null;
  }> = [
    {
      id: 'branch',
      label: t.navBranch,
      icon: Store,
    },
    {
      id: 'count',
      label: t.navCount,
      icon: ClipboardList,
      badge: countItemTotal > 0 ? countItemTotal : null,
    },
    {
      id: 'monitoring',
      label: t.navMonitoring,
      icon: Activity,
    },
  ];

  return (
    <nav
      id="app-bottom-nav"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom,0px)] transition-colors duration-280"
    >
      {/* When Overall Count is active, show its inner Branch / Count / Monitoring sub-navigation bar */}
      {isOverallCountActive && (
        <div className="max-w-lg mx-auto px-2.5 pt-2 pb-1">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-blue-50/80 dark:bg-slate-800/90 border border-blue-200/70 dark:border-slate-700">
            {overallSubTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] transition-all relative cursor-pointer select-none active:scale-95 ${
                    isActive
                      ? 'bg-blue-600 text-white font-bold shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-semibold'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                  {tab.badge !== null && tab.badge !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 text-[9.5px] font-black rounded-full leading-tight ${
                        isActive ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'
                      }`}
                    >
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Two Large Primary Buttons: Overall Count vs Inventory (Masterdata Access) */}
      <div className="max-w-lg mx-auto grid grid-cols-2 gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={() => {
            if (!isOverallCountActive) {
              onSelectTab('branch');
            }
          }}
          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-2xl border transition-all relative cursor-pointer select-none active:scale-97 ${
            isOverallCountActive
              ? 'bg-blue-600 text-white border-blue-600 font-bold shadow-xs'
              : 'bg-slate-100/90 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80 font-semibold'
          }`}
        >
          <ClipboardList className="w-4 h-4 shrink-0" />
          <div className="text-left leading-tight min-w-0">
            <div className="text-xs font-extrabold truncate flex items-center gap-1">
              <span>Overall Count</span>
              {countItemTotal > 0 && (
                <span
                  className={`px-1.5 py-0.2 text-[9.5px] font-black rounded-full ${
                    isOverallCountActive ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'
                  }`}
                >
                  {countItemTotal > 99 ? '99+' : countItemTotal}
                </span>
              )}
            </div>
            <div
              className={`text-[9.5px] truncate ${
                isOverallCountActive ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Branch • Count • Monitoring
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('inventory')}
          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-2xl border transition-all relative cursor-pointer select-none active:scale-97 ${
            isInventoryActive
              ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
              : 'bg-slate-100/90 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80 font-semibold'
          }`}
        >
          <PackageSearch className="w-4 h-4 shrink-0" />
          <div className="text-left leading-tight min-w-0">
            <div className="text-xs font-extrabold truncate">{t.navInventory}</div>
            <div
              className={`text-[9.5px] truncate ${
                isInventoryActive ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              Masterdata Access
            </div>
          </div>
        </button>
      </div>
    </nav>
  );
};
