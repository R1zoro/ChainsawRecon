import React from 'react';
import { Shield, Terminal } from 'lucide-react';
import { ConnectionState } from '../../../api/events';

interface SessionStatusBarProps {
  connectionState: ConnectionState;
  lastSeq: number;
  sandbox?: string;
  elapsedSeconds?: number;
  scopeValid?: boolean | null;
}

export const SessionStatusBar: React.FC<SessionStatusBarProps> = ({
  connectionState,
  lastSeq,
  sandbox = 'native',
  elapsedSeconds = 0,
  scopeValid = null,
}) => {
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const getConnectionDot = () => {
    switch (connectionState) {
      case 'connected':
        return <span className="w-2 h-2 rounded-full bg-success" />;
      case 'connecting':
      case 'reconnecting':
        return <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-danger" />;
    }
  };

  return (
    <footer className="h-7 border-t border-border bg-surface px-4 flex items-center justify-between text-[11px] font-mono text-text-muted shrink-0 select-none">
      {/* Left: Connection State & Last Seq */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          {getConnectionDot()}
          <span className="capitalize">{connectionState}</span>
        </div>

        <div className="flex items-center gap-1">
          <span>Seq:</span>
          <span className="text-text font-semibold">#{lastSeq}</span>
        </div>
      </div>

      {/* Right: Sandbox, Scope, Time */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3 h-3 text-text-muted" />
          <span>Sandbox:</span>
          <span className="text-text">{sandbox}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Shield className={`w-3 h-3 ${scopeValid === true ? 'text-success' : scopeValid === false ? 'text-danger' : 'text-text-muted'}`} />
          {scopeValid === true ? (
            <span className="text-success font-medium">Scope Enforced</span>
          ) : scopeValid === false ? (
            <span className="text-danger font-medium">Scope Invalid</span>
          ) : (
            <span className="text-text-muted font-normal">Scope: Unknown</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span>Elapsed:</span>
          <span className="text-text">{formatTime(elapsedSeconds)}</span>
        </div>
      </div>
    </footer>
  );
};
