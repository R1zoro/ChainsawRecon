import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Shield, AlertTriangle, FolderKanban, Server, Globe, CornerDownRight, Layers } from 'lucide-react';
import { AppEntity } from '../../../api/types';

export interface SitemapNodeEntity extends AppEntity {
  coverage?: {
    tested: boolean;
    outcomes: Record<string, number>;
    lastTestedAt: string | null;
  };
  findingCount?: number;
}

export interface SitemapGraphNodeData {
  entity: SitemapNodeEntity;
  isSelected?: boolean;
}

export const SitemapGraphNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as SitemapGraphNodeData;
  const entity = nodeData?.entity;

  if (!entity) return null;

  const isNodeSelected = selected || nodeData.isSelected;
  const findingCount = entity.findingCount || 0;
  const isTested = entity.coverage?.tested;
  const outcomes = entity.coverage?.outcomes || {};

  // Monochrome kind icons
  const kindIcons: Record<string, React.FC<{ className?: string }>> = {
    application: FolderKanban,
    service: Server,
    route: Globe,
    input: CornerDownRight,
  };
  const KindIcon = kindIcons[entity.kind] || Layers;

  // Method badge for routes
  const method = entity.meta?.method ? String(entity.meta.method).toUpperCase() : '';
  const path = entity.meta?.path ? String(entity.meta.path) : entity.name;

  return (
    <div
      className={`group relative w-[240px] p-3 rounded-xl border transition-all select-none shadow-lg cursor-pointer font-sans ${
        isNodeSelected
          ? 'bg-surface-2 border-accent ring-1 ring-accent shadow-accent/15'
          : entity.stale
          ? 'bg-surface border-warning/50 hover:border-warning'
          : findingCount > 0
          ? 'bg-surface border-danger/40 hover:border-danger'
          : 'bg-surface border-border hover:border-border-hover'
      }`}
    >
      {/* React Flow Handles for Layered Left-to-Right */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-border group-hover:!bg-accent !border-2 !border-bg !rounded-full transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-border group-hover:!bg-accent !border-2 !border-bg !rounded-full transition-colors"
      />

      {/* Header: Kind Icon (Monochrome), Kind Label, Finding Badge or Coverage Dot */}
      <div className="flex items-center justify-between gap-1.5 mb-1.5 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="p-1 rounded bg-bg border border-border text-text-muted shrink-0">
            <KindIcon className="w-3 h-3 text-text-muted" />
          </div>
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted truncate">
            {entity.kind}
          </span>
        </div>

        {/* Coverage state dot or Finding badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {findingCount > 0 ? (
            <span 
              className="px-1.5 py-0.2 rounded-full bg-danger text-white text-[9px] font-bold font-mono shadow-sm"
              title={`${findingCount} finding${findingCount === 1 ? '' : 's'} identified`}
            >
              {findingCount}
            </span>
          ) : outcomes.needs_follow_up ? (
            <span 
              className="w-2.5 h-2.5 rounded-full bg-warning shadow-sm"
              title="Needs follow-up verification"
            />
          ) : isTested ? (
            <span 
              className="w-2.5 h-2.5 rounded-full bg-success/80 shadow-sm"
              title="Tested clean"
            />
          ) : (
            <span 
              className="w-2.5 h-2.5 rounded-full bg-border border border-border-hover"
              title="Untested"
            />
          )}

          {/* Confidence Pill */}
          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase font-semibold border border-border bg-bg/80 text-text-muted">
            {entity.confidence}
          </span>
        </div>
      </div>

      {/* Main Title / Method + Path */}
      <div className="font-mono text-xs font-semibold text-text truncate mb-1" title={path}>
        {method ? (
          <span className="flex items-center gap-1.5 truncate">
            <span className="text-accent text-[10px] font-bold">{method}</span>
            <span className="truncate">{path}</span>
          </span>
        ) : (
          entity.name
        )}
      </div>

      {/* Bottom Badges: Stale, Auth Boundary, Coverage State */}
      <div className="flex flex-wrap items-center gap-1 pt-1.5 border-t border-border/40 text-[10px] font-mono">
        {entity.stale && (
          <span className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-warning/20 text-warning border border-warning/40 font-semibold">
            <AlertTriangle className="w-2.5 h-2.5" />
            <span>STALE</span>
          </span>
        )}

        {Boolean(entity.meta?.authBoundary) && (
          <span className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-accent/15 text-accent border border-accent/30 font-medium">
            <Shield className="w-2.5 h-2.5" />
            <span>AUTH</span>
          </span>
        )}

        {isTested ? (
          <span className="text-[9px] text-success/90 font-mono">
            {Object.keys(outcomes).length > 0
              ? Object.entries(outcomes).map(([k, v]) => `${k.replace('_', ' ')} (${v})`).join(', ')
              : 'tested'}
          </span>
        ) : (
          <span className="text-[9px] text-text-muted/60 font-mono italic">
            untested
          </span>
        )}
      </div>
    </div>
  );
});
