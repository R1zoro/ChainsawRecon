import React, { useState } from 'react';
import { 
  Cpu, CheckSquare, ShieldAlert, FileText, 
  Clock, ChevronDown, ChevronRight, Info, Check, X, RotateCw 
} from 'lucide-react';
import { 
  ActiveSessionSummary, 
  SessionContextResponse, 
  TaskItem, 
  ApprovalItem, 
  EvidenceItem 
} from '../../../api/types';

interface SessionLeftPanelProps {
  session?: ActiveSessionSummary | null;
  contextData?: SessionContextResponse | null;
  tasks?: TaskItem[];
  approvals?: ApprovalItem[];
  evidenceItems?: EvidenceItem[];
  targets?: string[];
  onSelectEvidence?: (item: EvidenceItem) => void;
  onGrantApproval?: (approvalId: string, reason: string) => Promise<void>;
  onDenyApproval?: (approvalId: string, reason: string) => Promise<void>;
}

export const SessionLeftPanel: React.FC<SessionLeftPanelProps> = ({
  session,
  contextData,
  tasks = [],
  approvals = [],
  evidenceItems = [],
  targets: propTargets,
  onSelectEvidence,
  onGrantApproval,
  onDenyApproval,
}) => {
  const [isContextExpanded, setIsContextExpanded] = useState(true);
  const [isTasksExpanded, setIsTasksExpanded] = useState(true);
  const [isApprovalsExpanded, setIsApprovalsExpanded] = useState(true);
  const [isEvidenceExpanded, setIsEvidenceExpanded] = useState(true);

  // Active approval decision form state
  const [activeApprovalId, setActiveApprovalId] = useState<string | null>(null);
  const [approvalReason, setApprovalReason] = useState<string>('');
  const [isApprovalSubmitting, setIsApprovalSubmitting] = useState<boolean>(false);

  const budget = session?.budget;
  const targets = (propTargets && propTargets.length > 0) ? propTargets : (session?.targets || []);

  const handleGrant = async (id: string) => {
    if (!onGrantApproval || isApprovalSubmitting) return;
    setIsApprovalSubmitting(true);
    try {
      await onGrantApproval(id, approvalReason.trim());
      setActiveApprovalId(null);
      setApprovalReason('');
    } finally {
      setIsApprovalSubmitting(false);
    }
  };

  const handleDeny = async (id: string) => {
    if (!onDenyApproval || isApprovalSubmitting) return;
    setIsApprovalSubmitting(true);
    try {
      await onDenyApproval(id, approvalReason.trim());
      setActiveApprovalId(null);
      setApprovalReason('');
    } finally {
      setIsApprovalSubmitting(false);
    }
  };

  return (
    <aside className="w-80 border-r border-border bg-surface flex flex-col shrink-0 overflow-y-auto font-sans select-none">
      {/* Session Scope & Targets Card */}
      <div className="p-4 border-b border-border space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">Targets</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-text-muted border border-border">
            {targets.length} defined
          </span>
        </div>
        <div className="space-y-1">
          {targets.length === 0 ? (
            <p className="text-xs text-text-muted italic">No specific targets bound.</p>
          ) : (
            targets.map((tgt, idx) => (
              <div
                key={idx}
                className="text-xs font-mono px-2 py-1 bg-bg/80 border border-border rounded text-text truncate"
                title={tgt}
              >
                {tgt}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Budget & Consumption */}
      {budget && (
        <div className="p-4 border-b border-border space-y-2">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider block">
            Budget Consumption
          </span>
          <div className="grid grid-cols-3 gap-2 font-mono text-center">
            <div className="p-2 rounded bg-bg border border-border">
              <span className="text-[9px] text-text-muted block">Models</span>
              <span className="text-xs font-semibold text-text">
                {budget.used?.modelCalls ?? 0}
                <span className="text-[10px] text-text-muted font-normal">/{budget.modelCalls}</span>
              </span>
            </div>
            <div className="p-2 rounded bg-bg border border-border">
              <span className="text-[9px] text-text-muted block">Tools</span>
              <span className="text-xs font-semibold text-text">
                {budget.used?.toolCalls ?? 0}
                <span className="text-[10px] text-text-muted font-normal">/{budget.toolCalls}</span>
              </span>
            </div>
            <div className="p-2 rounded bg-bg border border-border">
              <span className="text-[9px] text-text-muted block">Wall Time</span>
              <span className="text-xs font-semibold text-text">
                {Math.round((budget.used?.wallSeconds ?? 0) / 60)}m
                <span className="text-[10px] text-text-muted font-normal">/{Math.round(budget.wallSeconds / 60)}m</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Context Meter (Honest state: "No context assembled yet") */}
      <div className="border-b border-border">
        <button
          onClick={() => setIsContextExpanded(!isContextExpanded)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-text hover:bg-surface-2/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-accent" />
            <span>Context Meter</span>
          </span>
          {isContextExpanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
        </button>

        {isContextExpanded && (
          <div className="px-4 pb-4 space-y-2.5">
            {contextData?.roles && contextData.roles.length > 0 ? (
              <div className="space-y-2 font-mono text-xs">
                {contextData.roles.map((r) => {
                  const hasWarning = (r.warnings && r.warnings.length > 0) || r.usedTokens === 0;
                  return (
                    <div key={r.role} className="p-2 rounded bg-bg/80 border border-border space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-text uppercase">{r.role}</span>
                        <span className="text-text-muted text-[10px]">
                          {r.usedTokens} / {r.budgetTokens || 'unbound'} tok
                        </span>
                      </div>
                      {/* Token Bar */}
                      <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all duration-300"
                          style={{
                            width: r.budgetTokens ? `${Math.min(100, (r.usedTokens / r.budgetTokens) * 100)}%` : '0%',
                          }}
                        />
                      </div>
                      {hasWarning && (
                        <span className="text-[10px] text-text-muted/80 flex items-center gap-1 pt-0.5">
                          <Info className="w-3 h-3 text-text-muted/60 shrink-0" />
                          <span>No context assembled yet</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 rounded bg-bg/60 border border-border/80 text-xs text-text-muted space-y-1">
                <div className="flex items-center gap-1.5 text-text">
                  <Info className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="font-medium text-[11px]">No context assembled yet</span>
                </div>
                <p className="text-[10px] text-text-muted leading-relaxed">
                  Context window budgets and token compaction will populate when agent turns execute.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task Board (Honest Empty State) */}
      <div className="border-b border-border">
        <button
          onClick={() => setIsTasksExpanded(!isTasksExpanded)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-text hover:bg-surface-2/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <CheckSquare className="w-3.5 h-3.5 text-accent" />
            <span>Task Board</span>
            <span className="text-[10px] font-mono px-1 rounded bg-surface-2 text-text-muted">
              {tasks.length}
            </span>
          </span>
          {isTasksExpanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
        </button>

        {isTasksExpanded && (
          <div className="px-4 pb-4">
            {tasks.length === 0 ? (
              <div className="p-3 rounded bg-bg/50 border border-dashed border-border text-xs text-center space-y-1">
                <Clock className="w-4 h-4 text-text-muted mx-auto opacity-50" />
                <p className="text-[11px] text-text-muted">Waiting for the controller to schedule work.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.id} className="p-2.5 rounded bg-bg border border-border text-xs space-y-1 font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-text font-medium truncate">{task.title}</span>
                      <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-surface-2 text-text-muted">
                        {task.status}
                      </span>
                    </div>
                    {task.target && (
                      <div className="text-[10px] text-text-muted truncate">
                        Target: {task.target}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Approvals Inbox with Interactive Grant / Deny Actions */}
      <div className="border-b border-border">
        <button
          onClick={() => setIsApprovalsExpanded(!isApprovalsExpanded)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-text hover:bg-surface-2/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-accent" />
            <span>Approvals Inbox</span>
            {approvals.filter((a) => a.status === 'pending').length > 0 ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-warning/20 text-warning font-semibold border border-warning/30">
                {approvals.filter((a) => a.status === 'pending').length} pending
              </span>
            ) : (
              <span className="text-[10px] font-mono px-1 rounded bg-surface-2 text-text-muted">
                {approvals.length}
              </span>
            )}
          </span>
          {isApprovalsExpanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
        </button>

        {isApprovalsExpanded && (
          <div className="px-4 pb-4">
            {approvals.length === 0 ? (
              <div className="p-3 rounded bg-bg/50 border border-dashed border-border text-xs text-center space-y-1">
                <p className="text-[11px] text-text-muted">No pending approvals.</p>
                <p className="text-[10px] text-text-muted/60">Policy checks and destructive actions will gate here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {approvals.map((appr) => {
                  const isPending = appr.status === 'pending';
                  const isFormOpen = activeApprovalId === appr.id;

                  return (
                    <div 
                      key={appr.id} 
                      className={`p-3 rounded-lg border text-xs space-y-2 font-mono ${
                        isPending 
                          ? 'bg-warning/10 border-warning/40' 
                          : 'bg-bg border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-text text-xs">{appr.title}</span>
                        <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-semibold ${
                          appr.status === 'granted' 
                            ? 'bg-success/20 text-success' 
                            : appr.status === 'denied' 
                            ? 'bg-danger/20 text-danger' 
                            : 'bg-warning/20 text-warning'
                        }`}>
                          {appr.status}
                        </span>
                      </div>

                      {appr.detail && (
                        <p className="text-[11px] text-text-muted font-sans leading-relaxed">
                          {appr.detail}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[10px] text-text-muted pt-1 border-t border-border/40">
                        <span>Risk: <span className="text-warning font-semibold uppercase">{appr.risk}</span></span>
                        <span>{new Date(appr.createdAt).toLocaleTimeString()}</span>
                      </div>

                      {/* Interactive Decision Controls for Pending Approvals */}
                      {isPending && (
                        <div className="pt-2 border-t border-border/40 space-y-2">
                          {isFormOpen ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={approvalReason}
                                onChange={(e) => setApprovalReason(e.target.value)}
                                placeholder="Reason for decision (optional for grant)..."
                                className="w-full px-2 py-1 bg-bg border border-border rounded text-[11px] text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
                              />
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setActiveApprovalId(null)}
                                  disabled={isApprovalSubmitting}
                                  className="px-2 py-1 text-[10px] rounded bg-surface-2 text-text hover:bg-surface-2/80 transition-colors"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeny(appr.id)}
                                  disabled={isApprovalSubmitting}
                                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-danger/20 text-danger border border-danger/40 hover:bg-danger/30 font-semibold transition-colors disabled:opacity-40"
                                >
                                  <X className="w-3 h-3" />
                                  <span>Deny</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleGrant(appr.id)}
                                  disabled={isApprovalSubmitting}
                                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-success/20 text-success border border-success/40 hover:bg-success/30 font-semibold transition-colors disabled:opacity-40"
                                >
                                  {isApprovalSubmitting ? <RotateCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                  <span>Grant</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveApprovalId(appr.id);
                                  setApprovalReason('');
                                }}
                                className="px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-[11px] text-text transition-colors"
                              >
                                Review & Decide
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Evidence Quick List */}
      <div className="border-b border-border">
        <button
          onClick={() => setIsEvidenceExpanded(!isEvidenceExpanded)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-text hover:bg-surface-2/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-accent" />
            <span>Evidence List</span>
            <span className="text-[10px] font-mono px-1 rounded bg-surface-2 text-text-muted">
              {evidenceItems.length}
            </span>
          </span>
          {isEvidenceExpanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
        </button>

        {isEvidenceExpanded && (
          <div className="px-4 pb-4 space-y-1.5 font-mono text-xs">
            {evidenceItems.length === 0 ? (
              <p className="text-[11px] text-text-muted italic px-2">No evidence recorded yet.</p>
            ) : (
              evidenceItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onSelectEvidence?.(item)}
                  className="p-2 rounded bg-bg border border-border hover:border-accent/50 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-[10px] text-text-muted">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-accent truncate">{item.id}</span>
                      {item.artifactId && (
                        <span className="px-1 py-0.5 rounded bg-surface-2 text-[9px] font-mono text-text-muted border border-border">
                          {item.artifactId}
                        </span>
                      )}
                    </div>
                    <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-[11px] text-text truncate font-sans">
                    {item.summary}
                  </div>
                  {item.hash && (
                    <div className="text-[9px] text-text-muted truncate">
                      {item.hash.slice(0, 24)}…
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
