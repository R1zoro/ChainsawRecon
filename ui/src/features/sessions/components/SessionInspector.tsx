import React, { useState } from 'react';
import { 
  Copy, Check, Code, Cpu, CheckSquare, 
  FileText, Network, X 
} from 'lucide-react';
import { JournalEvent, SessionContextResponse } from '../../../api/types';

interface SessionInspectorProps {
  selectedEvent: JournalEvent | null;
  contextData?: SessionContextResponse | null;
  onClose: () => void;
}

type InspectorTab = 'context' | 'task' | 'evidence' | 'app_model' | 'raw_event';

export const SessionInspector: React.FC<SessionInspectorProps> = ({
  selectedEvent,
  contextData,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('raw_event');
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    if (!selectedEvent) return;
    navigator.clipboard.writeText(JSON.stringify(selectedEvent, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const tabs = [
    { id: 'raw_event', label: 'Raw Event', icon: <Code className="w-3.5 h-3.5" /> },
    { id: 'context', label: 'Context', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'task', label: 'Task', icon: <CheckSquare className="w-3.5 h-3.5" /> },
    { id: 'evidence', label: 'Evidence', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'app_model', label: 'App Model', icon: <Network className="w-3.5 h-3.5" /> },
  ];

  return (
    <aside className="w-96 border-l border-border bg-surface flex flex-col shrink-0 font-sans select-none">
      {/* Header Bar */}
      <div className="border-b border-border px-4 h-11 flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-semibold text-text tracking-tight flex items-center gap-1.5 font-mono">
          <span>Inspector</span>
          {selectedEvent && (
            <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20">
              Seq #{selectedEvent.seq}
            </span>
          )}
        </span>

        <button
          onClick={onClose}
          className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
          title="Close inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-bg/60 overflow-x-auto shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as InspectorTab)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-accent text-accent bg-surface'
                : 'border-transparent text-text-muted hover:text-text hover:bg-surface-2/40'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
        {/* TAB: RAW EVENT */}
        {activeTab === 'raw_event' && (
          <div className="space-y-3">
            {selectedEvent ? (
              <>
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted text-[11px]">Type:</span>
                    <span className="text-accent font-semibold">{selectedEvent.type}</span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-2/80 text-text border border-border text-[11px] transition-colors"
                  >
                    {isCopied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                    <span>{isCopied ? 'Copied' : 'Copy JSON'}</span>
                  </button>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between py-0.5 text-text-muted">
                    <span>Actor:</span>
                    <span className="text-text">{selectedEvent.actor}</span>
                  </div>
                  <div className="flex justify-between py-0.5 text-text-muted">
                    <span>Turn / Step:</span>
                    <span className="text-text">
                      {selectedEvent.turn ?? '-'} / {selectedEvent.step ?? '-'}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5 text-text-muted">
                    <span>Timestamp:</span>
                    <span className="text-text">{new Date(selectedEvent.ts).toISOString()}</span>
                  </div>
                </div>

                <div className="pt-2">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">
                    Event Payload
                  </span>
                  <pre className="p-3 rounded bg-bg border border-border text-[11px] text-text overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[400px]">
                    {JSON.stringify(selectedEvent.data, null, 2)}
                  </pre>
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-text-muted space-y-1 italic">
                <p>Click any event in the journal timeline to inspect its raw payload and hash refs.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB: CONTEXT */}
        {activeTab === 'context' && (
          <div className="space-y-4">
            <span className="text-[11px] font-semibold text-text uppercase tracking-wider block">
              Active Context Assembly
            </span>

            {contextData?.roles && contextData.roles.length > 0 ? (
              <div className="space-y-3">
                {contextData.roles.map((r) => (
                  <div key={r.role} className="p-3 rounded bg-bg border border-border space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-accent font-semibold uppercase">{r.role}</span>
                      <span className="text-text-muted text-[10px]">
                        Budget: {r.budgetTokens} tokens
                      </span>
                    </div>
                    <div className="text-[11px] text-text-muted">
                      <span>Model: </span>
                      <span className="text-text">{r.modelId || 'unassigned'}</span>
                    </div>
                    <div className="text-[11px] text-text-muted">
                      <span>Used Tokens: </span>
                      <span className="text-text">{r.usedTokens}</span>
                    </div>
                    {r.warnings && r.warnings.length > 0 && (
                      <div className="p-1.5 rounded bg-surface-2 text-[10px] text-text-muted space-y-0.5">
                        {r.warnings.map((w, idx) => (
                          <div key={idx}>• {w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded bg-bg border border-border text-text-muted text-xs">
                No context has been assembled yet.
              </div>
            )}
          </div>
        )}

        {/* TAB: TASK */}
        {activeTab === 'task' && (
          <div className="space-y-3">
            <span className="text-[11px] font-semibold text-text uppercase tracking-wider block">
              Task Details
            </span>
            {selectedEvent?.type.startsWith('task') ? (
              <div className="p-3 rounded bg-bg border border-border space-y-2 text-xs">
                <div className="text-accent font-semibold">{selectedEvent.type}</div>
                <pre className="text-[10px] text-text overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(selectedEvent.data, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="p-4 rounded bg-bg border border-border text-text-muted text-xs text-center space-y-1">
                <p>Waiting for the controller to schedule work.</p>
                <p className="text-[10px] text-text-muted/60">Click any task event in the timeline to inspect details.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB: EVIDENCE */}
        {activeTab === 'evidence' && (
          <div className="space-y-3">
            <span className="text-[11px] font-semibold text-text uppercase tracking-wider block">
              Evidence Details
            </span>
            {selectedEvent?.type.startsWith('evidence') ? (
              <div className="p-3 rounded bg-bg border border-border space-y-2 text-xs">
                <div className="text-accent font-semibold">{selectedEvent.type}</div>
                <pre className="text-[10px] text-text overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(selectedEvent.data, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="p-4 rounded bg-bg border border-border text-text-muted text-xs text-center space-y-1">
                <p>Select an evidence event in the journal timeline or evidence list to view artifact verification hashes.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB: APP MODEL */}
        {activeTab === 'app_model' && (
          <div className="space-y-3">
            <span className="text-[11px] font-semibold text-text uppercase tracking-wider block">
              Application Topology Model
            </span>
            <div className="p-4 rounded bg-bg border border-border text-text-muted text-xs text-center">
              Reconnaissance and service topology map will construct here as targets are enumerated.
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
