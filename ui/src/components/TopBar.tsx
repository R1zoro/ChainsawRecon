import React, { useRef, useEffect } from 'react';
import { Search, Settings, Star, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { EnvironmentHealth, MockServiceMode } from '../api/types';
import { getMockServiceMode, setMockServiceMode } from '../api/client';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  environment?: EnvironmentHealth;
  onOpenSettings?: () => void;
  onModeChange?: (mode: MockServiceMode) => void;
  currentMode?: MockServiceMode;
}

export const TopBar: React.FC<TopBarProps> = ({
  searchQuery,
  onSearchChange,
  environment,
  onOpenSettings,
  onModeChange,
  currentMode = getMockServiceMode(),
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const showDevStateSwitcher = import.meta.env.DEV && import.meta.env.VITE_UI_STATE_SWITCHER !== 'false';
  const isMockMode = import.meta.env.VITE_USE_MOCKS !== 'false';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getProviderPill = () => {
    if (!environment) return null;
    const { healthy, degraded, unavailable } = environment.providers;

    if (unavailable > 0 || (healthy === 0 && degraded === 0)) {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded-full bg-danger/15 text-danger border border-danger/30">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>No provider configured</span>
        </div>
      );
    }
    if (degraded > 0) {
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded-full bg-warning/15 text-warning border border-warning/30">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{degraded} provider degraded</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded-full bg-success/15 text-success border border-success/30">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>Providers healthy</span>
      </div>
    );
  };

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-lg">⛓️</span>
          <span className="font-semibold text-text tracking-tight text-base">ChainsawRecon</span>
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted">
            v2 preview
          </span>
          {isMockMode && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">
              mock data
            </span>
          )}
        </div>

        {/* Global Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search engagements, targets, findings… (Press /)"
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-bg border border-border rounded-md text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-muted/70 bg-surface-2 px-1.5 py-0.5 rounded border border-border">
            /
          </kbd>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Dev-Only State Switcher */}
          {showDevStateSwitcher && (
            <div className="flex items-center gap-1.5 bg-bg/80 border border-border px-2 py-1 rounded text-xs">
              <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Dev State:</span>
              <select
                value={currentMode}
                onChange={(e) => {
                  const mode = e.target.value as MockServiceMode;
                  setMockServiceMode(mode);
                  onModeChange?.(mode);
                }}
                className="bg-transparent text-xs text-text border-none focus:outline-none cursor-pointer font-mono"
              >
                <option value="healthy" className="bg-surface text-text">Healthy</option>
                <option value="empty" className="bg-surface text-text">Empty (First-run)</option>
                <option value="error" className="bg-surface text-text">Error</option>
                <option value="partial" className="bg-surface text-text">Partial Failure</option>
                <option value="disconnected" className="bg-surface text-text">Disconnected</option>
              </select>
            </div>
          )}

          {getProviderPill()}

          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open settings"
            className="p-1.5 text-text-muted hover:text-text hover:bg-surface-2 rounded border border-transparent hover:border-border transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          <a
            href="https://github.com/R1zoro/ChainsawRecon"
            target="_blank"
            rel="noopener noreferrer"
            title="Star ChainsawRecon on GitHub"
            aria-label="Star ChainsawRecon on GitHub"
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text px-2 py-1 rounded border border-border hover:bg-surface-2 transition-colors"
          >
            <Star className="w-3.5 h-3.5 text-warning fill-warning/20" />
            <span className="font-mono text-[11px]">Star</span>
          </a>
        </div>
      </div>
    </header>
  );
};
