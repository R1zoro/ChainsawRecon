import React, { useState, useEffect, useMemo } from 'react';
import { 
  ChevronDown, ChevronRight, Search, Shield, 
  Server, Globe, FolderKanban, CornerDownRight
} from 'lucide-react';
import { AppEntity, SitemapNode } from '../../../api/types';

interface SitemapTreeProps {
  roots: SitemapNode[];
  selectedEntityId: string | null;
  onSelectEntity: (entity: AppEntity) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isOnlyUntested: boolean;
  onToggleOnlyUntested: () => void;
  isOnlyGaps: boolean;
  onToggleOnlyGaps: () => void;
  isStaleOnly: boolean;
  onToggleStaleOnly: () => void;
  selectedKind: string;
  onSelectKind: (k: string) => void;
}

export const SitemapTree: React.FC<SitemapTreeProps> = ({
  roots,
  selectedEntityId,
  onSelectEntity,
  searchQuery,
  onSearchChange,
  isOnlyUntested,
  onToggleOnlyUntested,
  isOnlyGaps,
  onToggleOnlyGaps,
  isStaleOnly,
  onToggleStaleOnly,
  selectedKind,
  onSelectKind,
}) => {
  // Track expanded state per node ID. Default roots to expanded.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    roots.forEach((r) => {
      initial.add(r.entity.id);
      r.children.forEach((c) => initial.add(c.entity.id));
    });
    return initial;
  });

  // Automatically expand roots and services when data loads
  useEffect(() => {
    if (roots.length > 0) {
      setExpandedIds((prev) => {
        if (prev.size > 0) return prev;
        const initial = new Set<string>();
        roots.forEach((r) => {
          initial.add(r.entity.id);
          r.children.forEach((c) => {
            initial.add(c.entity.id);
          });
        });
        return initial;
      });
    }
  }, [roots]);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Helper to check if a node has coverage gaps
  const nodeHasGaps = (node: SitemapNode): boolean => {
    const entries = node.entity.coverage?.entries || [];
    return entries.some(
      (e) =>
        e.outcome === 'needs_follow_up' ||
        (e.outcome === 'no_issue_found' && !e.evidenceId) ||
        (['ruled_out', 'not_applicable'].includes(e.outcome) && !e.reason)
    );
  };

  // Recursive filter predicate
  const filterNode = (node: SitemapNode): SitemapNode | null => {
    const entity = node.entity;

    // Check direct match
    let directMatch = true;

    if (isOnlyUntested && entity.coverage?.tested) {
      directMatch = false;
    }

    if (isOnlyGaps && !nodeHasGaps(node)) {
      directMatch = false;
    }

    if (isStaleOnly && !entity.stale) {
      directMatch = false;
    }

    if (selectedKind !== 'all' && entity.kind !== selectedKind) {
      directMatch = false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = entity.name.toLowerCase().includes(q);
      const matchMeta = JSON.stringify(entity.meta || {}).toLowerCase().includes(q);
      const matchTags = entity.tags.some((t) => t.toLowerCase().includes(q));
      if (!matchName && !matchMeta && !matchTags) {
        directMatch = false;
      }
    }

    // Filter children
    const filteredChildren = node.children
      .map((c) => filterNode(c))
      .filter((c): c is SitemapNode => c !== null);

    // Keep node if it directly matches or if any of its children match
    if (directMatch || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      };
    }

    return null;
  };

  const filteredRoots = useMemo(() => {
    return roots
      .map((r) => filterNode(r))
      .filter((r): r is SitemapNode => r !== null);
  }, [roots, searchQuery, isOnlyUntested, isOnlyGaps, isStaleOnly, selectedKind]);

  // Render method badge for routes
  const renderMethodBadge = (entity: AppEntity) => {
    const method = entity.meta?.method ? String(entity.meta.method).toUpperCase() : '';
    if (!method) return null;

    let badgeClass = 'text-accent border-accent/30 bg-accent/10';
    if (method === 'POST') badgeClass = 'text-success border-success/30 bg-success/10';
    if (method === 'DELETE') badgeClass = 'text-danger border-danger/30 bg-danger/10';
    if (method === 'PUT' || method === 'PATCH') badgeClass = 'text-warning border-warning/30 bg-warning/10';

    return (
      <span className={`px-1 py-0.2 rounded text-[9px] font-bold font-mono border uppercase tracking-wider shrink-0 ${badgeClass}`}>
        {method}
      </span>
    );
  };

  // Render coverage dot / status badge
  const renderCoverageIndicator = (node: SitemapNode) => {
    const entity = node.entity;
    const findingCount = entity.findingCount || 0;
    const isTested = entity.coverage?.tested;
    const hasGaps = nodeHasGaps(node);
    const outcomes = entity.coverage?.outcomes || {};

    if (findingCount > 0) {
      return (
        <span 
          className="px-1.5 py-0.2 rounded-full bg-danger text-white text-[9px] font-bold font-mono shrink-0 shadow-sm"
          title={`${findingCount} security finding${findingCount === 1 ? '' : 's'} identified`}
        >
          {findingCount}
        </span>
      );
    }

    if (hasGaps || outcomes.needs_follow_up) {
      return (
        <span 
          className="w-2 h-2 rounded-full bg-warning shrink-0 shadow-sm"
          title="Coverage gap: requires verification or evidence"
        />
      );
    }

    if (isTested) {
      return (
        <span 
          className="w-2 h-2 rounded-full bg-success/80 shrink-0 shadow-sm"
          title="Tested clean (no issues found)"
        />
      );
    }

    // Untested
    return (
      <span 
        className="w-2 h-2 rounded-full bg-border border border-border-hover shrink-0"
        title="Untested attack surface"
      />
    );
  };

  const renderTreeItem = (node: SitemapNode, depth: number) => {
    const entity = node.entity;
    const isExpanded = expandedIds.has(entity.id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedEntityId === entity.id;

    const kindIcons: Record<string, React.FC<{ className?: string }>> = {
      application: FolderKanban,
      service: Server,
      route: Globe,
      input: CornerDownRight,
    };
    const KindIcon = kindIcons[entity.kind] || Globe;

    return (
      <div key={entity.id} className="select-none font-mono text-xs">
        <div
          onClick={() => onSelectEntity(entity)}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={`flex items-center gap-2 py-1.5 pr-2.5 rounded-md cursor-pointer transition-colors group relative ${
            isSelected
              ? 'bg-accent/15 text-accent border-l-2 border-accent'
              : 'hover:bg-surface-2 text-text-muted hover:text-text'
          }`}
        >
          {/* Chevron expand/collapse toggle */}
          {hasChildren ? (
            <button
              onClick={(e) => toggleExpand(entity.id, e)}
              className="p-0.5 rounded hover:bg-surface text-text-muted hover:text-text shrink-0"
              aria-label={isExpanded ? 'Collapse node' : 'Expand node'}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4 h-4 shrink-0" />
          )}

          {/* Coverage Dot / Finding Badge */}
          {renderCoverageIndicator(node)}

          {/* Method badge (for routes) or Kind Icon */}
          {entity.kind === 'route' ? (
            renderMethodBadge(entity)
          ) : (
            <KindIcon className="w-3.5 h-3.5 opacity-60 shrink-0" />
          )}

          {/* Label / Path / Name */}
          <span 
            className="truncate font-mono text-xs text-text flex-1"
            title={entity.meta?.path ? String(entity.meta.path) : entity.name}
          >
            {entity.kind === 'route' && entity.meta?.path
              ? String(entity.meta.path)
              : entity.name}
          </span>

          {/* Stale Marker */}
          {entity.stale && (
            <span 
              className="text-warning text-[9px] font-bold px-1 rounded bg-warning/15 border border-warning/30 shrink-0"
              title="Stale asset (>30 days since last seen)"
            >
              stale
            </span>
          )}

          {/* Auth Boundary Shield */}
          {Boolean(entity.meta?.authBoundary) && (
            <span title="Authentication boundary">
              <Shield className="w-3 h-3 text-accent shrink-0" />
            </span>
          )}
        </div>

        {/* Children Subtree */}
        {hasChildren && isExpanded && (
          <div className="space-y-0.5">
            {node.children.map((child) => renderTreeItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="sitemap-tree" className="w-72 md:w-80 border-r border-border bg-surface flex flex-col shrink-0 h-full font-sans select-none overflow-hidden text-xs">
      {/* 1. Tree Search Input */}
      <div className="p-3 border-b border-border bg-bg/50 shrink-0 space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search hierarchy..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface border border-border text-xs text-text font-mono placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px] font-mono">
          <button
            onClick={onToggleOnlyUntested}
            className={`px-2 py-0.5 rounded border transition-colors ${
              isOnlyUntested
                ? 'bg-accent/15 border-accent text-accent font-semibold'
                : 'bg-surface-2 border-border text-text-muted hover:text-text'
            }`}
          >
            Only untested
          </button>

          <button
            onClick={onToggleOnlyGaps}
            className={`px-2 py-0.5 rounded border transition-colors ${
              isOnlyGaps
                ? 'bg-warning/20 border-warning text-warning font-semibold'
                : 'bg-surface-2 border-border text-text-muted hover:text-text'
            }`}
          >
            Only gaps
          </button>

          <button
            onClick={onToggleStaleOnly}
            className={`px-2 py-0.5 rounded border transition-colors ${
              isStaleOnly
                ? 'bg-warning/20 border-warning text-warning font-semibold'
                : 'bg-surface-2 border-border text-text-muted hover:text-text'
            }`}
          >
            Stale
          </button>

          <select
            value={selectedKind}
            onChange={(e) => onSelectKind(e.target.value)}
            className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-[10px] text-text-muted focus:outline-none focus:border-accent"
          >
            <option value="all">All kinds</option>
            <option value="application">App</option>
            <option value="service">Service</option>
            <option value="route">Route</option>
            <option value="input">Input</option>
          </select>
        </div>
      </div>

      {/* 2. Scrollable Tree List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {filteredRoots.length === 0 ? (
          <div className="p-6 text-center text-text-muted space-y-2">
            <p className="text-xs">No assets match the active tree filters.</p>
          </div>
        ) : (
          filteredRoots.map((root) => renderTreeItem(root, 0))
        )}
      </div>
    </div>
  );
};
