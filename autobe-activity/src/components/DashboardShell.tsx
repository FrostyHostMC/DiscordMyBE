import React, { useState } from 'react';
import {
  Layers,
  Wrench,
  Boxes,
  ScrollText,
  Palette,
  LayoutGrid,
  AlertTriangle,
  GitFork,
  History,
  FileCode2,
  Settings,
  HelpCircle,
  Info,
  Check,
  Zap,
  Radio,
  Gamepad2,
  HardDrive,
  X,
  Menu,
  ChevronRight,
  UploadCloud
} from 'lucide-react';
import { TabType } from '@/types/modpack';

export interface NavGroup {
  label: string;
  items: {
    id: TabType;
    label: string;
    icon: React.ReactNode;
    badge?: string | number;
  }[];
}

const iconProps = { className: 'w-4 h-4 shrink-0', strokeWidth: 1.8 } as const;

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'WORKSPACE',
    items: [
      { id: 'overview', label: 'Overview', icon: <Layers {...iconProps} /> },
      { id: 'workspace', label: 'Merge Workspace', icon: <Wrench {...iconProps} /> },
      { id: 'mypacks', label: 'My Projects', icon: <Boxes {...iconProps} /> }
    ]
  },
  {
    label: 'LIBRARY',
    items: [
      { id: 'bp_library', label: 'Behavior Packs', icon: <ScrollText {...iconProps} /> },
      { id: 'rp_library', label: 'Resource Packs', icon: <Palette {...iconProps} /> },
      { id: 'library', label: 'Import History', icon: <LayoutGrid {...iconProps} /> }
    ]
  },
  {
    label: 'TOOLS',
    items: [
      { id: 'conflicts_tool', label: 'Conflict Analyzer', icon: <AlertTriangle {...iconProps} /> },
      { id: 'dependencies_tool', label: 'Dependencies', icon: <GitFork {...iconProps} /> },
      { id: 'history_tool', label: 'Merge History', icon: <History {...iconProps} /> },
      { id: 'logs_tool', label: 'Logs', icon: <FileCode2 {...iconProps} /> }
    ]
  },
  {
    label: 'APPLICATION',
    items: [
      { id: 'settings', label: 'Settings', icon: <Settings {...iconProps} /> },
      { id: 'about', label: 'Help', icon: <HelpCircle {...iconProps} /> }
    ]
  }
];

export const BrandMark: React.FC<{ size?: string }> = ({ size = 'w-8 h-8' }) => (
  <div
    className={`flex items-center justify-center ${size} rounded-xl bg-gradient-to-br from-[#762BFF] to-[#4F13C4] border border-[#A855F7]/40 shadow-[0_0_15px_rgba(118,43,255,0.35)] shrink-0`}
  >
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="white" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zM4 6.5l8 4.5m0 0l8-4.5M12 11v9"
      />
    </svg>
  </div>
);

interface SidebarProps {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
  onStartCreate: () => void;
  onImportClick: () => void;
  bpCount?: number;
  rpCount?: number;
  projectCount?: number;
  onCloseMobileDrawer?: () => void;
}

export const AppSidebar: React.FC<SidebarProps> = ({
  currentTab,
  onChangeTab,
  bpCount = 0,
  rpCount = 0,
  projectCount = 0,
  onCloseMobileDrawer
}) => {
  const activeTabKey = currentTab === 'home' ? 'overview' : currentTab;

  const handleSelect = (tab: TabType) => {
    onChangeTab(tab);
    onCloseMobileDrawer?.();
  };

  return (
    <aside className="flex flex-col w-60 h-full bg-[#100D18] border-r border-[#30263F]/70 select-none">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#30263F]/60">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div>
            <div className="text-sm font-black tracking-tight text-white leading-none">
              Auto<span className="text-[#A855F7]">BE</span>
            </div>
            <div className="text-[10px] text-[#AAA3BB] font-medium tracking-wide mt-1">
              Bedrock Merging Studio
            </div>
          </div>
        </div>
        {onCloseMobileDrawer && (
          <button
            type="button"
            onClick={onCloseMobileDrawer}
            className="p-1 rounded-lg text-[#AAA3BB] hover:text-white hover:bg-[#15111F] transition-colors"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-2.5 pb-1 text-[10px] font-bold text-[#716885] tracking-wider uppercase">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = activeTabKey === item.id;
                let badgeVal: string | number | undefined = item.badge;
                if (item.id === 'bp_library' && bpCount > 0) badgeVal = bpCount;
                if (item.id === 'rp_library' && rpCount > 0) badgeVal = rpCount;
                if (item.id === 'mypacks' && projectCount > 0) badgeVal = projectCount;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-all ${
                      isActive
                        ? 'bg-[#762BFF]/20 text-[#F7F5FC] border border-[#762BFF]/50 shadow-[0_0_12px_rgba(118,43,255,0.2)]'
                        : 'text-[#AAA3BB] hover:text-white hover:bg-[#15111F] border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={isActive ? 'text-[#A855F7]' : 'text-[#847A9B]'}>
                        {item.icon}
                      </span>
                      <span className="text-xs font-semibold truncate">{item.label}</span>
                    </div>

                    {badgeVal !== undefined ? (
                      <span
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-md ${
                          isActive
                            ? 'bg-[#762BFF] text-white'
                            : 'bg-[#15111F] text-[#AAA3BB] border border-[#30263F]'
                        }`}
                      >
                        {badgeVal}
                      </span>
                    ) : isActive ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A855F7]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer System Pill */}
      <div className="p-3 border-t border-[#30263F]/60 bg-[#0C0A13]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-white">AutoBE Studio</span>
          </div>
          <span className="text-[10px] font-mono text-[#AAA3BB] bg-[#15111F] px-1.5 py-0.5 rounded border border-[#30263F]">
            v2.3.0
          </span>
        </div>
      </div>
    </aside>
  );
};

/* ---------- Compact Top Bar ---------- */

interface TopBarProps {
  currentTab: TabType;
  onOpenMobileNav: () => void;
  onStartCreate: () => void;
  onImportClick: () => void;
  installedCount: number;
  modpackCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  currentTab,
  onOpenMobileNav,
  onStartCreate,
  onImportClick,
  installedCount,
  modpackCount
}) => {
  const getBreadcrumb = () => {
    switch (currentTab) {
      case 'home':
      case 'overview':
        return 'Overview';
      case 'workspace':
        return 'Merge Workspace';
      case 'mypacks':
        return 'My Projects';
      case 'bp_library':
        return 'Library / Behavior Packs';
      case 'rp_library':
        return 'Library / Resource Packs';
      case 'library':
        return 'Library / Import History';
      case 'conflicts_tool':
        return 'Tools / Conflict Analyzer';
      case 'dependencies_tool':
        return 'Tools / Dependencies';
      case 'history_tool':
        return 'Tools / Merge History';
      case 'logs_tool':
        return 'Tools / Logs';
      case 'settings':
        return 'Settings';
      case 'about':
        return 'Help & Documentation';
      default:
        return 'AutoBE';
    }
  };

  return (
    <header className="flex items-center justify-between px-3 sm:px-5 pt-[max(3rem,env(safe-area-inset-top))] pb-2.5 md:pt-2.5 bg-[#100D18] border-b border-[#30263F]/70 shrink-0 z-20">
      {/* Left: Mobile Nav toggle + Breadcrumb */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
          aria-label="Open Navigation"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <div className="md:hidden flex items-center gap-1.5 shrink-0">
            <BrandMark size="w-6 h-6" />
          </div>
          <div className="text-xs sm:text-sm font-bold text-white truncate flex items-center gap-1">
            <span>{getBreadcrumb()}</span>
          </div>
        </div>
      </div>

      {/* Right: Quick actions & status */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onImportClick}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-xs font-semibold text-[#AAA3BB] hover:text-white transition-all active:scale-95"
        >
          <UploadCloud className="w-3.5 h-3.5 text-[#A855F7]" />
          <span>Import</span>
        </button>

      </div>
    </header>
  );
};

/* ---------- Right Utility Panel (desktop wide screens) ---------- */

interface UtilityPanelProps {
  modpackCount: number;
  libraryCount: number;
  onStartCreate: () => void;
  onChangeTab: (tab: TabType) => void;
  onOpenAbout: () => void;
}

export const UtilityPanel: React.FC<UtilityPanelProps> = ({
  modpackCount,
  libraryCount,
  onChangeTab,
  onOpenAbout
}) => {
  return (
    <aside className="hidden xl:flex flex-col w-64 shrink-0 h-full border-l border-[#30263F]/70 bg-[#100D18] overflow-y-auto p-3.5 gap-3 select-none">
      {/* Studio Info Card */}
      <div className="rounded-xl bg-[#15111F] border border-[#30263F] p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-[#A855F7]" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">AutoBE Studio</span>
          </div>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#762BFF]/20 text-[#A855F7] border border-[#762BFF]/30">
            Bedrock
          </span>
        </div>
        <p className="text-[11px] text-[#AAA3BB] leading-relaxed">
          Minecraft Bedrock addon consolidator running fully on-device.
        </p>
        <div className="mt-3 pt-2.5 border-t border-[#30263F]/60 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#AAA3BB]">Active Addons</span>
            <span className="font-mono font-bold text-white">{libraryCount}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#AAA3BB]">Saved Modpacks</span>
            <span className="font-mono font-bold text-white">{modpackCount}</span>
          </div>
        </div>
      </div>

      {/* Quick Tools */}
      <div className="rounded-xl bg-[#15111F] border border-[#30263F] p-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <Zap className="w-3.5 h-3.5 text-[#A855F7]" />
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">Quick Actions</span>
        </div>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onChangeTab('conflicts_tool')}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-left transition-colors text-xs text-white"
          >
            <span>Analyze Conflicts</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#AAA3BB]" />
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('settings')}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-left transition-colors text-xs text-white"
          >
            <span>Download App Codebase</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#AAA3BB]" />
          </button>
          <button
            type="button"
            onClick={() => onChangeTab('settings')}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-left transition-colors text-xs text-white"
          >
            <span>Preferences & Tweaks</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#AAA3BB]" />
          </button>
        </div>
      </div>

      {/* Engine Status */}
      <div className="rounded-xl bg-[#15111F] border border-[#30263F] p-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <Radio className="w-3.5 h-3.5 text-[#A855F7]" />
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">Engine Status</span>
        </div>
        <div className="space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[#AAA3BB]">
              <Gamepad2 className="w-3.5 h-3.5 text-[#762BFF]" /> Minecraft Bedrock
            </span>
            <span className="text-emerald-400 font-semibold">1.20 - 1.21+</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[#AAA3BB]">
              <HardDrive className="w-3.5 h-3.5 text-[#762BFF]" /> Storage Engine
            </span>
            <span className="text-emerald-400 font-semibold">IndexedDB</span>
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-[#30263F]/50 flex items-center gap-1.5 text-[10px] text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Ready to merge
        </div>
      </div>
    </aside>
  );
};