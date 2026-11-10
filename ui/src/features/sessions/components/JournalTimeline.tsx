import React, { useRef, useEffect, useState, useMemo } from 'react';
import { 
  PlayCircle, Brain, Terminal, Eye, FileCheck, 
  Bug, AlertOctagon, MessageSquare, AlertCircle, 
  ArrowDown, Search, Filter, CheckSquare, Cpu 
} from 'lucide-react';
import { JournalEvent } from '../../../api/types';
import { eventView, EventFamily } from '../eventView';

interface JournalTimelineProps {
  events: JournalEvent[];
  selectedEvent: JournalEvent | null;
  onSelectEvent: (event: JournalEvent) => void;
}

export const JournalTimeline: React.FC<JournalTimelineProps> = ({
  events,
  selectedEvent,
  onSelectEvent,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [filterFamily, setFilterFamily] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false);
  const [newEventsCount, setNewEventsCount] = useState<number>(0);
  const prevEventsLengthRef = useRef(events.length);

  // Scroll detection
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const scrolledUp = distanceFromBottom > 80;
    setIsScrolledUp(scrolledUp);
    if (!scrolledUp) {
      setNewEventsCount(0);
    }
  };

  // Safe auto-scroll or track unread new events
  useEffect(() => {
    if (events.length > prevEventsLengthRef.current) {
      const added = events.length - prevEventsLengthRef.current;
      if (isScrolledUp) {
        setNewEventsCount((prev) => prev + added);
      } else {
        scrollToBottom();
      }
    }
    prevEventsLengthRef.current = events.length;
  }, [events.length, isScrolledUp]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      const el = containerRef.current;
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: 'smooth',
        });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      setIsScrolledUp(false);
      setNewEventsCount(0);
    }
  };

  // Filter events by normalized family and search query
  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      const view = eventView(evt);
      if (filterFamily !== 'all' && view.family !== filterFamily) {
        return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const typeMatch = evt.type.toLowerCase().includes(query);
        const actorMatch = evt.actor.toLowerCase().includes(query);
        const titleMatch = view.title.toLowerCase().includes(query);
        const summaryMatch = view.summary.toLowerCase().includes(query);
        const dataMatch = JSON.stringify(evt.data || {}).toLowerCase().includes(query);
        return typeMatch || actorMatch || titleMatch || summaryMatch || dataMatch;
      }

      return true;
    });
  }, [events, filterFamily, searchQuery]);

  const renderEventIcon = (family: EventFamily) => {
    switch (family) {
      case 'decision':
        return <Brain className="w-3.5 h-3.5 text-accent" />;
      case 'action':
        return <Terminal className="w-3.5 h-3.5 text-text" />;
      case 'observation':
        return <Eye className="w-3.5 h-3.5 text-text-muted" />;
      case 'evidence':
        return <FileCheck className="w-3.5 h-3.5 text-success" />;
      case 'finding':
        return <Bug className="w-3.5 h-3.5 text-danger" />;
      case 'approval':
        return <AlertOctagon className="w-3.5 h-3.5 text-warning" />;
      case 'task':
        return <CheckSquare className="w-3.5 h-3.5 text-accent" />;
      case 'message':
        return <MessageSquare className="w-3.5 h-3.5 text-accent" />;
      case 'session':
        return <PlayCircle className="w-3.5 h-3.5 text-accent" />;
      case 'context':
        return <Cpu className="w-3.5 h-3.5 text-text-muted" />;
      default:
        return <AlertCircle className="w-3.5 h-3.5 text-text-muted" />;
    }
  };

  const getEventBorderClass = (family: EventFamily, isSelected: boolean) => {
    if (isSelected) return 'border-accent bg-surface-2 ring-1 ring-accent';
    switch (family) {
      case 'finding':
        return 'border-danger/40 bg-danger/5 hover:border-danger';
      case 'evidence':
        return 'border-success/40 bg-success/5 hover:border-success';
      case 'approval':
        return 'border-warning/40 bg-warning/5 hover:border-warning';
      case 'message':
        return 'border-accent/30 bg-accent/5 hover:border-accent';
      case 'decision':
        return 'border-purple-500/30 bg-purple-500/5 hover:border-purple-400';
      default:
        return 'border-border bg-surface hover:border-border-hover';
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-bg overflow-hidden relative font-sans">
      {/* Filter by Family and Search Bar */}
      <div className="border-b border-border bg-surface/60 px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          {[
            { id: 'all', label: 'All' },
            { id: 'decision', label: 'Decisions' },
            { id: 'action', label: 'Actions' },
            { id: 'observation', label: 'Observations' },
            { id: 'evidence', label: 'Evidence' },
            { id: 'finding', label: 'Findings' },
            { id: 'approval', label: 'Approvals' },
            { id: 'task', label: 'Tasks' },
            { id: 'message', label: 'Messages' },
          ].map((tab) => (
            <button
              key={tab.id}
              data-testid={`filter-${tab.id}`}
              onClick={() => setFilterFamily(tab.id)}
              className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                filterFamily === tab.id
                  ? 'bg-surface-2 text-text font-medium border border-border'
                  : 'text-text-muted hover:text-text hover:bg-surface-2/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative max-w-xs w-full sm:w-60">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter journal..."
            className="w-full pl-8 pr-3 py-1 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Timeline Scroll Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3 font-mono"
      >
        {filteredEvents.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-text-muted text-xs space-y-2">
            <Filter className="w-6 h-6 opacity-40" />
            <p>No journal events matching current filter.</p>
          </div>
        ) : (
          filteredEvents.map((event) => {
            const isSelected = selectedEvent?.seq === event.seq;
            const view = eventView(event);

            return (
              <div
                key={event.seq}
                onClick={() => onSelectEvent(event)}
                className={`p-3 rounded-lg border transition-all cursor-pointer space-y-1.5 ${getEventBorderClass(
                  view.family,
                  isSelected
                )}`}
              >
                {/* Event Header */}
                <div className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2">
                    {renderEventIcon(view.family)}
                    <span className="font-semibold text-text text-xs tracking-tight">
                      {event.type}
                    </span>
                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg/80 border border-border">
                      {event.actor}
                    </span>
                    {event.turn !== null && event.turn !== undefined && (
                      <span className="text-[10px] text-text-muted">
                        T{event.turn}:{event.step ?? 0}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-text-muted shrink-0">
                    <span className="font-mono text-text-muted/80">#{event.seq}</span>
                    <span>{new Date(event.ts).toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* Event Content View */}
                <div className="text-xs text-text leading-relaxed font-sans pl-5">
                  {view.family === 'decision' && (
                    <div className="space-y-0.5 font-mono text-[11px]">
                      <div className="text-text">{view.rationale || view.summary}</div>
                      {Boolean(view.nextAction) && (
                        <div className="text-accent text-[11px]">
                          &rarr; {view.nextAction}
                        </div>
                      )}
                      {Boolean(view.alternatives && view.alternatives.length > 0) && (
                        <div className="text-[10px] text-text-muted pt-0.5">
                          Alternatives: {view.alternatives?.join(', ')}
                        </div>
                      )}
                    </div>
                  )}

                  {view.family === 'action' && (
                    <div className="font-mono text-[11px] flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-surface-2 text-text font-semibold">
                        {view.method || 'EXEC'}
                      </span>
                      <span className="text-accent truncate">
                        {view.endpoint || view.summary}
                      </span>
                      {Boolean(view.status) && (
                        <span className="text-text-muted text-[10px] ml-auto">
                          {view.status}
                        </span>
                      )}
                    </div>
                  )}

                  {view.family === 'observation' && (
                    <div className="font-mono text-[11px] space-y-0.5 text-text-muted">
                      {Boolean(view.status) && (
                        <span className="text-success font-semibold mr-2">
                          Status {view.status}
                        </span>
                      )}
                      <span className="truncate">{view.summary}</span>
                    </div>
                  )}

                  {view.family === 'message' && (
                    <div className="text-text font-sans bg-accent/10 border border-accent/20 p-2 rounded text-xs">
                      {view.summary}
                    </div>
                  )}

                  {view.family === 'evidence' && (
                    <div className="font-mono text-[11px] text-success space-y-0.5">
                      <div>{view.title}</div>
                      <div className="text-text text-[11px]">{view.summary}</div>
                      {Boolean(view.hash) && (
                        <div className="text-[10px] text-text-muted truncate">
                          Chain: {view.hash}
                        </div>
                      )}
                    </div>
                  )}

                  {view.family === 'finding' && (
                    <div className="font-mono text-[11px] text-danger space-y-0.5">
                      <div className="font-semibold">{view.title}</div>
                      <div className="text-[10px] text-text-muted flex items-center gap-2">
                        <span className="uppercase px-1 rounded bg-danger/20 text-danger font-semibold">
                          {view.severity}
                        </span>
                        <span>State: {view.status}</span>
                      </div>
                    </div>
                  )}

                  {view.family === 'approval' && (
                    <div className="font-mono text-[11px] text-warning space-y-0.5">
                      <div className="font-semibold">{view.title}</div>
                      <div className="text-text text-[11px]">{view.summary}</div>
                      <div className="text-[10px] text-text-muted flex items-center gap-2">
                        <span>Risk: {view.severity}</span>
                        <span>Status: {view.status}</span>
                      </div>
                    </div>
                  )}

                  {view.family === 'task' && (
                    <div className="font-mono text-[11px] text-text space-y-0.5">
                      <div className="font-semibold">{view.title}</div>
                      <div className="text-[10px] text-text-muted">
                        Status: <span className="text-accent">{view.status}</span>
                        {view.endpoint && ` on ${view.endpoint}`}
                      </div>
                    </div>
                  )}

                  {view.family === 'session' && (
                    <div className="font-mono text-[11px] text-text-muted">
                      {view.summary}
                    </div>
                  )}

                  {view.family === 'context' && (
                    <div className="font-mono text-[11px] text-text-muted">
                      {view.summary}
                    </div>
                  )}

                  {view.family === 'generic' && (
                    <div className="font-mono text-[11px] text-text-muted truncate">
                      {view.summary}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Jump to Latest Button (Subtle slide/fade transition, no bounce) */}
      {isScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-[#0D1015] shadow-lg hover:bg-accent-hover font-mono text-xs font-medium transition-transform duration-200 ease-out"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>Jump to latest {newEventsCount > 0 ? `(${newEventsCount} new)` : ''}</span>
        </button>
      )}
    </div>
  );
};
