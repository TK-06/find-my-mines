import {
  MAX_REMARK_LENGTH,
  REMOVAL_REASONS,
  REMOVAL_REASON_LABELS,
  parseRemovalNote,
  type ModerationResult,
  type RemovalNote,
  type RemovalReason,
} from '@fmm/shared';
import { useEffect, useState } from 'react';

interface Props {
  /** e.g. "Kick Bob?" */
  title: string;
  /** What happens to them, in one line. */
  consequence: string;
  confirmLabel: string;
  /** Resolves with the server's answer; the dialog closes only on success. */
  onConfirm: (note: RemovalNote) => Promise<ModerationResult>;
  onClose: () => void;
}

/**
 * Why someone is being removed. Used by the room host and the server console
 * alike, and what is typed here is shown to the removed player.
 *
 * The same validator the server runs decides when Confirm is enabled, so the
 * button never offers something the server would refuse.
 */
export function ReasonDialog({ title, consequence, confirmLabel, onConfirm, onClose }: Props) {
  const [reasons, setReasons] = useState<RemovalReason[]>([]);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseRemovalNote({ reasons, remark });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (reason: RemovalReason) =>
    setReasons((current) =>
      current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason],
    );

  async function confirm() {
    if (!parsed.ok) return;
    setBusy(true);
    setError(null);
    const result = await onConfirm(parsed.note);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error ?? 'That did not work.');
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="reason-title">
      <form
        className="card reason-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <h2 id="reason-title">{title}</h2>
        <p className="muted">{consequence}</p>

        <fieldset className="reason-list">
          <legend className="field-label">Why? They will see this.</legend>
          {REMOVAL_REASONS.map((reason, index) => (
            <label key={reason} className="checkbox">
              <input
                type="checkbox"
                autoFocus={index === 0}
                checked={reasons.includes(reason)}
                onChange={() => toggle(reason)}
              />
              {REMOVAL_REASON_LABELS[reason]}
            </label>
          ))}
        </fieldset>

        <label className="field-label" htmlFor="remark">
          Remarks (optional)
        </label>
        <textarea
          id="remark"
          value={remark}
          maxLength={MAX_REMARK_LENGTH}
          rows={3}
          placeholder="Anything they should know"
          onChange={(e) => setRemark(e.target.value)}
        />
        <div className="muted remark-count">
          {remark.length}/{MAX_REMARK_LENGTH}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="result-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="danger" disabled={!parsed.ok || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
