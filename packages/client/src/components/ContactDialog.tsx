import { useEffect, useRef, type ReactNode } from 'react';
import { CONTACT_EMAIL, contactMailto } from '../data/policies.js';
import { LineIcon } from './LineIcon.js';

const TOPICS: { label: string; icon: ReactNode }[] = [
  {
    label: 'Question',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9.2a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4.3" />
        <path d="M12 17.5h.01" />
      </>
    ),
  },
  {
    label: 'Feedback',
    icon: <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  },
  {
    label: 'Bug report',
    icon: (
      <>
        <rect x="7" y="8" width="10" height="12" rx="5" />
        <path d="M9 8a3 3 0 0 1 6 0" />
        <path d="M12 12v8" />
        <path d="M3 14h4M17 14h4M4 8.5l3 2M20 8.5l-3 2M4 20l3-2M20 20l-3-2" />
      </>
    ),
  },
  {
    label: 'Account help',
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  },
  {
    label: 'Course & team',
    icon: (
      <>
        <path d="m2 9 10-5 10 5-10 5z" />
        <path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
        <path d="M22 9v6" />
      </>
    ),
  },
  {
    label: 'Other',
    icon: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
  },
];

/**
 * "Contact": one email address, and a button per kind of message that opens
 * the player's mail app with the subject filled in.
 *
 * Focus moves into the dialog when it opens, stays inside it while it is open,
 * and goes back to whatever opened it when it closes.
 */
export function ContactDialog({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      // Keep Tab inside the dialog: the page behind it is inert while it is open.
      const focusable = cardRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const inside = cardRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-title"
      aria-describedby="contact-intro"
      // Only a click on the backdrop itself closes; clicks inside the card bubble here too.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card contact-dialog" ref={cardRef}>
        <button ref={closeRef} type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>

        <h2 id="contact-title">Contact</h2>
        <p id="contact-intro">
          Questions, ideas or bugs — email us at <strong>{CONTACT_EMAIL}</strong>. Each button below
          opens your mail app with the subject already filled in.
        </p>
        <p className="muted">
          No need to email to change your name — you can do that yourself on your profile page.
        </p>

        <ul className="contact-grid">
          {TOPICS.map((topic) => (
            <li key={topic.label}>
              <a className="contact-option" href={contactMailto(topic.label)}>
                <LineIcon size={20}>{topic.icon}</LineIcon>
                {topic.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
