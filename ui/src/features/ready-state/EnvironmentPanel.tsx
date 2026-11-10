import React from 'react';
import { Server, Wrench, Key, Box, AlertTriangle, ArrowRight } from 'lucide-react';
import { EnvironmentHealth } from '../../api/types';

interface EnvironmentPanelProps {
  environment?: EnvironmentHealth;
  onNavigateTo?: (section: string) => void;
}

export const EnvironmentPanel: React.FC<EnvironmentPanelProps> = ({
  environment,
  onNavigateTo,
}) => {
  if (!environment) return null;

  const { providers, toolPacks, authProfiles, sandbox, warnings } = environment;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text text-sm tracking-tight flex items-center gap-2">
          <Server className="w-4 h-4 text-accent" />
          Environment & Subsystems
        </h3>
        <span className="text-[11px] font-mono text-text-muted">Host: loopback</span>
      </div>

      {/* Subsystem Counts Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        {/* Providers */}
        <div 
          onClick={() => onNavigateTo?.('models')}
          className="bg-bg/60 p-2.5 rounded border border-border/60 hover:border-accent/40 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-text-muted mb-1">
            <span className="text-[10px] uppercase">Providers</span>
            <Server className="w-3.5 h-3.5 group-hover:text-accent transition-colors" />
          </div>
          <div className="text-text font-semibold flex items-center gap-1.5">
            <span className="text-success">{providers.healthy}</span>
            <span className="text-text-muted">/</span>
            <span className="text-warning">{providers.degraded}</span>
            <span className="text-text-muted">/</span>
            <span className="text-danger">{providers.unavailable}</span>
          </div>
          <span className="text-[10px] text-text-muted/70 block mt-0.5">
            {providers.healthy + providers.degraded} active
          </span>
        </div>

        {/* Tool Packs */}
        <div 
          onClick={() => onNavigateTo?.('tools')}
          className="bg-bg/60 p-2.5 rounded border border-border/60 hover:border-accent/40 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-text-muted mb-1">
            <span className="text-[10px] uppercase">Tool Packs</span>
            <Wrench className="w-3.5 h-3.5 group-hover:text-accent transition-colors" />
          </div>
          <div className="text-text font-semibold">
            <span>{toolPacks.installed}</span>
            <span className="text-text-muted"> / {toolPacks.total}</span>
          </div>
          <span className="text-[10px] text-text-muted/70 block mt-0.5">
            {toolPacks.installed === toolPacks.total ? 'all verified' : `${toolPacks.total - toolPacks.installed} missing`}
          </span>
        </div>

        {/* Auth Profiles */}
        <div 
          onClick={() => onNavigateTo?.('identities')}
          className="bg-bg/60 p-2.5 rounded border border-border/60 hover:border-accent/40 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-text-muted mb-1">
            <span className="text-[10px] uppercase">Auth Profiles</span>
            <Key className="w-3.5 h-3.5 group-hover:text-accent transition-colors" />
          </div>
          <div className="text-text font-semibold">
            <span className="text-success">{authProfiles.active}</span>
            <span className="text-text-muted"> active</span>
          </div>
          <span className="text-[10px] text-text-muted/70 block mt-0.5">
            {authProfiles.expired > 0 ? `${authProfiles.expired} expired` : 'clean sessions'}
          </span>
        </div>

        {/* Sandbox */}
        <div className="bg-bg/60 p-2.5 rounded border border-border/60">
          <div className="flex items-center justify-between text-text-muted mb-1">
            <span className="text-[10px] uppercase">Sandbox</span>
            <Box className="w-3.5 h-3.5 text-accent" />
          </div>
          <div className="text-text font-semibold capitalize">
            {sandbox === 'native' ? (
              <span className="text-accent">Native OS</span>
            ) : sandbox === 'docker' ? (
              <span className="text-success">Docker isolated</span>
            ) : (
              <span className="text-danger">Unavailable</span>
            )}
          </div>
          <span className="text-[10px] text-text-muted/70 block mt-0.5">
            Docker: optional
          </span>
        </div>
      </div>

      {/* Actionable Warning Rows */}
      {warnings && warnings.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {warnings.map((warning, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-2 p-2 rounded bg-warning/10 border border-warning/30 text-warning text-xs font-sans"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{warning}</span>
              </div>
              <button
                onClick={() => onNavigateTo?.('models')}
                className="text-[11px] font-mono underline hover:text-text shrink-0 flex items-center gap-0.5"
              >
                Resolve <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
