import React from 'react';
import { Layers, Wrench, Boxes, LayoutGrid, Settings } from 'lucide-react';
import { TabType } from '@/types/modpack';

interface BottomNavProps {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onChangeTab }) => {
  const activeTabKey = currentTab === 'home' ? 'overview' : currentTab;

  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <Layers className="w-5 h-5" />
    },
    {
      id: 'workspace',
      label: 'Workspace',
      icon: <Wrench className="w-5 h-5" />
    },
    {
      id: 'mypacks',
      label: 'Projects',
      icon: <Boxes className="w-5 h-5" />
    },
    {
      id: 'library',
      label: 'Library',
      icon: <LayoutGrid className="w-5 h-5" />
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings className="w-5 h-5" />
    }
  ];

  return (
    <nav className="md:hidden w-full bg-[#100D18] border-t border-[#30263F]/70 px-2 py-1.5 shrink-0 z-20 select-none">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => {
          const active = activeTabKey === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id)}
              className={`flex flex-col items-center justify-center min-w-[56px] py-1 rounded-xl transition-all ${
                active
                  ? 'text-white font-bold drop-shadow-[0_0_10px_rgba(118,43,255,0.5)]'
                  : 'text-[#AAA3BB] hover:text-white active:scale-95'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  active ? 'bg-[#762BFF]/20 text-[#A855F7] border border-[#762BFF]/40' : ''
                }`}
              >
                {tab.icon}
              </div>
              <span className="text-[10px] mt-0.5 tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};