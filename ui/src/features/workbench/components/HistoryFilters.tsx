import React from 'react';
import { Search, Shield, RotateCcw } from 'lucide-react';

interface HistoryFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedMethod: string;
  onSelectMethod: (m: string) => void;
  selectedStatus: string;
  onSelectStatus: (s: string) => void;
  selectedAuth: string;
  onSelectAuth: (a: string) => void;
  selectedTag: string;
  onSelectTag: (t: string) => void;
  isInScopeOnly: boolean;
  onToggleInScopeOnly: () => void;
  onResetFilters: () => void;
  totalCount: number;
  filteredCount: number;
}

export const HistoryFilters: React.FC<HistoryFiltersProps> = ({
  searchQuery,
  onSearchChange,
  selectedMethod,
  onSelectMethod,
  selectedStatus,
  onSelectStatus,
  selectedAuth,
  onSelectAuth,
  selectedTag,
  onSelectTag,
  isInScopeOnly,
  onToggleInScopeOnly,
  onResetFilters,
  totalCount,
  filteredCount,
}) => {
  const methods = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const statusOptions = [
    { label: 'Status: All', value: 'ALL' },
    { label: '2xx Success', value: '2xx' },
    { label: '3xx Redirect', value: '3xx' },
    { label: '4xx Client Err', value: '4xx' },
    { label: '5xx Server Err', value: '5xx' },
  ];
  const authOptions = [
    { label: 'Auth: All', value: 'ALL' },
    { label: 'session:tenant-a', value: 'session:tenant-a' },
    { label: 'session:admin', value: 'session:admin' },
    { label: 'unauthenticated', value: 'unauthenticated' },
  ];
  const tags = ['ALL', 'api', 'object-id', 'state-changing', 'destructive', 'auth'];

  const hasActiveFilters =
    searchQuery !== '' ||
    selectedMethod !== 'ALL' ||
    selectedStatus !== 'ALL' ||
    selectedAuth !== 'ALL' ||
    selectedTag !== 'ALL' ||
    isInScopeOnly;

  return (
    <div className="p-3 border-b border-border bg-surface flex flex-col gap-2.5 font-sans select-none shrink-0">
      {/* Row 1: Search, Method Pills & Scope Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Search input */}
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter requests by URL, path, host, or tags..."
            className="w-full bg-bg border border-border rounded-lg pl-8 pr-3 py-1 text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent font-mono"
          />
        </div>

        {/* Method Pills */}
        <div className="flex items-center gap-1 bg-bg p-0.5 rounded-lg border border-border">
          {methods.map((m) => (
            <button
              key={m}
              onClick={() => onSelectMethod(m)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors ${
                selectedMethod === m
                  ? 'bg-surface text-accent border border-border shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* In-Scope Only Toggle */}
        <button
          onClick={onToggleInScopeOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition-colors ${
            isInScopeOnly
              ? 'bg-success/15 border-success/40 text-success font-semibold'
              : 'bg-bg border-border text-text-muted hover:text-text'
          }`}
          title="Filter to in-scope targets only"
        >
          <Shield className="w-3.5 h-3.5" />
          <span>In-Scope Only</span>
        </button>
      </div>

      {/* Row 2: Status Dropdown, Auth Dropdown, Tag Pills & Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Dropdown */}
          <select
            value={selectedStatus}
            onChange={(e) => onSelectStatus(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-0.5 text-xs text-text font-mono focus:outline-none focus:border-accent"
          >
            {statusOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Auth Dropdown */}
          <select
            value={selectedAuth}
            onChange={(e) => onSelectAuth(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-0.5 text-xs text-text font-mono focus:outline-none focus:border-accent"
          >
            {authOptions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>

          {/* Tag Pills */}
          <div className="flex items-center gap-1 text-[11px] font-mono text-text-muted pl-2 border-l border-border">
            <span>Tags:</span>
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => onSelectTag(t)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  selectedTag === t
                    ? 'bg-accent/20 text-accent font-semibold border border-accent/40'
                    : 'hover:text-text'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Counter and Reset */}
        <div className="flex items-center gap-3 text-xs font-mono text-text-muted">
          <span>
            Showing <strong className="text-text">{filteredCount}</strong> of {totalCount} requests
          </span>
          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="flex items-center gap-1 text-[11px] text-accent hover:underline"
              title="Reset all filters"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
