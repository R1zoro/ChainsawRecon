import React, { useState, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  Node,
  Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  AlertCircle, 
  RotateCw, Layers, Inbox
} from 'lucide-react';
import { 
  AppEntity, 
  AppEdge, 
  SitemapResponse, 
  SitemapNode, 
  RecordCoveragePayload,
  NoteItem 
} from '../../../api/types';
import { SitemapTree } from './SitemapTree';
import { SitemapGraphNode } from './SitemapGraphNode';
import { EntityDetailDrawer } from './EntityDetailDrawer';

interface AppModelSitemapViewProps {
  sitemapData?: SitemapResponse | null;
  edges: AppEdge[];
  notes: NoteItem[];
  allEntities: AppEntity[];
  selectedEntity: AppEntity | null;
  onSelectEntity: (entity: AppEntity | null) => void;
  onAddNote: (entityId: string, content: string) => Promise<void>;
  onRecordCoverage: (entityId: string, payload: RecordCoveragePayload) => Promise<void>;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

const nodeTypes = {
  sitemapNode: SitemapGraphNode,
};

export const AppModelSitemapView: React.FC<AppModelSitemapViewProps> = ({
  sitemapData,
  edges,
  notes,
  allEntities,
  selectedEntity,
  onSelectEntity,
  onAddNote,
  onRecordCoverage,
  onRefresh,
  isRefreshing = false,
}) => {
  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [isOnlyUntested, setIsOnlyUntested] = useState(false);
  const [isOnlyGaps, setIsOnlyGaps] = useState(false);
  const [isStaleOnly, setIsStaleOnly] = useState(false);
  const [selectedKind, setSelectedKind] = useState('all');

  const roots = sitemapData?.roots || [];
  const stats = sitemapData?.stats || {
    applications: 0,
    services: 0,
    routes: 0,
    inputs: 0,
    inScope: 0,
    tested: 0,
    untested: 0,
    findings: 0,
    coverageEntries: 0,
    coverageGaps: 0,
  };

  // Determine focus root for the center graph. Default to selected entity or first root.
  const activeFocusEntityId = selectedEntity?.id || (roots.length > 0 ? roots[0].entity.id : null);

  // Collect subtree nodes starting from activeFocusEntityId
  const { subtreeNodes, isSubtreeTruncated, totalSubtreeCount } = useMemo(() => {
    if (!activeFocusEntityId || roots.length === 0) {
      return { subtreeNodes: [], isSubtreeTruncated: false, totalSubtreeCount: 0 };
    }

    // Helper to find node in tree
    const findSubtree = (nodeList: SitemapNode[], targetId: string): SitemapNode | null => {
      for (const n of nodeList) {
        if (n.entity.id === targetId) return n;
        const found = findSubtree(n.children, targetId);
        if (found) return found;
      }
      return null;
    };

    let focusSubtree = findSubtree(roots, activeFocusEntityId);
    if (!focusSubtree) {
      focusSubtree = roots[0];
    }

    const collected: SitemapNode['entity'][] = [];
    const traverse = (n: SitemapNode) => {
      collected.push(n.entity);
      n.children.forEach(traverse);
    };
    traverse(focusSubtree);

    const MAX_VISIBLE_GRAPH_NODES = 180;
    const truncated = collected.length > MAX_VISIBLE_GRAPH_NODES;
    const visible = truncated ? collected.slice(0, MAX_VISIBLE_GRAPH_NODES) : collected;

    return {
      subtreeNodes: visible,
      isSubtreeTruncated: truncated,
      totalSubtreeCount: collected.length,
    };
  }, [roots, activeFocusEntityId]);

  // Compute Layered Left-to-Right Coordinates for Subtree Nodes
  const layoutedNodes: Node[] = useMemo(() => {
    const tierMap: Record<string, number> = {
      application: 0,
      service: 1,
      route: 2,
      input: 3,
    };

    const columns: Record<number, SitemapNode['entity'][]> = { 0: [], 1: [], 2: [], 3: [] };
    subtreeNodes.forEach((entity) => {
      const tier = tierMap[entity.kind] ?? 2;
      columns[tier].push(entity);
    });

    const xSpacing = 320;
    const ySpacing = 130;

    const nodes: Node[] = [];
    Object.entries(columns).forEach(([tierStr, items]) => {
      const tier = parseInt(tierStr, 10);
      const startX = 60 + tier * xSpacing;

      items.forEach((entity, index) => {
        const startY = 80 + index * ySpacing;
        nodes.push({
          id: entity.id,
          type: 'sitemapNode',
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
  }, [subtreeNodes, selectedEntity]);

  // Generate Edges for the Subtree
  const reactFlowEdges: Edge[] = useMemo(() => {
    const visibleIds = new Set(subtreeNodes.map((n) => n.id));
    const resultEdges: Edge[] = [];

    edges.forEach((edg) => {
      if (visibleIds.has(edg.sourceId) && visibleIds.has(edg.targetId)) {
        const isTrustBoundary = edg.trustBoundary;
        const isEvidenceLink = edg.relation === 'proves' || edg.relation === 'evidence' || edg.relation === 'finding';

        // 3 semantic edge styles:
        // - solid gray: containment
        // - dashed amber: trust boundary
        // - dotted blue: evidence / finding link
        const strokeColor = isEvidenceLink
          ? '#38BDF8'
          : isTrustBoundary
          ? '#F59E0B'
          : '#3B4252';

        const strokeDasharray = isEvidenceLink
          ? '2,2'
          : isTrustBoundary
          ? '5,5'
          : undefined;

        resultEdges.push({
          id: edg.id,
          source: edg.sourceId,
          target: edg.targetId,
          label: edg.relation,
          style: {
            stroke: strokeColor,
            strokeWidth: isTrustBoundary ? 2 : 1.5,
            strokeDasharray,
          },
          labelStyle: {
            fill: '#8B949E',
            fontSize: 10,
            fontFamily: 'monospace',
          },
          labelBgStyle: {
            fill: '#161B22',
            fillOpacity: 0.85,
          },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
        });
      }
    });

    return resultEdges;
  }, [subtreeNodes, edges]);

  // Handle Graph Node Click
  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    const found = allEntities.find((e) => e.id === node.id) || 
                  subtreeNodes.find((n) => n.id === node.id);
    if (found) {
      onSelectEntity(found);
    }
  };

  // If entire sitemap has zero roots, render honest empty state
  if (roots.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-bg select-none space-y-3 font-sans">
        <div className="p-3 rounded-full bg-surface text-text-muted border border-border">
          <Inbox className="w-8 h-8 opacity-60 text-accent" />
        </div>
        <div className="space-y-1 max-w-md">
          <h2 className="text-base font-semibold text-text">No sitemap data discovered yet</h2>
          <p className="text-xs text-text-muted leading-relaxed">
            The application model does not yet contain a hierarchical map of applications, services, routes, or inputs. Run a discovery scan or import web traffic to populate the sitemap.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg text-text font-sans overflow-hidden select-none">
      {/* 1. Top Coverage Ribbon */}
      <div className="h-10 px-6 border-b border-border bg-surface/80 flex items-center justify-between gap-4 text-xs shrink-0 font-mono">
        <div className="flex items-center gap-4 text-[11px] overflow-x-auto">
          <div className="flex items-center gap-1.5 text-text-muted">
            <span className="uppercase text-[10px] tracking-wider">In scope:</span>
            <span className="text-text font-bold">{stats.inScope}</span>
          </div>

          <span className="text-border">·</span>

          <button
            onClick={() => setIsOnlyUntested(false)}
            className="flex items-center gap-1.5 text-text-muted hover:text-text transition-colors"
            title="Total attack surfaces tested"
          >
            <span className="uppercase text-[10px] tracking-wider text-success">Tested:</span>
            <span className="text-success font-bold">{stats.tested}</span>
          </button>

          <span className="text-border">·</span>

          <button
            onClick={() => setIsOnlyUntested(!isOnlyUntested)}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${
              isOnlyUntested ? 'bg-accent/20 text-accent font-bold' : 'text-text-muted hover:text-text'
            }`}
            title="Click to toggle only untested surfaces"
          >
            <span className="uppercase text-[10px] tracking-wider">Untested:</span>
            <span className="font-bold text-text">{stats.untested}</span>
          </button>

          <span className="text-border">·</span>

          <div className="flex items-center gap-1.5 text-text-muted">
            <span className="uppercase text-[10px] tracking-wider text-danger">Findings:</span>
            <span className="text-danger font-bold">{stats.findings}</span>
          </div>

          <span className="text-border">·</span>

          <button
            onClick={() => setIsOnlyGaps(!isOnlyGaps)}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${
              isOnlyGaps ? 'bg-warning/20 text-warning font-bold' : 'text-text-muted hover:text-text'
            }`}
            title="Click to toggle surfaces with verification gaps"
          >
            <span className="uppercase text-[10px] tracking-wider text-warning">Gaps:</span>
            <span className="text-warning font-bold">{stats.coverageGaps}</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Truncated Subtree Banner */}
          {isSubtreeTruncated && (
            <div className="flex items-center gap-1 text-[11px] text-warning bg-warning/10 px-2 py-0.5 rounded border border-warning/30">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Showing first {subtreeNodes.length} of {totalSubtreeCount} nodes</span>
            </div>
          )}

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors disabled:opacity-40"
              title="Refresh sitemap and coverage ledger"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-accent' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Main 3-Pane Body: Left Tree + Center Focus Graph + Right Inspector Drawer */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Left Pane: Hierarchical Tree */}
        <SitemapTree
          roots={roots}
          selectedEntityId={selectedEntity?.id || null}
          onSelectEntity={onSelectEntity}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isOnlyUntested={isOnlyUntested}
          onToggleOnlyUntested={() => setIsOnlyUntested(!isOnlyUntested)}
          isOnlyGaps={isOnlyGaps}
          onToggleOnlyGaps={() => setIsOnlyGaps(!isOnlyGaps)}
          isStaleOnly={isStaleOnly}
          onToggleStaleOnly={() => setIsStaleOnly(!isStaleOnly)}
          selectedKind={selectedKind}
          onSelectKind={setSelectedKind}
        />

        {/* Center Pane: Subtree Focus Graph */}
        <div data-testid="sitemap-graph" className="flex-1 h-full min-h-0 relative bg-[#0A0D12]">
          <ReactFlow
            nodes={layoutedNodes}
            edges={reactFlowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            fitView
            minZoom={0.2}
            maxZoom={2.0}
            defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#161B22" gap={24} size={1.5} variant={BackgroundVariant.Dots} />
            <Controls className="!bg-surface !border-border !fill-text !rounded-lg !shadow-xl" />
            <MiniMap
              className="!bg-surface !border-border !rounded-lg !shadow-xl !m-4"
              nodeStrokeWidth={2}
              nodeColor={(n) => (n.id === selectedEntity?.id ? '#58A6FF' : '#30363D')}
              maskColor="rgba(10, 13, 18, 0.75)"
            />
          </ReactFlow>

          {/* Subtree Focus Header Breadcrumb */}
          <div className="absolute top-3 left-4 z-10 bg-surface/90 backdrop-blur-sm border border-border px-3 py-1.5 rounded-lg shadow-lg font-mono text-xs flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-accent" />
            <span className="text-text-muted">Subtree focus:</span>
            <span className="font-semibold text-text truncate max-w-xs">
              {selectedEntity?.name || roots[0]?.entity.name}
            </span>
          </div>
        </div>

        {/* Right Pane: Inspector Drawer */}
        {selectedEntity && (
          <EntityDetailDrawer
            entity={selectedEntity}
            edges={edges}
            notes={notes}
            allEntities={allEntities}
            coverageData={sitemapData?.coverage || null}
            onClose={() => onSelectEntity(null)}
            onSelectEntity={onSelectEntity}
            onAddNote={onAddNote}
            onRecordCoverage={onRecordCoverage}
          />
        )}
      </div>
    </div>
  );
};
