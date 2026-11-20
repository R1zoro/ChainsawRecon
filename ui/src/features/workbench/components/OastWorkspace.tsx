import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Radio, Play, Square, Plus, Copy, Check, 
  ChevronDown, ChevronRight, AlertTriangle, 
  Clock, ShieldAlert, RotateCw, X, Globe
} from 'lucide-react';
import { fetchJson, isApiError } from '../../../api/client';
import { 
  OastStatusResponse, 
  OastToken, 
  OastEvent, 
  Paginated 
} from '../../../api/types';

interface OastWorkspaceProps {
  projectId: string;
}

// Redact sensitive headers for display
function redactHeaderMap(headers: Record<string, string>): Record<string, string> {
  const sensitive = ['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key'];
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (sensitive.includes(k.toLowerCase())) {
      result[k] = '«redacted»';
    } else {
      result[k] = v;
    }
  }
  return result;
}

export const OastWorkspace: React.FC<OastWorkspaceProps> = ({ projectId }) => {
  const queryClient = useQueryClient();

  // State
  const [selectedTokenFilter, setSelectedTokenFilter] = useState<string | null>(null);
  const [isCreateTokenOpen, setIsCreateTokenOpen] = useState(false);
  const [tokenNote, setTokenNote] = useState('');
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [expandedEvents, setExpandedEvents] = useState<Record<string | number, boolean>>({});
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedDnsToken, setCopiedDnsToken] = useState<string | null>(null);
  const [copiedEventId, setCopiedEventId] = useState<string | number | null>(null);

  // 1. Fetch OAST server status
  const { data: status, refetch: refetchStatus } = useQuery<OastStatusResponse>({
    queryKey: ['oastStatus', projectId],
    queryFn: () => fetchJson<OastStatusResponse>(`/projects/${projectId}/oast/status`),
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });

  const isRunning = Boolean(status?.running);

  // 2. Fetch OAST tokens
  const { data: tokensData, refetch: refetchTokens } = useQuery<Paginated<OastToken>>({
    queryKey: ['oastTokens', projectId],
    queryFn: () => fetchJson<Paginated<OastToken>>(`/projects/${projectId}/oast/tokens`),
    enabled: Boolean(projectId),
    refetchInterval: isRunning ? 3000 : false,
  });

  const tokens = tokensData?.items || [];

  // 3. Fetch OAST events (filtered by token if selected)
  const { data: eventsData, isFetching: isFetchingEvents } = useQuery<Paginated<OastEvent>>({
    queryKey: ['oastEvents', projectId, selectedTokenFilter],
    queryFn: () => {
      const queryParam = selectedTokenFilter ? `?token=${encodeURIComponent(selectedTokenFilter)}` : '';
      return fetchJson<Paginated<OastEvent>>(`/projects/${projectId}/oast/events${queryParam}`);
    },
    enabled: Boolean(projectId),
    refetchInterval: isRunning ? 3000 : false,
  });

  const events = eventsData?.items || [];

  // Server start/stop handlers
  const handleStartServer = async () => {
    setIsStarting(true);
    setServerError(null);
    try {
      await fetchJson<OastStatusResponse>(`/projects/${projectId}/oast/start`, {
        method: 'POST',
        body: JSON.stringify({ host: '127.0.0.1', port: 0, dnsPort: 0, dnsDomain: 'oast.local' }),
      });
      await refetchStatus();
      await refetchTokens();
    } catch (err) {
      setServerError(isApiError(err) ? err.message : 'Failed to start OAST server.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopServer = async () => {
    setIsStopping(true);
    setServerError(null);
    try {
      await fetchJson<OastStatusResponse>(`/projects/${projectId}/oast/stop`, {
        method: 'POST',
      });
      await refetchStatus();
    } catch (err) {
      setServerError(isApiError(err) ? err.message : 'Failed to stop OAST server.');
    } finally {
      setIsStopping(false);
    }
  };

  // Create token handler
  const handleCreateToken = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isRunning) {
      setCreateError('OAST server must be running to generate tokens.');
      return;
    }
    setIsCreatingToken(true);
    setCreateError(null);
    try {
      await fetchJson<OastToken>(`/projects/${projectId}/oast/tokens`, {
        method: 'POST',
        body: JSON.stringify({ note: tokenNote.trim() }),
      });
      setTokenNote('');
      setIsCreateTokenOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['oastTokens', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['oastStatus', projectId] });
    } catch (err) {
      setCreateError(isApiError(err) ? err.message : 'Failed to create OAST token.');
    } finally {
      setIsCreatingToken(false);
    }
  };

  const handleCopyUrl = (url: string, token: string) => {
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleCopyDnsName = (dnsName: string, token: string) => {
    navigator.clipboard.writeText(dnsName);
    setCopiedDnsToken(token);
    setTimeout(() => setCopiedDnsToken(null), 2000);
  };

  const handleCopyEventJson = (event: OastEvent) => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2));
    setCopiedEventId(event.id);
    setTimeout(() => setCopiedEventId(null), 2000);
  };

  const toggleEventExpand = (id: string | number) => {
    setExpandedEvents((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div 
      data-testid="oast-workspace"
      className="flex-1 flex flex-col min-h-0 bg-bg text-text font-sans overflow-hidden select-none"
    >
      {/* Top Banner Notice & Warnings */}
      <div className="bg-surface border-b border-border px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-accent shrink-0" />
            <span className="font-semibold text-text">Out-of-Band (OAST) Callbacks</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            {isRunning ? (
              <>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-success/15 text-success border border-success/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  <span>Listening: {status?.url}</span>
                </span>
                {status?.dnsDomain && (
                  <span 
                    data-testid="oast-dns-status"
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-surface-2 text-text border border-border"
                    title="Local raw DNS listener"
                  >
                    <Globe className="w-3 h-3 text-accent shrink-0" />
                    <span>DNS: {status.dnsDomain}{status.dnsPort ? `:${status.dnsPort}` : ''}</span>
                  </span>
                )}
              </>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-surface-2 text-text-muted border border-border">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60" />
                <span>Server Stopped</span>
              </span>
            )}

            <span className="px-2 py-0.5 rounded bg-surface-2 border border-border text-[11px] font-mono text-text-muted">
              {status?.eventCount ?? events.length} Callbacks
            </span>
          </div>
        </div>

        {/* Start / Stop Toggle Button */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <button
              onClick={handleStopServer}
              disabled={isStopping}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30 text-xs font-medium transition-colors disabled:opacity-50"
              title="Stop local OAST listener"
            >
              {isStopping ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-current" />}
              <span>Stop Server</span>
            </button>
          ) : (
            <button
              onClick={handleStartServer}
              disabled={isStarting}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover text-xs font-medium transition-colors disabled:opacity-50 shadow-sm"
              title="Start local OAST HTTP listener"
            >
              {isStarting ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>Start Server</span>
            </button>
          )}
        </div>
      </div>

      {/* Server Error Banner */}
      {serverError && (
        <div className="px-6 py-2 bg-danger/10 border-b border-danger/30 text-danger text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{serverError}</span>
          </div>
          <button onClick={() => setServerError(null)} className="text-danger/80 hover:text-danger text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Split Body: Left = Tokens (360px), Right = Event Stream */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Column: Tokens Panel */}
        <div className="w-80 sm:w-96 border-r border-border bg-surface flex flex-col shrink-0 overflow-hidden">
          {/* Tokens Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 bg-surface-2/30 shrink-0">
            <div>
              <h3 className="text-xs font-semibold text-text">Interaction Tokens</h3>
              <p className="text-[10px] text-text-muted">Unique URLs injected into payloads</p>
            </div>

            <button
              onClick={() => {
                setCreateError(null);
                setIsCreateTokenOpen(true);
              }}
              disabled={!isRunning}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-40"
              title={isRunning ? 'Create new callback token' : 'Start server to create tokens'}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Token</span>
            </button>
          </div>

          {/* New Token Dialog / Inline Card */}
          {isCreateTokenOpen && (
            <div className="p-3 border-b border-border bg-bg/90 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text">Generate New Token</span>
                <button
                  onClick={() => setIsCreateTokenOpen(false)}
                  className="text-text-muted hover:text-text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <form onSubmit={handleCreateToken} className="space-y-2">
                <div>
                  <label htmlFor="token-note" className="block text-[11px] text-text-muted font-mono mb-1">
                    Payload Note / Hypothesis Context
                  </label>
                  <input
                    id="token-note"
                    type="text"
                    required
                    value={tokenNote}
                    onChange={(e) => setTokenNote(e.target.value)}
                    placeholder="e.g. Blind SSRF in XML parser"
                    className="w-full px-2.5 py-1.5 rounded bg-surface border border-border text-xs focus:outline-none focus:border-accent"
                  />
                </div>

                {createError && (
                  <p className="text-danger text-[11px] font-mono">{createError}</p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsCreateTokenOpen(false)}
                    className="px-2.5 py-1 rounded border border-border text-text-muted hover:text-text text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingToken || !tokenNote.trim()}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs disabled:opacity-50"
                  >
                    {isCreatingToken ? <RotateCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    <span>Generate</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Active Filter Pill */}
          {selectedTokenFilter && (
            <div className="px-3 py-2 bg-accent/10 border-b border-accent/20 flex items-center justify-between text-xs text-accent">
              <span className="font-mono text-[11px] truncate">
                Filtering by token: {selectedTokenFilter.slice(0, 14)}...
              </span>
              <button
                onClick={() => setSelectedTokenFilter(null)}
                className="text-[11px] font-mono underline hover:no-underline"
              >
                Clear
              </button>
            </div>
          )}

          {/* Tokens List / Empty State */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!isRunning && tokens.length === 0 ? (
              <div 
                data-testid="oast-stopped-state"
                className="py-12 text-center p-6 space-y-3"
              >
                <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mx-auto text-text-muted">
                  <Radio className="w-5 h-5" />
                </div>
                <h4 className="text-xs font-semibold text-text">Server Stopped</h4>
                <p className="text-xs text-text-muted leading-relaxed">
                  Start the local OAST server to bind a loopback HTTP listener and generate interaction tokens.
                </p>
                <button
                  onClick={handleStartServer}
                  className="px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs"
                >
                  Start Server
                </button>
              </div>
            ) : tokens.length === 0 ? (
              <div 
                data-testid="oast-no-tokens-state"
                className="py-12 text-center p-6 space-y-3"
              >
                <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center mx-auto text-accent">
                  <Plus className="w-5 h-5" />
                </div>
                <h4 className="text-xs font-semibold text-text">No Tokens Generated</h4>
                <p className="text-xs text-text-muted leading-relaxed">
                  Create interaction tokens to obtain uniquely correlated HTTP URLs for blind SSRF, XXE, and RCE testing.
                </p>
                <button
                  onClick={() => setIsCreateTokenOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs"
                >
                  Generate First Token
                </button>
              </div>
            ) : (
              tokens.map((t) => {
                const isSelected = selectedTokenFilter === t.token;
                return (
                  <div
                    key={t.token}
                    data-testid={`token-card-${t.token}`}
                    onClick={() => setSelectedTokenFilter(isSelected ? null : t.token)}
                    className={`p-3 rounded-lg border text-xs cursor-pointer transition-all space-y-2 ${
                      isSelected
                        ? 'border-accent bg-accent/5'
                        : 'border-border bg-bg/60 hover:border-border/80 hover:bg-surface-2/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold text-text truncate block">
                          {t.note || 'Untitled Token'}
                        </span>
                        <span className="font-mono text-[10px] text-text-muted truncate block">
                          {t.token}
                        </span>
                      </div>

                      <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] shrink-0 ${
                        t.hits > 0
                          ? 'bg-success/15 text-success border border-success/30 font-semibold'
                          : 'bg-surface-2 text-text-muted border border-border'
                      }`}>
                        {t.hits} hits
                      </span>
                    </div>

                    {/* Primary HTTP URL Row & Copy Button */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50 text-[11px] font-mono">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[9px] px-1 py-0.2 rounded bg-surface-2 text-text-muted shrink-0 font-sans">HTTP</span>
                        <span className="text-text-muted truncate select-all" title={t.url}>
                          {t.url}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyUrl(t.url, t.token);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-text hover:bg-surface text-[10px] shrink-0 transition-colors"
                        title="Copy interaction HTTP URL"
                      >
                        {copiedToken === t.token ? (
                          <Check className="w-3 h-3 text-success" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{copiedToken === t.token ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    {/* Secondary DNS Name Row & Copy Button */}
                    {t.dnsName && (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30 text-[11px] font-mono">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[9px] px-1 py-0.2 rounded bg-surface-2 text-accent/90 shrink-0 font-sans">DNS</span>
                          <span className="text-text-muted truncate select-all" title={t.dnsName}>
                            {t.dnsName}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyDnsName(t.dnsName!, t.token);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-text hover:bg-surface text-[10px] shrink-0 transition-colors"
                          title="Copy DNS name"
                        >
                          {copiedDnsToken === t.token ? (
                            <Check className="w-3 h-3 text-success" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedDnsToken === t.token ? 'Copied' : 'Copy DNS'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Callback Event Stream */}
        <div className="flex-1 flex flex-col min-w-0 bg-bg overflow-hidden">
          {/* Header Bar */}
          <div className="px-6 py-3 border-b border-border bg-surface/50 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text">Received Callbacks</span>
              {selectedTokenFilter ? (
                <span className="px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 text-[10px] font-mono">
                  Filtered ({events.length})
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-surface-2 text-text-muted border border-border text-[10px] font-mono">
                  Total ({events.length})
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
              {isRunning && (
                <span className="flex items-center gap-1 text-[11px] text-text-muted">
                  <RotateCw className={`w-3 h-3 ${isFetchingEvents ? 'animate-spin text-accent' : ''}`} />
                  <span>Polling every 3s</span>
                </span>
              )}
            </div>
          </div>

          {/* Security & Boundary Notice Bar */}
          <div className="px-6 py-2.5 bg-warning/5 border-b border-warning/20 text-warning text-xs space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 text-warning" />
              <span>OAST Security Boundaries &amp; Caveats</span>
            </div>
            <ul className="text-[11px] text-text-muted space-y-0.5 list-disc list-inside">
              <li>
                <strong className="text-text">Primary HTTP:</strong> Standard HTTP callbacks remain the primary interaction channel with request headers and body logging.
              </li>
              <li>
                <strong className="text-text">DNS support:</strong> Supports A-record-only raw DNS queries (no recursion / DNSSEC). Resolves to local answer IP.
              </li>
              <li>
                <strong className="text-text">Localhost bind:</strong> Defaults to <code className="font-mono">127.0.0.1</code>. External target servers require a reachable LAN IP or reverse tunnel.
              </li>
              <li>
                <strong className="text-text">Candidate signal only:</strong> Out-of-band callbacks prove network egress and reachability. They are <strong className="text-warning">not automatically validated findings</strong>.
              </li>
            </ul>
          </div>

          {/* Events Timeline / Empty State */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {events.length === 0 ? (
              <div 
                data-testid="oast-no-callbacks-state"
                className="py-16 text-center border border-dashed border-border rounded-xl bg-surface/30 p-8 space-y-3 max-w-lg mx-auto mt-6"
              >
                <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto text-text-muted">
                  <Clock className="w-6 h-6" />
                </div>
                <h4 className="text-xs font-semibold text-text">No Callbacks Received Yet</h4>
                <p className="text-xs text-text-muted leading-relaxed font-sans">
                  {selectedTokenFilter
                    ? 'No incoming HTTP requests have hit this token URL yet. Trigger out-of-band interactions on target inputs.'
                    : 'The OAST server is listening for callbacks. Generate an interaction token on the left and supply its URL to your test payloads.'}
                </p>
                {selectedTokenFilter && (
                  <button
                    onClick={() => setSelectedTokenFilter(null)}
                    className="px-3 py-1 rounded bg-surface-2 border border-border text-xs text-text hover:bg-surface"
                  >
                    View All Callbacks
                  </button>
                )}
              </div>
            ) : (
              events.map((evt) => {
                const isExpanded = Boolean(expandedEvents[evt.id]);
                const redactedHeaders = redactHeaderMap(evt.headers || {});

                return (
                  <div
                    key={evt.id}
                    data-testid={`oast-event-${evt.id}`}
                    className="rounded-lg border border-border bg-surface overflow-hidden text-xs transition-colors hover:border-border/80"
                  >
                    {/* Event Header Card */}
                    <div
                      onClick={() => toggleEventExpand(evt.id)}
                      className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-surface-2/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        )}

                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                          evt.method === 'POST'
                            ? 'bg-accent/15 text-accent border border-accent/30'
                            : evt.method === 'DNS'
                            ? 'bg-info/15 text-info border border-info/30'
                            : 'bg-surface-2 text-text border border-border'
                        }`}>
                          {evt.method}
                        </span>

                        <span className="font-mono font-medium text-text truncate max-w-sm" title={evt.path}>
                          {evt.path}
                        </span>

                        {evt.query && (
                          <span className="text-[11px] font-mono text-text-muted truncate max-w-xs" title={`?${evt.query}`}>
                            ?{evt.query}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-text-muted">
                        <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border/60">
                          {evt.remote}
                        </span>

                        <span>
                          {new Date(evt.createdAt).toLocaleTimeString()}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyEventJson(evt);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-surface text-[10px] text-text"
                          title="Copy raw JSON event"
                        >
                          {copiedEventId === evt.id ? (
                            <Check className="w-3 h-3 text-success" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedEventId === evt.id ? 'Copied' : 'JSON'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Expandable Headers & Body */}
                    {isExpanded && (
                      <div className="p-4 border-t border-border bg-bg/80 space-y-3 font-mono text-[11px]">
                        {/* Token Association */}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-text-muted">Associated Token:</span>
                          <span className="text-accent font-semibold">{evt.token}</span>
                        </div>

                        {evt.method === 'DNS' ? (
                          <div className="space-y-1.5">
                            <span className="text-[10px] text-text-muted uppercase tracking-wider block">
                              DNS Query Details (Raw A-Record)
                            </span>
                            <div className="p-3 rounded bg-[#0A0D12] border border-border space-y-1.5 text-text">
                              <div className="flex items-center gap-2">
                                <span className="text-text-muted shrink-0 w-32">Queried Name:</span>
                                <span className="text-text font-semibold select-all">{evt.path}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-text-muted shrink-0 w-32">Record Type:</span>
                                <span className="text-text font-mono">{evt.query === '1' ? 'A (Type 1)' : `Type ${evt.query || '1'}`}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-text-muted shrink-0 w-32">Client Remote:</span>
                                <span className="text-text font-mono">{evt.remote}</span>
                              </div>
                              <div className="text-[10px] text-text-muted pt-1 border-t border-border/30">
                                <span>Note: A-record-only raw DNS query, no recursion / DNSSEC.</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Redacted Headers Table */}
                            <div className="space-y-1.5">
                              <span className="text-[10px] text-text-muted uppercase tracking-wider block">
                                HTTP Request Headers (Redacted)
                              </span>
                              <div className="p-3 rounded bg-[#0A0D12] border border-border max-h-48 overflow-y-auto space-y-1">
                                {Object.entries(redactedHeaders).map(([k, v]) => (
                                  <div key={k} className="flex items-start gap-2">
                                    <span className="text-text-muted shrink-0 w-36 truncate">{k}:</span>
                                    <span className={v === '«redacted»' ? 'text-warning' : 'text-text truncate select-all'}>
                                      {v}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Request Body */}
                            {evt.body && (
                              <div className="space-y-1.5">
                                <span className="text-[10px] text-text-muted uppercase tracking-wider block">
                                  Request Body ({evt.body.length} bytes)
                                </span>
                                <pre className="p-3 rounded bg-[#0A0D12] border border-border text-text whitespace-pre-wrap max-h-48 overflow-y-auto select-all">
                                  {evt.body}
                                </pre>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
