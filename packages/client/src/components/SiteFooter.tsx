import { useState, type ReactNode } from 'react';
import { RouteLink, type Route } from '../router.js';
import type { Theme } from '../theme.js';
import { APP_VERSION, RELEASE_URL, REPO_URL } from '../version.js';
import { ContactDialog } from './ContactDialog.js';
import { LineIcon } from './LineIcon.js';

const POLICY_LINKS: { to: Route; label: string; icon: ReactNode }[] = [
  {
    to: 'terms',
    label: 'terms',
    icon: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </>
    ),
  },
  {
    to: 'security',
    label: 'security',
    icon: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  },
  {
    to: 'privacy',
    label: 'privacy',
    icon: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
];

/**
 * The quiet line at the bottom of every page: contact, source, policies on
 * the left; the theme switch and the running version on the right.
 */
export function SiteFooter({
  route,
  onNavigate,
  theme,
  onToggleTheme,
}: {
  route: Route;
  onNavigate: (next: Route) => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [contactOpen, setContactOpen] = useState(false);
  // The label names the theme the button switches to, as the old header button did.
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <>
      <footer className="site-footer">
        <nav className="footer-group footer-links" aria-label="About this site">
          <button
            type="button"
            className="footer-link"
            aria-haspopup="dialog"
            onClick={() => setContactOpen(true)}
          >
            <LineIcon>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </LineIcon>
            contact
          </button>
          <a className="footer-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <LineIcon>
              <path d="m8 7-5 5 5 5" />
              <path d="m16 7 5 5-5 5" />
            </LineIcon>
            github
          </a>
          {POLICY_LINKS.map((link) => (
            <RouteLink
              key={link.to}
              to={link.to}
              current={route}
              onNavigate={onNavigate}
              className="footer-link"
            >
              <LineIcon>{link.icon}</LineIcon>
              {link.label}
            </RouteLink>
          ))}
        </nav>

        <div className="footer-group footer-meta">
          <button
            type="button"
            className="footer-link"
            onClick={onToggleTheme}
            title={`Switch to the ${next} theme`}
          >
            <LineIcon>
              {next === 'light' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </>
              ) : (
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
              )}
            </LineIcon>
            {next}
          </button>
          <a
            className="footer-link"
            href={RELEASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Release notes on GitHub"
          >
            <LineIcon>
              <circle cx="6" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" />
              <circle cx="18" cy="8" r="2" />
              <path d="M6 8v8" />
              <path d="M18 10c0 4-6 3-10 6" />
            </LineIcon>
            v{APP_VERSION}
          </a>
        </div>
      </footer>

      {/* Outside the footer, so none of its quiet text styling reaches the dialog. */}
      {contactOpen && <ContactDialog onClose={() => setContactOpen(false)} />}
    </>
  );
}
