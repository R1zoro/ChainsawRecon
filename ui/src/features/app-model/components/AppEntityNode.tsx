import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Shield, AlertTriangle } from 'lucide-react';
import { AppEntity } from '../../../api/types';
import { appEntityView } from '../appEntityView';

export interface AppEntityNodeData {
  entity: AppEntity;
  isSelected?: boolean;
}

export const AppEntityNode = memo(({ data, selected }: NodeProps) => {
  const entityData = data as unknown as AppEntityNodeData;
  const entity = entityData?.entity;

  if (!entity) return null;

  const view = appEntityView(entity);
  const Icon = view.icon;
  const isNodeSelected = selected || entityData.isSelected;

  return (
    <div
      className={`group relative min-w-[220px] max-w-[280px] p-3 rounded-xl border transition-all select-none shadow-lg cursor-pointer ${
        isNodeSelected
          ? 'bg-surface-2 border-accent ring-1 ring-accent shadow-accent/10'
          : view.isStale
          ? 'bg-surface border-warning/50 hover:border-warning'
          : entity.kind === 'application'
          ? 'bg-surface-2 border-accent/40 hover:border-accent'
          : 'bg-surface border-border hover:border-border-hover'
      }`}
    >
      {/* React Flow Handles */}
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

      {/* Header: Icon, Kind Label, Confidence Badge */}
      <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="p-1 rounded bg-bg/80 border border-border/80 text-accent shrink-0">
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted truncate">
            {view.kindLabel}
          </span>
        </div>

        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-semibold border ${view.confidenceBadgeClass}`}
        >
          {view.confidence}
        </span>
      </div>

      {/* Main Title / Name */}
      <div className="font-mono text-xs font-medium text-text truncate mb-1" title={entity.name}>
        {entity.name}
      </div>

      {/* Subtitle / Path / Host */}
      {view.subtitle && (
        <div className="text-[11px] font-mono text-text-muted/80 truncate mb-2">
          {view.subtitle}
        </div>
      )}

      {/* Bottom Badges: Stale, Auth Boundary, Tags */}
      <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-border/40 text-[10px] font-mono">
        {view.isStale && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/20 text-warning border border-warning/40 font-semibold">
            <AlertTriangle className="w-2.5 h-2.5" />
            <span>STALE</span>
          </span>
        )}

        {view.hasAuthBoundary && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 font-medium">
            <Shield className="w-2.5 h-2.5" />
            <span>AUTH</span>
          </span>
        )}

        {entity.tags.slice(0, 2).map((tag, idx) => (
          <span
            key={idx}
            className="px-1.5 py-0.5 rounded bg-bg text-text-muted border border-border text-[9px]"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
});

AppEntityNode.displayName = 'AppEntityNode';
