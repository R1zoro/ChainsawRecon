import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  Filter, Search, AlertCircle, 
  Shield, AlertTriangle 
} from 'lucide-react';
import { AppEntity, AppEdge, AppEntityKind } from '../../../api/types';
import { AppEntityNode } from './AppEntityNode';

interface AppModelGraphViewProps {
  entities: AppEntity[];
  edges: AppEdge[];
  truncated: boolean;
  totalEntities: number;
  selectedEntity: AppEntity | null;
  onSelectEntity: (entity: AppEntity) => void;
  onFocusNeighbors?: (entityId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedKind: string;
  onSelectKind: (kind: string) => void;
  selectedConfidence: string;
  onSelectConfidence: (confidence: string) => void;
  isStaleOnly: boolean;
  onToggleStaleOnly: () => void;
  isAuthBoundaryOnly: boolean;
  onToggleAuthBoundaryOnly: () => void;
  maxNodes: number;
  onChangeMaxNodes: (max: number) => void;
}

const nodeTypes = {
  appEntity: AppEntityNode,
};

export const AppModelGraphView: React.FC<AppModelGraphViewProps> = ({
  entities,
  edges,
  truncated,
  totalEntities,
  selectedEntity,
  onSelectEntity,
  onFocusNeighbors,
  searchQuery,
  onSearchChange,
  selectedKind,
  onSelectKind,
  selectedConfidence,
  onSelectConfidence,
  isStaleOnly,
  onToggleStaleOnly,
  isAuthBoundaryOnly,
  onToggleAuthBoundaryOnly,
  maxNodes,
  onChangeMaxNodes,
}) => {
  // 1. Filter entities locally based on controls
  const filteredEntities = useMemo(() => {
    return entities.filter((entity) => {
      // Kind filter
      if (selectedKind !== 'all' && entity.kind !== selectedKind) {
        return false;
      }
      // Confidence filter
      if (selectedConfidence !== 'all' && entity.confidence !== selectedConfidence) {
        return false;
      }
      // Stale only filter
      if (isStaleOnly && !entity.stale) {
        return false;
      }
      // Auth boundary only filter
      if (isAuthBoundaryOnly && !entity.meta?.authBoundary) {
        return false;
      }
      // Search text
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
  }, [entities, selectedKind, selectedConfidence, isStaleOnly, isAuthBoundaryOnly, searchQuery]);

  const filteredEntityIds = useMemo(() => {
    return new Set(filteredEntities.map((e) => e.id));
  }, [filteredEntities]);

  // 2. Filter edges matching visible nodes
  const filteredEdges = useMemo(() => {
    return edges.filter(
      (edg) => filteredEntityIds.has(edg.sourceId) && filteredEntityIds.has(edg.targetId)
    );
  }, [edges, filteredEntityIds]);

  // 3. Compute layered hierarchical coordinates (left-to-right)
  const layoutedNodes: Node[] = useMemo(() => {
    const tierMap: Record<AppEntityKind, number> = {
      application: 0,
      technology: 0,
      service: 1,
      route: 2,
      input: 3,
      identity: 2,
      finding: 3,
      flow: 1,
      entity: 2,
    };

    // Group entities by tier column
    const columns: Record<number, AppEntity[]> = { 0: [], 1: [], 2: [], 3: [] };
    filteredEntities.forEach((entity) => {
      const tier = tierMap[entity.kind] ?? 2;
      columns[tier].push(entity);
    });

    const xSpacing = 360;
    const ySpacing = 140;

    const nodes: Node[] = [];
    Object.entries(columns).forEach(([tierStr, items]) => {
      const tier = parseInt(tierStr, 10);
      const startX = 60 + tier * xSpacing;

      items.forEach((entity, index) => {
        const startY = 80 + index * ySpacing;
        nodes.push({
          id: entity.id,
          type: 'appEntity',
          position: { x: startX, y: startY },
          data: {
            entity,
            isSelected: selectedEntity?.id === entity.id,
          },
          selected: selectedEntity?.id === entity.id,
        });
      });
    });

    return nodes;
  }, [filteredEntities, selectedEntity]);

  // 4. Map edges for React Flow
  const reactFlowEdges: Edge[] = useMemo(() => {
    return filteredEdges.map((edg) => {
      const isTrustBoundary = edg.trustBoundary;
      return {
        id: edg.id,
        source: edg.sourceId,
        target: edg.targetId,
        label: edg.relation,
        animated: isTrustBoundary,
        style: {
          stroke: isTrustBoundary ? '#F59E0B' : '#2A3441',
          strokeWidth: isTrustBoundary ? 2 : 1.5,
          strokeDasharray: isTrustBoundary ? '4,4' : undefined,
        },
        labelStyle: {
          fill: '#8B949E',
          fontSize: 10,
          fontFamily: 'monospace',
        },
        labelBgStyle: {
          fill: '#0D1015',
          fillOpacity: 0.85,
          rx: 4,
          ry: 4,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isTrustBoundary ? '#F59E0B' : '#2A3441',
          width: 14,
          height: 14,
        },
      };
    });
  }, [filteredEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [currentEdges, setEdges, onEdgesChange] = useEdgesState(reactFlowEdges);

  // Sync state when layout recalculates
  React.useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(reactFlowEdges);
  }, [layoutedNodes, reactFlowEdges, setNodes, setEdges]);

  // Node Click
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const entity = filteredEntities.find((e) => e.id === node.id);
      if (entity) {
        onSelectEntity(entity);
      }
    },
    [filteredEntities, onSelectEntity]
  );

  // Node Double Click (Focus Neighbors)
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onFocusNeighbors) {
        onFocusNeighbors(node.id);
      }
    },
    [onFocusNeighbors]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg relative overflow-hidden font-sans">
      {/* 1. Filter Bar & Controls Toolbar */}
      <div className="border-b border-border bg-surface/80 backdrop-blur px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 z-10 text-xs">
        {/* Left: Search & Kind Filters */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Search Input */}
          <div className="relative w-52 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-text-muted/60" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search graph..."
              className="w-full pl-8 pr-3 py-1 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Kind Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto text-[11px] font-mono">
            {[
              { id: 'all', label: 'All' },
              { id: 'application', label: 'Apps' },
              { id: 'service', label: 'Services' },
              { id: 'route', label: 'Routes' },
              { id: 'input', label: 'Inputs' },
              { id: 'identity', label: 'Identities' },
              { id: 'technology', label: 'Tech' },
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

        {/* Right: Confidence, Stale, Auth Boundary & Max Nodes Cap */}
        <div className="flex items-center gap-2.5 shrink-0 text-[11px] font-mono">
          {/* Confidence Filter */}
          <select
            value={selectedConfidence}
            onChange={(e) => onSelectConfidence(e.target.value)}
            className="px-2 py-1 bg-bg border border-border rounded text-text font-mono text-xs focus:outline-none focus:border-accent"
            title="Filter by observation confidence"
          >
            <option value="all">Confidence: All</option>
            <option value="confirmed">Confirmed</option>
            <option value="observed">Observed</option>
            <option value="tentative">Tentative</option>
          </select>

          {/* Stale Toggle */}
          <button
            onClick={onToggleStaleOnly}
            className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
              isStaleOnly
                ? 'bg-warning/20 text-warning border-warning/50 font-semibold'
                : 'bg-bg text-text-muted border-border hover:text-text'
            }`}
            title="Filter to stale assets only"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Stale</span>
          </button>

          {/* Auth Boundary Toggle */}
          <button
            onClick={onToggleAuthBoundaryOnly}
            className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
              isAuthBoundaryOnly
                ? 'bg-accent/20 text-accent border-accent/50 font-semibold'
                : 'bg-bg text-text-muted border-border hover:text-text'
            }`}
            title="Filter to auth boundary entities only"
          >
            <Shield className="w-3 h-3" />
            <span>Auth</span>
          </button>

          {/* Max Nodes Cap Selector */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-border text-text-muted">
            <span>Cap:</span>
            <select
              value={maxNodes}
              onChange={(e) => onChangeMaxNodes(parseInt(e.target.value, 10))}
              className="bg-bg border border-border rounded px-1.5 py-0.5 text-text focus:outline-none focus:border-accent"
              title="Maximum nodes to render simultaneously"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={300}>300</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. Truncation Warning Banner (if graph is capped) */}
      {truncated && (
        <div className="bg-warning/15 border-b border-warning/30 px-6 py-1.5 flex items-center justify-between text-xs font-mono text-warning z-10 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Capped graph: showing first {entities.length} of {totalEntities} nodes from server
              {layoutedNodes.length !== entities.length && ` (${layoutedNodes.length} visible with active filters)`}.
            </span>
          </div>
          <span className="text-[10px] text-warning/80">
            Double-click any node to focus on its local neighborhood.
          </span>
        </div>
      )}

      {/* 3. React Flow Canvas */}
      <div className="flex-1 w-full h-full relative bg-[#0A0D12]">
        {layoutedNodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-text-muted space-y-2 z-10">
            <Filter className="w-8 h-8 opacity-40 text-text-muted" />
            <p className="text-sm font-medium text-text">No topology nodes matching current filters.</p>
            <p className="text-xs text-text-muted/80 max-w-sm">
              Adjust your search keywords, clear the stale/auth filter, or select "All" kinds.
            </p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={currentEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            fitView
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            className="chainsaw-react-flow select-none"
          >
            <Background color="#1C2430" gap={20} size={1} variant={BackgroundVariant.Dots} />
            <Controls className="!bg-surface !border-border !rounded-lg !shadow-xl [&>button]:!border-border [&>button]:!text-text-muted hover:[&>button]:!text-text" />
            <MiniMap
              nodeColor={(n) => (n.id === selectedEntity?.id ? '#53A8D9' : '#222A35')}
              maskColor="rgba(10, 13, 18, 0.75)"
              className="!bg-surface !border !border-border !rounded-lg overflow-hidden shadow-2xl"
              style={{ width: 140, height: 90 }}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
};
