import React, { useState, useMemo } from 'react';
import { 
  Search, Shield, AlertTriangle, ArrowUpDown, 
  ArrowUp, ArrowDown, ChevronRight, Filter 
} from 'lucide-react';
import { AppEntity } from '../../../api/types';
import { appEntityView } from '../appEntityView';

interface AppModelTableViewProps {
  entities: AppEntity[];
  selectedEntity: AppEntity | null;
  onSelectEntity: (entity: AppEntity) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedKind: string;
  onSelectKind: (kind: string) => void;
  isStaleOnly: boolean;
  onToggleStaleOnly: () => void;
}

type SortField = 'kind' | 'name' | 'confidence' | 'lastSeen';
type SortOrder = 'asc' | 'desc';

export const AppModelTableView: React.FC<AppModelTableViewProps> = ({
  entities,
  selectedEntity,
  onSelectEntity,
  searchQuery,
  onSearchChange,
  selectedKind,
  onSelectKind,
  isStaleOnly,
  onToggleStaleOnly,
}) => {
  const [sortField, setSortField] = useState<SortField>('kind');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Filter and sort items
  const processedEntities = useMemo(() => {
    let result = entities.filter((entity) => {
      // Kind filter
      if (selectedKind !== 'all' && entity.kind !== selectedKind) {
        return false;
      }
      // Stale filter
      if (isStaleOnly && !entity.stale) {
        return false;
      }
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = entity.name.toLowerCase().includes(q);
        const matchesTag = entity.tags.some((t) => t.toLowerCase().includes(q));
        const matchesMeta = JSON.stringify(entity.meta).toLowerCase().includes(q);
        if (!matchesName && !matchesTag && !matchesMeta) {
          return false;
        }
      }
      return true;
    });

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'kind') {
        cmp = a.kind.localeCompare(b.kind);
      } else if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'confidence') {
        const rank: Record<string, number> = { confirmed: 3, observed: 2, tentative: 1 };
        cmp = (rank[a.confidence] || 0) - (rank[b.confidence] || 0);
      } else if (sortField === 'lastSeen') {
        cmp = new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [entities, selectedKind, isStaleOnly, searchQuery, sortField, sortOrder]);

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-text-muted/40" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-accent" />
    ) : (
      <ArrowDown className="w-3 h-3 text-accent" />
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg overflow-hidden font-sans">
      {/* Table Toolbar */}
      <div className="border-b border-border bg-surface/70 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
        {/* Search & Kind filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-text-muted/60" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter inventory table..."
              className="w-full pl-8 pr-3 py-1 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto text-[11px] font-mono">
            {[
              { id: 'all', label: 'All' },
              { id: 'route', label: 'Routes' },
              { id: 'service', label: 'Services' },
              { id: 'input', label: 'Inputs' },
              { id: 'identity', label: 'Identities' },
              { id: 'technology', label: 'Tech' },
              { id: 'finding', label: 'Findings' },
            ].map((k) => (
              <button
                key={k.id}
                onClick={() => onSelectKind(k.id)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  selectedKind === k.id
                    ? 'bg-surface-2 text-text font-semibold border border-border'
                    : 'text-text-muted hover:text-text hover:bg-surface-2/40'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Results Count & Stale Toggle */}
        <div className="flex items-center gap-3 text-xs font-mono text-text-muted shrink-0">
          <button
            onClick={onToggleStaleOnly}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition-colors ${
              isStaleOnly
                ? 'bg-warning/20 text-warning border-warning/50 font-semibold'
                : 'bg-bg text-text-muted border-border hover:text-text'
            }`}
            title="Filter to stale assets only"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Stale Only</span>
          </button>

          <span>{processedEntities.length} {processedEntities.length === 1 ? 'entity' : 'entities'}</span>
        </div>
      </div>

      {/* Authoritative Table Area */}
      <div className="flex-1 overflow-auto">
        {processedEntities.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-text-muted space-y-2">
            <Filter className="w-8 h-8 opacity-40 text-text-muted" />
            <p className="text-sm font-medium text-text">No inventory entities found.</p>
            <p className="text-xs text-text-muted/80 max-w-sm">
              Try adjusting your search criteria or switching to "All" kinds.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs font-mono border-collapse select-none">
            <thead className="sticky top-0 bg-surface border-b border-border text-[11px] text-text-muted uppercase tracking-wider z-10 shadow-sm">
              <tr>
                <th
                  onClick={() => handleSort('kind')}
                  className="px-4 py-2.5 font-medium cursor-pointer hover:text-text transition-colors w-28"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Kind</span>
                    {renderSortIcon('kind')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('name')}
                  className="px-4 py-2.5 font-medium cursor-pointer hover:text-text transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Name / Target</span>
                    {renderSortIcon('name')}
                  </div>
                </th>
                <th className="px-4 py-2.5 font-medium w-36">Host / Location</th>
                <th className="px-4 py-2.5 font-medium w-28">Auth</th>
                <th
                  onClick={() => handleSort('confidence')}
                  className="px-4 py-2.5 font-medium cursor-pointer hover:text-text transition-colors w-28"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Confidence</span>
                    {renderSortIcon('confidence')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('lastSeen')}
                  className="px-4 py-2.5 font-medium cursor-pointer hover:text-text transition-colors w-32"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Last Seen</span>
                    {renderSortIcon('lastSeen')}
                  </div>
                </th>
                <th className="px-4 py-2.5 font-medium w-20">Stale</th>
                <th className="px-4 py-2.5 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {processedEntities.map((entity) => {
                const view = appEntityView(entity);
                const Icon = view.icon;
                const isSelected = selectedEntity?.id === entity.id;

                const hostOrLoc = (entity.meta?.host as string) || (entity.meta?.location as string) || (entity.meta?.category as string) || '-';

                return (
                  <tr
                    key={entity.id}
                    onClick={() => onSelectEntity(entity)}
                    className={`cursor-pointer transition-colors hover:bg-surface-2/60 ${
                      isSelected ? 'bg-surface-2 ring-1 ring-inset ring-accent' : ''
                    }`}
                  >
                    {/* Kind */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="text-[10px] uppercase font-semibold text-text-muted">
                          {view.kindLabel}
                        </span>
                      </div>
                    </td>

                    {/* Name */}
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-text truncate max-w-md" title={entity.name}>
                        {entity.name}
                      </div>
                      {view.subtitle && (
                        <div className="text-[10px] text-text-muted/70 truncate">{view.subtitle}</div>
                      )}
                    </td>

                    {/* Host / Location */}
                    <td className="px-4 py-2.5 text-text-muted text-[11px] truncate" title={hostOrLoc}>
                      {hostOrLoc}
                    </td>

                    {/* Auth Boundary */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {view.hasAuthBoundary ? (
                        <span className="flex items-center gap-1 text-[10px] text-accent font-medium">
                          <Shield className="w-3 h-3 text-accent" />
                          <span>Enforced</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-text-muted/50">None</span>
                      )}
                    </td>

                    {/* Confidence */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold border ${view.confidenceBadgeClass}`}>
                        {view.confidence}
                      </span>
                    </td>

                    {/* Last Seen */}
                    <td className="px-4 py-2.5 whitespace-nowrap text-text-muted text-[10px]">
                      {new Date(entity.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>

                    {/* Stale */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {view.isStale ? (
                        <span className="flex items-center gap-0.5 text-[9px] font-semibold text-warning">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>STALE</span>
                        </span>
                      ) : (
                        <span className="text-text-muted/40 text-[10px]">-</span>
                      )}
                    </td>

                    {/* Arrow CTA */}
                    <td className="px-4 py-2.5 text-right">
                      <ChevronRight className="w-3.5 h-3.5 text-text-muted/40 group-hover:text-text transition-colors" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
