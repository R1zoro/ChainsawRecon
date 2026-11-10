/**
 * Native folder picker with fallback for web browser development.
 */

declare global {
  interface Window {
    __TAURI__?: {
      dialog?: {
        open?: (options: { directory?: boolean; multiple?: boolean; title?: string }) => Promise<string | null>;
      };
    };
  }
}

interface DirectoryInput extends HTMLInputElement {
  webkitdirectory: boolean;
  directory: boolean;
}

export async function pickFolder(title = 'Select Workspace Folder'): Promise<string | null> {
  // Check if running inside desktop Tauri runtime
  if (window.__TAURI__?.dialog?.open) {
    try {
      const selected = await window.__TAURI__.dialog.open({
        directory: true,
        multiple: false,
        title,
      });
      return selected;
    } catch (err) {
      console.warn('[pickFolder] Tauri dialog open failed, falling back to browser picker', err);
    }
  }

  // Web Browser fallback: development-only simulation when running in browser without Tauri runtime
  return new Promise((resolve) => {
    const input = document.createElement('input') as DirectoryInput;
    input.type = 'file';
    input.webkitdirectory = true;
    input.directory = true;

    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        // In browser sandbox, files have relative path, construct clean simulated path for development
        const file = target.files[0];
        const relativePath = file.webkitRelativePath || file.name;
        const folderName = relativePath.split('/')[0] || 'workspace';
        resolve(`C:/engagements/${folderName}`);
      } else {
        resolve(null);
      }
    };

    input.oncancel = () => {
      resolve(null);
    };

    input.click();
  });
}
