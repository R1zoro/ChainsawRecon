import React, { useState } from 'react';
import { Plus, X, Layers, AlertCircle, BookmarkPlus, Check, Copy, Send } from 'lucide-react';
import { CapturedRequest, ReplayResult } from '../../../api/types';
import { fetchJson } from '../../../api/client';
import { RepeaterRequestEditor, EditableRequest } from './RepeaterRequestEditor';
import { ScopeGateConfirmationModal } from './ScopeGateConfirmationModal';

export interface RepeaterTab {
  id: string;
  title: string;
  editableRequest: EditableRequest;
  baselineRequest?: CapturedRequest | null;
  replayResult?: ReplayResult | null;
  isSending?: boolean;
  errorMessage?: string | null;
}

interface RepeaterWorkspaceProps {
  tabs: RepeaterTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onUpdateTabRequest: (tabId: string, updated: EditableRequest) => void;
  onSaveEvidence: (req: CapturedRequest) => void;
  onTabReplayed: (tabId: string, result: ReplayResult) => void;
}

export const RepeaterWorkspace: React.FC<RepeaterWorkspaceProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onUpdateTabRequest,
  onSaveEvidence,
  onTabReplayed,
}) => {
  const [isGateOpen, setIsGateOpen] = useState(false);
  const [pendingSendTabId, setPendingSendTabId] = useState<string | null>(null);
  const [copiedBody, setCopiedBody] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const handleTriggerSend = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // 1. Destructive Method Preflight Check
    const destructiveMethods = ['DELETE', 'PUT', 'PATCH'];
    if (destructiveMethods.includes(tab.editableRequest.method.toUpperCase())) {
      setPendingSendTabId(tabId);
      setIsGateOpen(true);
      return;
    }

    // Execute standard replay
    executeReplay(tabId);
  };

  const executeReplay = async (tabId: string, _justification?: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    try {
      const headersMap: Record<string, string> = {};
      tab.editableRequest.headers.forEach((h) => {
        if (h.key) headersMap[h.key] = h.value;
      });

      const queryMap: Record<string, string> = {};
      tab.editableRequest.queryParams.forEach((q) => {
        if (q.key) queryMap[q.key] = q.value;
      });

      const patch = {
        header: headersMap,
        query: queryMap,
        path: new URL(tab.editableRequest.url || 'https://api.example.com').pathname,
        json: tab.editableRequest.body ? JSON.parse(tab.editableRequest.body) : undefined,
      };

      const result = await fetchJson<ReplayResult>('/workbench/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: tab.editableRequest.baselineId || tab.editableRequest.id,
          patch,
        }),
      });

      onTabReplayed(tabId, result);
    } catch {
      // Replay failure handled gracefully
    }
  };

  const handleCopyResponseBody = (body: string) => {
    navigator.clipboard.writeText(body);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 2000);
  };

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-surface select-none space-y-3">
        <Layers className="w-8 h-8 opacity-40 text-text-muted" />
        <h3 className="text-sm font-semibold text-text">No active Repeater tabs</h3>
        <p className="text-xs text-text-muted max-w-sm">
          Select any captured request in Traffic History and click &quot;Send to Repeater&quot;, or click the button below to start a new scratch tab.
        </p>
        <button
          onClick={onAddTab}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Scratch Tab</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface select-none font-sans overflow-hidden">
      {/* Top Tab Bar */}
      <div className="h-10 px-4 border-b border-border bg-bg/70 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-t-md text-xs font-mono cursor-pointer border-t border-l border-r transition-colors ${
                  isActive
                    ? 'bg-surface border-border text-accent font-semibold shadow-sm'
                    : 'bg-surface/30 border-transparent text-text-muted hover:text-text hover:bg-surface/60'
                }`}
              >
                <span className="truncate max-w-[140px]">{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    className="p-0.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          <button
            onClick={onAddTab}
            className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
            title="Open new Repeater tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Workspace: Left Editor, Right Replay Response Pane */}
      <div className="flex-1 flex min-h-0 overflow-hidden divide-x divide-border">
        {/* Left: Request Editor */}
        <RepeaterRequestEditor
          request={activeTab.editableRequest}
          baselineRequest={activeTab.baselineRequest}
          onChange={(updated) => onUpdateTabRequest(activeTab.id, updated)}
          onSend={() => handleTriggerSend(activeTab.id)}
          isSending={activeTab.isSending}
        />

        {/* Right: Replay Response Pane */}
        <div className="flex-1 flex flex-col min-w-0 bg-surface font-sans text-xs select-none">
          {/* Header */}
          <div className="p-3 border-b border-border bg-surface-2/30 flex items-center justify-between">
            <span className="font-mono text-xs text-text-muted">
              Replay Response
            </span>

            {activeTab.replayResult && (
              <button
                onClick={() => onSaveEvidence(activeTab.replayResult!.request)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
              >
                <BookmarkPlus className="w-3.5 h-3.5 text-text-muted" />
                <span>Save as Evidence</span>
              </button>
            )}
          </div>

          {/* Scope Blocked Warning */}
          {activeTab.replayResult && !activeTab.replayResult.scope.allowed && (
            <div className="bg-danger/15 border-b border-danger/30 p-3 flex items-start gap-2 text-danger font-mono text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Transmission Blocked: Out of Scope</p>
                <p className="text-[11px] text-danger/80 pt-0.5">
                  {activeTab.replayResult.scope.reason}
                </p>
              </div>
            </div>
          )}

          {/* Response Payload */}
          <div className="flex-1 overflow-auto p-4 font-mono text-xs">
            {!activeTab.replayResult ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-text-muted space-y-2">
                <Send className="w-6 h-6 opacity-30" />
                <p>Click &quot;Send&quot; to execute this HTTP request and inspect the response.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Meta Bar */}
                <div className="flex items-center justify-between pb-2 border-b border-border text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded font-bold border ${
                      activeTab.replayResult.response.status >= 200 && activeTab.replayResult.response.status < 300
                        ? 'text-success bg-success/15 border-success/30'
                        : 'text-warning bg-warning/15 border-warning/30'
                    }`}>
                      {activeTab.replayResult.response.status}
                    </span>
                    <span className="text-text-muted">{activeTab.replayResult.response.durationMs}ms</span>
                    <span className="text-text-muted">&bull;</span>
                    <span className="text-text-muted">{activeTab.replayResult.response.sizeBytes} B</span>
                  </div>

                  <button
                    onClick={() => handleCopyResponseBody(activeTab.replayResult!.response.body)}
                    className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text"
                  >
                    {copiedBody ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedBody ? 'Copied' : 'Copy Body'}</span>
                  </button>
                </div>

                {/* Formatted Body */}
                <pre className="p-3 bg-bg rounded border border-border overflow-auto text-xs font-mono text-text leading-relaxed whitespace-pre-wrap break-all">
                  {activeTab.replayResult.response.body}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scope Gate Confirmation Modal */}
      {isGateOpen && (
        <ScopeGateConfirmationModal
          isOpen={isGateOpen}
          onClose={() => {
            setIsGateOpen(false);
            setPendingSendTabId(null);
          }}
          onConfirm={(reason) => {
            if (pendingSendTabId) {
              executeReplay(pendingSendTabId, reason);
            }
          }}
          method={activeTab.editableRequest.method}
          url={activeTab.editableRequest.url}
        />
      )}
    </div>
  );
};
