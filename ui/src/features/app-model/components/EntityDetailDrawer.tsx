import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, Copy, Check, Plus, MessageSquare, ArrowRight, 
  ArrowLeft, Network, FlaskConical, Wrench, ExternalLink 
} from 'lucide-react';
import { AppEntity, AppEdge, NoteItem } from '../../../api/types';
import { appEntityView } from '../appEntityView';

interface EntityDetailDrawerProps {
  entity: AppEntity | null;
  edges: AppEdge[];
  notes: NoteItem[];
  allEntities: AppEntity[];
  onClose: () => void;
  onSelectEntity: (entity: AppEntity) => void;
  onFilterGraphToNeighbors?: (entityId: string) => void;
  onAddNote: (entityId: string, content: string) => Promise<void>;
}

export const EntityDetailDrawer: React.FC<EntityDetailDrawerProps> = ({
  entity,
  edges,
  notes,
  allEntities,
  onClose,
  onSelectEntity,
  onFilterGraphToNeighbors,
  onAddNote,
}) => {
  const navigate = useNavigate();
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  if (!entity) return null;

  const view = appEntityView(entity);
  const Icon = view.icon;

  const handleCopyId = () => {
    navigator.clipboard.writeText(entity.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(entity, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() || isSubmittingNote) return;

    setIsSubmittingNote(true);
    try {
      await onAddNote(entity.id, newNoteContent.trim());
      setNewNoteContent('');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // Incoming and outgoing edges for this entity
  const incomingEdges = edges.filter((edg) => edg.targetId === entity.id);
  const outgoingEdges = edges.filter((edg) => edg.sourceId === entity.id);

  const getEntityById = (id: string) => allEntities.find((e) => e.id === id);

  return (
    <aside className="w-96 border-l border-border bg-surface flex flex-col shrink-0 h-full font-sans select-none overflow-hidden shadow-2xl z-20">
      {/* 1. Header with Close Button */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 bg-surface/90 shrink-0">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-bg border border-border text-accent shrink-0 mt-0.5">
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted">
                {view.kindLabel}
              </span>
              <span className="text-[10px] font-mono text-text-muted/60">rev.{entity.revision}</span>
            </div>
            <h2 className="text-sm font-semibold text-text truncate" title={entity.name}>
              {entity.name}
            </h2>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
          title="Close details drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Scrollable Drawer Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs font-mono">
        {/* Entity ID & Badges Banner */}
        <div className="space-y-2 bg-bg/60 p-3 rounded-lg border border-border">
          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Entity ID:</span>
            <div 
              onClick={handleCopyId}
              className="flex items-center gap-1 text-accent hover:underline cursor-pointer"
              title="Copy ID"
            >
              <span>{entity.id}</span>
              {copiedId ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 opacity-60" />}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${view.confidenceBadgeClass}`}>
              {view.confidence}
            </span>
            {view.isStale && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-warning/20 text-warning border border-warning/40">
                STALE
              </span>
            )}
            {view.hasAuthBoundary && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/30">
                AUTH BOUNDARY
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-text-muted/80 pt-1 border-t border-border/40">
            <span>First seen: {new Date(entity.firstSeen).toLocaleDateString()}</span>
            <span>Last seen: {new Date(entity.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        {/* Kind-Specific Structured Metadata */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Attributes & Meta
          </h3>

          <div className="bg-bg/40 rounded-lg border border-border divide-y divide-border/40">
            {view.metaFields.length === 0 ? (
              <p className="p-3 text-[11px] text-text-muted italic">No specific attributes configured.</p>
            ) : (
              view.metaFields.map((field, idx) => (
                <div key={idx} className="p-2.5 flex items-start justify-between gap-2 text-[11px]">
                  <span className="text-text-muted font-medium shrink-0">{field.label}:</span>
                  <span className="text-text text-right font-mono truncate" title={field.value}>
                    {field.value}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tags */}
        {entity.tags.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Tags</h3>
            <div className="flex flex-wrap gap-1">
              {entity.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded bg-bg text-text-muted border border-border text-[10px]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Connected Topology Edges */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Connected Edges ({incomingEdges.length + outgoingEdges.length})
          </h3>

          <div className="space-y-2">
            {/* Incoming */}
            {incomingEdges.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Incoming</span>
                {incomingEdges.map((edg) => {
                  const source = getEntityById(edg.sourceId);
                  return (
                    <div
                      key={edg.id}
                      onClick={() => source && onSelectEntity(source)}
                      className="p-2 rounded bg-bg border border-border hover:border-accent/50 cursor-pointer transition-colors flex items-center justify-between text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <ArrowLeft className="w-3 h-3 text-text-muted shrink-0" />
                        <span className="text-text truncate">{source?.name || edg.sourceId}</span>
                      </div>
                      <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-surface-2 border border-border shrink-0">
                        {edg.relation}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Outgoing */}
            {outgoingEdges.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Outgoing</span>
                {outgoingEdges.map((edg) => {
                  const target = getEntityById(edg.targetId);
                  return (
                    <div
                      key={edg.id}
                      onClick={() => target && onSelectEntity(target)}
                      className="p-2 rounded bg-bg border border-border hover:border-accent/50 cursor-pointer transition-colors flex items-center justify-between text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <ArrowRight className="w-3 h-3 text-text-muted shrink-0" />
                        <span className="text-text truncate">{target?.name || edg.targetId}</span>
                      </div>
                      <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-surface-2 border border-border shrink-0">
                        {edg.relation}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {incomingEdges.length === 0 && outgoingEdges.length === 0 && (
              <p className="p-3 bg-bg/40 border border-dashed border-border rounded text-[11px] text-text-muted italic text-center">
                Isolated entity with no direct edges.
              </p>
            )}
          </div>
        </div>

        {/* Analyst Notes Section */}
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-accent" />
              <span>Notes ({notes.length})</span>
            </h3>
          </div>

          {/* Add Note Form */}
          <form onSubmit={handleAddNoteSubmit} className="space-y-1.5">
            <textarea
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              placeholder="Add observation note..."
              rows={2}
              className="w-full p-2 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/50 focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!newNoteContent.trim() || isSubmittingNote}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                <span>Add Note</span>
              </button>
            </div>
          </form>

          {/* Notes List */}
          <div className="space-y-2 pt-1">
            {notes.map((note) => (
              <div key={note.id} className="p-2.5 rounded bg-bg border border-border space-y-1">
                <p className="text-[11px] text-text leading-relaxed font-sans">{note.content}</p>
                <span className="text-[9px] text-text-muted/60 block text-right">
                  {new Date(note.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions Menu */}
        <div className="space-y-2 pt-2 border-t border-border">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Entity Actions
          </h3>

          <div className="grid grid-cols-1 gap-1.5">
            {/* Copy JSON */}
            <button
              onClick={handleCopyJson}
              className="flex items-center justify-between px-3 py-2 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-text transition-colors text-xs"
            >
              <span>Copy Entity JSON</span>
              {copiedJson ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5 text-text-muted" />}
            </button>

            {/* Filter Graph to Neighbors */}
            {onFilterGraphToNeighbors && (
              <button
                onClick={() => onFilterGraphToNeighbors(entity.id)}
                className="flex items-center justify-between px-3 py-2 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-text transition-colors text-xs"
                title="Filter graph to this entity and its connected neighborhood"
              >
                <span>Filter Graph to Neighbors</span>
                <Network className="w-3.5 h-3.5 text-accent" />
              </button>
            )}

            {/* Open in Workbench */}
            <button
              onClick={() => navigate(`/projects/${entity.projectId}/workbench`)}
              className="flex items-center justify-between px-3 py-2 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-text transition-colors text-xs"
              title="Open captured traffic and replay in Workbench"
            >
              <div className="flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-accent" />
                <span>Open in Workbench</span>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
            </button>

            {/* Placeholder: Create Hypothesis (M3) */}
            <button
              disabled
              className="flex items-center justify-between px-3 py-2 rounded bg-bg border border-border/40 text-text-muted/50 cursor-not-allowed text-xs"
              title="Available in Milestone 3: Hypothesis Testing"
            >
              <div className="flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5" />
                <span>Create Hypothesis</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-2 border border-border/40 text-text-muted/40">
                M3
              </span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
