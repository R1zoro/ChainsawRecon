import React from 'react';
import { useNavigate } from 'react-router-dom';

export const TopMenuBar: React.FC = () => {
  const navigate = useNavigate();

  const handleMenuClick = (menu: string) => {
    switch (menu.toLowerCase()) {
      case 'file':
        navigate('/engagements/new');
        break;
      case 'workbench':
        navigate('/workbench');
        break;
      case 'models':
        navigate('/models');
        break;
      case 'tools':
        navigate('/tools');
        break;
      case 'view':
      case 'help':
      case 'docs':
      default:
        navigate('/settings');
        break;
    }
  };

  const menus = ['File', 'Workbench', 'View', 'Models', 'Tools', 'Help', 'Docs'];

  return (
    <div className="border-b border-border/60 bg-bg text-[11px] font-mono text-text-muted px-6 py-1 flex items-center gap-4">
      {menus.map((menu) => (
        <button
          key={menu}
          onClick={() => handleMenuClick(menu)}
          className="hover:text-text hover:bg-surface-2 px-1.5 py-0.5 rounded transition-colors"
        >
          {menu}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-3 text-[10px]">
        <button
          onClick={() => navigate('/settings')}
          className="hover:text-text text-text-muted transition-colors flex items-center gap-1"
        >
          <span>Policy:</span>
          <strong className="text-warning font-normal underline">Unconfigured &rarr;</strong>
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="hover:text-text text-text-muted transition-colors flex items-center gap-1"
        >
          <span>Scope:</span>
          <strong className="text-accent font-normal underline">Local boundaries &rarr;</strong>
        </button>
      </div>
    </div>
  );
};
