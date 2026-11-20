import React from 'react';
import { 
  Key, Shield, AlertTriangle, 
  Clock, Globe, LogIn, LogOut, Trash2, RefreshCw, User, Building 
} from 'lucide-react';
import { AuthProfile, AuthSessionState } from '../../../api/types';

interface AuthProfileCardProps {
  profile: AuthProfile;
  onLogin: (profile: AuthProfile, adapter: 'http_form' | 'browser') => void;
  onVerify: (profile: AuthProfile) => void;
  onLogout: (profile: AuthProfile) => void;
  onDelete: (profile: AuthProfile) => void;
  onRenew?: (profile: AuthProfile) => void;
  isVerifying?: boolean;
  isLoggingOut?: boolean;
  isRenewing?: boolean;
  isConflict?: boolean;
}

export const AuthProfileCard: React.FC<AuthProfileCardProps> = ({
  profile,
  onLogin,
  onVerify,
  onLogout,
  onDelete,
  onRenew,
  isVerifying = false,
  isLoggingOut = false,
  isRenewing = false,
  isConflict = false,
}) => {
  const isExpired = Boolean(profile.session?.expired || profile.session?.status === 'expired');
  const sessionStatus: AuthSessionState = isExpired ? 'expired' : (profile.session?.status || 'none');
  const isKeychainProtected = Boolean(profile.useKeychain || profile.session?.keychainProtected || profile.persistence === 'credentials');

  const getStatusBadge = (status: AuthSessionState) => {
    switch (status) {
      case 'active':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success border border-success/30">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span>Active</span>
          </span>
        );
      case 'needs_verification':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/15 text-warning border border-warning/30">
            <span className="w-2 h-2 rounded-full bg-warning" />
            <span>Needs Verification</span>
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-danger/15 text-danger border border-danger/30">
            <span className="w-2 h-2 rounded-full bg-danger" />
            <span>Failed</span>
          </span>
        );
      case 'authenticating':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-accent/15 text-accent border border-accent/30">
            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
            <span>Authenticating</span>
          </span>
        );
      case 'expired':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/15 text-warning border border-warning/30">
            <span className="w-2 h-2 rounded-full bg-warning/60" />
            <span>Expired</span>
          </span>
        );
      case 'none':
      default:
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-text-muted border border-border">
            <span className="w-2 h-2 rounded-full bg-text-muted/40" />
            <span>None</span>
          </span>
        );
    }
  };

  const formattedVerifiedAt = profile.session?.verifiedAt
    ? new Date(profile.session.verifiedAt).toLocaleString()
    : 'Never verified';

  return (
    <div 
      data-testid={`auth-card-${profile.id}`}
      className="rounded-lg border border-border bg-surface hover:border-border/80 transition-all p-5 flex flex-col justify-between space-y-4 shadow-sm"
    >
      {/* Top Header: Label, Identity, Status */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-accent shrink-0" />
              <h3 className="text-sm font-semibold text-text tracking-tight truncate">
                {profile.label}
              </h3>
            </div>
            <p className="text-xs text-text-muted font-mono mt-0.5 truncate">
              {profile.id}
            </p>
          </div>
          <div className="shrink-0">
            {getStatusBadge(sessionStatus)}
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs py-2 px-3 rounded bg-bg border border-border/60 font-mono">
          <div className="flex items-center gap-1.5 text-text-muted truncate">
            <User className="w-3.5 h-3.5 shrink-0 text-text-muted/70" />
            <span className="text-text truncate" title={profile.identity || 'Unspecified'}>
              {profile.identity || 'Unspecified'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-text-muted truncate">
            <Building className="w-3.5 h-3.5 shrink-0 text-text-muted/70" />
            <span className="text-text truncate" title={profile.tenant || 'Default tenant'}>
              {profile.tenant || 'Default tenant'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-text-muted truncate">
            <Shield className="w-3.5 h-3.5 shrink-0 text-text-muted/70" />
            <span className="text-text truncate">
              Role: <span className="text-accent">{profile.role || 'operator'}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-text-muted truncate">
            <Globe className="w-3.5 h-3.5 shrink-0 text-text-muted/70" />
            <span className="text-text truncate">
              Adapter: <span className="font-semibold">{profile.adapter}</span>
            </span>
          </div>
        </div>

        {/* Target Patterns & URLs */}
        <div className="space-y-1.5 text-xs">
          {profile.loginUrl && (
            <div className="flex items-center gap-2 text-text-muted font-mono text-[11px] truncate">
              <span className="w-16 shrink-0 text-text-muted/60">Login:</span>
              <span className="truncate text-text" title={profile.loginUrl}>{profile.loginUrl}</span>
            </div>
          )}
          {profile.verifyUrl && (
            <div className="flex items-center gap-2 text-text-muted font-mono text-[11px] truncate">
              <span className="w-16 shrink-0 text-text-muted/60">Verify:</span>
              <span className="truncate text-text" title={profile.verifyUrl}>{profile.verifyUrl}</span>
            </div>
          )}
          {profile.verifyIndicator && (
            <div className="flex items-center gap-2 text-text-muted font-mono text-[11px] truncate">
              <span className="w-16 shrink-0 text-text-muted/60">Indicator:</span>
              <span className="truncate text-success" title={profile.verifyIndicator}>
                {profile.verifyIndicator}
              </span>
            </div>
          )}
        </div>

        {/* Badges: Persistence, Session Details */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          <span className="px-2 py-0.5 rounded bg-surface-2 border border-border text-text-muted">
            Persistence: <span className="text-text font-medium">{profile.persistence}</span>
          </span>

          {isKeychainProtected && (
            <span 
              data-testid="keychain-badge"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text text-[10px]"
              title="Protected by OS keychain; credentials and secrets never exposed"
            >
              <Key className="w-3 h-3 text-accent" />
              <span>Protected by OS keychain</span>
            </span>
          )}

          {profile.session?.hasCookies && (
            <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border/80 text-text text-[10px]">
              Cookies saved
            </span>
          )}

          {profile.session?.hasStorageState && (
            <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border/80 text-text text-[10px]">
              Storage state saved
            </span>
          )}
        </div>

        {/* Last Verified */}
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted font-mono pt-1">
          <Clock className="w-3.5 h-3.5 text-text-muted/60 shrink-0" />
          <span>Last verified: {formattedVerifiedAt}</span>
        </div>

        {/* Session Warning Banner */}
        {profile.session?.warning && (
          <div className="p-2.5 rounded bg-warning/10 border border-warning/30 text-warning text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed font-sans">
              {profile.session.warning}
            </div>
          </div>
        )}
      </div>

      {/* Card Actions Bottom Toolbar */}
      <div className="pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isExpired ? (
            profile.persistence === 'credentials' && !isConflict ? (
              <button
                type="button"
                onClick={() => onRenew?.(profile)}
                disabled={isRenewing}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50"
                title="Renew session using stored credentials"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRenewing ? 'animate-spin' : ''}`} />
                <span>{isRenewing ? 'Renewing...' : 'Renew'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onLogin(profile, profile.adapter === 'browser' ? 'browser' : 'http_form')}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors"
                title="Session expired; log in again to acquire new session"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Log in again</span>
              </button>
            )
          ) : sessionStatus === 'active' || sessionStatus === 'needs_verification' ? (
            <>
              <button
                onClick={() => onVerify(profile)}
                disabled={isVerifying}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors disabled:opacity-50"
                title="Verify current session health"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin text-accent' : ''}`} />
                <span>Verify</span>
              </button>
              <button
                onClick={() => onLogout(profile)}
                disabled={isLoggingOut}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-2 hover:bg-danger/20 border border-border hover:border-danger/40 text-xs text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                title="Invalidate session and remove saved cookies"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onLogin(profile, 'http_form')}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors"
                title="Log in via automated HTTP form submission"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>HTTP Login</span>
              </button>
              <button
                onClick={() => onLogin(profile, 'browser')}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
                title="Launch visible Chromium browser for manual or 2FA login"
              >
                <Globe className="w-3.5 h-3.5 text-accent" />
                <span>Browser Login</span>
              </button>
            </>
          )}
        </div>

        <button
          onClick={() => onDelete(profile)}
          className="p-1.5 rounded hover:bg-danger/20 text-text-muted hover:text-danger border border-transparent hover:border-danger/30 transition-colors"
          title="Delete profile"
          aria-label="Delete profile"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
