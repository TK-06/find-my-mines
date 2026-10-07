import type { KeyboardEvent } from 'react';
import { ADMIN_TABS, adminPanelId, adminTabId, type AdminTab } from './adminTab.js';

/**
 * The console's tab bar, marked up as an ARIA tablist: only the open tab is in
 * the Tab order, and the arrow keys (Home and End too) move between the tabs,
 * the way a native tab control behaves. Each tab names its panel with
 * aria-controls; the panel names the tab back (see AdminConsole).
 */
export function AdminTabs({ tab, onSelect }: { tab: AdminTab; onSelect: (next: AdminTab) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // From the tab that has focus: the selection follows the hash, a moment later.
    const at = ADMIN_TABS.findIndex((item) => adminTabId(item.key) === (event.target as HTMLElement).id);
    if (at < 0) return;
    const last = ADMIN_TABS.length - 1;
    const to =
      event.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
      : event.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1;
    if (to < 0) return;
    event.preventDefault();
    const next = ADMIN_TABS[to]!.key;
    onSelect(next);
    // Focus follows the selection, so the next arrow key starts from the new tab.
    document.getElementById(adminTabId(next))?.focus();
  };

  return (
    <div className="admin-tabs" role="tablist" aria-label="Console sections" onKeyDown={onKeyDown}>
      {ADMIN_TABS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={adminTabId(key)}
          aria-selected={tab === key}
          aria-controls={adminPanelId(key)}
          tabIndex={tab === key ? 0 : -1}
          onClick={() => onSelect(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
