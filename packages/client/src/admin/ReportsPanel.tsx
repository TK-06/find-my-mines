import {
  REPORT_KEEP_DAYS,
  REPORT_REASON_LABELS,
  type ModerationResult,
  type PlayerReport,
  type ReportParty,
  type ReportStatus,
} from '@fmm/shared';
import { useState } from 'react';
import { relativeTime } from '../data/format.js';

interface Props {
  reports: PlayerReport[];
  connected: boolean;
  /** Connection ids still connected: their Kick / Ban buttons work. */
  liveClientIds: ReadonlySet<string>;
  onStatus: (id: string, status: ReportStatus) => Promise<ModerationResult>;
  onKick: (clientId: string, nickname: string) => void;
  onBan: (clientId: string, nickname: string) => void;
}

/**
 * Player reports, sent from the Online now list. Open ones first; handled ones
 * fold away. Each says who, about whom, why and where, with every identifier
 * the server had for both connections — an account id is solid, a guest id or
 * an IP address only a hint (cookies clear; many people share one address).
 */
export function ReportsPanel({ reports, connected, liveClientIds, onStatus, onKick, onBan }: Props) {
  const [showHandled, setShowHandled] = useState(false);
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());

  const open = reports.filter((r) => r.status === 'open');
  const handled = reports.filter((r) => r.status !== 'open');
  const shown = showHandled ? [...open, ...handled] : open;

  async function setStatus(id: string, status: ReportStatus) {
    const result = await onStatus(id, status);
    setErrors((current) => {
      const next = new Map(current);
      if (result.ok) next.delete(id);
      else next.set(id, result.error ?? 'That did not work.');
      return next;
    });
  }

  return (
    <div className="card reports-panel">
      <div className="reports-head">
        <h3>
          Player reports <span className="tag">{open.length} open</span>
        </h3>
        {handled.length > 0 && (
          <button type="button" className="ghost small" onClick={() => setShowHandled((v) => !v)}>
            {showHandled ? 'Hide handled' : `Show ${handled.length} handled`}
          </button>
        )}
      </div>
      <p className="muted reports-note">
        Kept for {REPORT_KEEP_DAYS} days, then deleted. An account id is solid; a guest id or an IP address is only a
        hint.
      </p>

      {shown.length === 0 ? (
        <p className="muted">{open.length === 0 && handled.length > 0 ? 'Nothing open.' : 'No reports.'}</p>
      ) : (
        <ul className="list reports-list">
          {shown.map((report) => {
            const live = liveClientIds.has(report.target.clientId);
            return (
              <li key={report.id} className={`report-row status-${report.status}`}>
                <div className="report-top">
                  <span className="report-reason-tag">{REPORT_REASON_LABELS[report.reason]}</span>
                  <span className="muted">
                    {relativeTime(new Date(report.createdAt).toISOString())}
                    {report.roomId && (
                      <>
                        {' '}
                        · room <span className="room-code">{report.roomId}</span>
                      </>
                    )}
                  </span>
                  {report.status !== 'open' && <span className="tag">{report.status}</span>}
                </div>
                <p className="report-who">
                  <strong>{report.reporter.nickname}</strong> reported <strong>{report.target.nickname}</strong>
                  {!live && <span className="muted"> · no longer connected</span>}
                </p>
                {report.details && <p className="report-details">“{report.details}”</p>}
                <dl className="report-ids">
                  <Party label="Reported" party={report.target} />
                  <Party label="By" party={report.reporter} />
                </dl>
                {errors.get(report.id) && <p className="form-error">{errors.get(report.id)}</p>}
                <div className="client-actions report-actions">
                  {report.status === 'open' ? (
                    <>
                      <button type="button" className="small" disabled={!connected} onClick={() => void setStatus(report.id, 'resolved')}>
                        Resolve
                      </button>
                      <button
                        type="button"
                        className="ghost small"
                        disabled={!connected}
                        onClick={() => void setStatus(report.id, 'dismissed')}
                      >
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button type="button" className="ghost small" disabled={!connected} onClick={() => void setStatus(report.id, 'open')}>
                      Reopen
                    </button>
                  )}
                  {live && (
                    <>
                      <button
                        type="button"
                        className="ghost small"
                        disabled={!connected}
                        onClick={() => onKick(report.target.clientId, report.target.nickname)}
                      >
                        Kick {report.target.nickname}
                      </button>
                      <button
                        type="button"
                        className="danger small"
                        disabled={!connected}
                        onClick={() => onBan(report.target.clientId, report.target.nickname)}
                      >
                        Ban
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** First 8 characters: enough to match one report with another by eye. */
const short = (id: string | null) => (id ? id.slice(0, 8) : '—');

function Party({ label, party }: { label: string; party: ReportParty }) {
  return (
    <div className="report-party">
      <dt>{label}</dt>
      <dd>
        {party.isGuest ? 'guest' : 'account'} {party.profileId && <code title={party.profileId}>acct {short(party.profileId)}</code>}{' '}
        {party.guestId && <code title={`Guest cookie id ${party.guestId}`}>cookie {short(party.guestId)}</code>}{' '}
        {party.sessionId && <code title={party.sessionId}>tab {short(party.sessionId)}</code>} <code>{party.address}</code>
      </dd>
    </div>
  );
}
