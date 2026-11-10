import { useEffect } from 'react';

interface ShortcutHandlers {
  onNewEngagement?: () => void;
  onOpenFolder?: () => void;
  onResumeSession?: () => void;
  onCommandPalette?: () => void;
}

export function useKeyboardShortcuts({
  onNewEngagement,
  onOpenFolder,
  onResumeSession,
  onCommandPalette,
}: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onCommandPalette?.();
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          onNewEngagement?.();
          break;
        case 'o':
          e.preventDefault();
          onOpenFolder?.();
          break;
        case 'r':
          e.preventDefault();
          onResumeSession?.();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNewEngagement, onOpenFolder, onResumeSession, onCommandPalette]);
}
