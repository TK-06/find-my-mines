import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  parseReport,
  type ModerationResult,
  type ReportReason,
} from '@fmm/shared';
import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  /** Who is being reported: their connection id, for the server, and their name, for the title. */
  targetId: string;
  targetName: string;
  /** Resolves with the server's answer. */
  onSend: (reason: ReportReason, details: string) => Promise<ModerationResult>;
  onClose: () => void;
}

/**
 * Report a player to the server's admins: a reason, optional details, Send.
 * The same parser the server runs decides when Send is enabled, so the button
 * never offers something the server would refuse. After sending it says so,
 * and that it reached the admins — not that anything has been done yet.
 */
export function ReportDialog({ targetId, targetName, onSend, onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const titleId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);

  const parsed = parseReport({ targetId, reason, details });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);

  async function send() {
    if (!parsed.ok || busy) return;
    setBusy(true);
    setError(null);
    const result = await onSend(parsed.reason, parsed.details);
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error ?? 'That did not work.');
  }

  if (sent) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="card report-dialog report-sent">
          <span className="report-sent-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <h2 id={titleId}>Report sent</h2>
          <p className="muted">Thanks. The admins see it on the server console.</p>
          <div className="result-actions">
            <button ref={doneRef} type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        className="card report-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <h2 id={titleId}>Report {targetName}</h2>
        <p className="muted">
          The admins see the report with the room and the time. {targetName} isn’t told who sent it.
        </p>

        <fieldset className="report-reasons">
          <legend className="field-label">What happened?</legend>
          {REPORT_REASONS.map((value, index) => (
            <label key={value} className={`report-reason${reason === value ? ' chosen' : ''}`}>
              <input
                type="radio"
                name="report-reason"
                value={value}
                autoFocus={index === 0}
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {REPORT_REASON_LABELS[value]}
            </label>
          ))}
        </fieldset>

        <label className="field-label" htmlFor={`${titleId}-details`}>
          {reason === 'other' ? 'Details' : 'Details (optional)'}
        </label>
        <textarea
          id={`${titleId}-details`}
          value={details}
          maxLength={REPORT_DETAILS_MAX}
          rows={3}
          placeholder={reason === 'other' ? 'Say what happened' : 'Anything that helps the admins'}
          onChange={(event) => setDetails(event.target.value)}
        />
        <div className="muted remark-count">
          {details.length}/{REPORT_DETAILS_MAX}
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="result-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="danger" disabled={!parsed.ok || busy}>
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </div>
  );
}
