import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

// ─── Types (mirroring backend response) ─────────────────────────────────────

interface HistoryEvent {
  id: string;
  eventType: string;
  eventDate: string;
  classification?: string | null;
  note?: string | null;
  actorEmail?: string | null;
  runId?: string | null;
  runMode?: string | null;
  runCleanupType?: string | null;
}

interface AnalysisAppearance {
  runId: string;
  ranAt: string;
  mode: string;
  cleanupType: string;
  classification: string;
  confidenceLevel: string;
  reasoning: string;
  actionStatus: string;
  actionedAt: string | null;
  actionedBy: string | null;
  actionNote: string | null;
  deltaCategory: string | null;
  previousClassification: string | null;
  matchTier: number;
}

interface SporadicFlagInfo {
  id: string;
  active: boolean;
  note: string;
  removalCount: number;
  lastRemovedAt: string | null;
  lastReappearedAt: string | null;
  flaggedBy: string;
  flaggedAt: string;
}

interface PriorExceptionInfo {
  justification: string;
  action: string;
  role: string;
}

interface UserHistoryData {
  userEmail: string;
  instanceName: string;
  events: HistoryEvent[];
  appearances: AnalysisAppearance[];
  sporadicFlag: SporadicFlagInfo | null;
  priorException: PriorExceptionInfo | null;
  totalAppearances: number;
  totalTimesActioned: number;
  totalTimesDeferred: number;
  firstSeen: string | null;
  lastSeen: string | null;
  systemId: string | null;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  userEmail: string;
  instanceName: string;
  fullName: string;
  classification: string;
  confidenceLevel: string;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function UserHistoryPanel({
  userEmail,
  instanceName,
  fullName,
  classification,
  confidenceLevel,
  onClose,
}: Props) {
  const [data, setData] = useState<UserHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Flag creation form state
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/user-history/${encodeURIComponent(userEmail)}/${encodeURIComponent(instanceName)}`,
      );
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? 'Failed to load history');
        return;
      }
      setData(await res.json());
    } catch {
      setError('Network error loading history');
    } finally {
      setLoading(false);
    }
  }, [userEmail, instanceName]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleCreateFlag = async () => {
    if (!flagNote.trim()) return;
    setFlagSubmitting(true);
    try {
      const res = await apiFetch('/api/sporadic-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemId: data?.systemId ?? '',
          instanceName,
          userEmail,
          userName: fullName,
          note: flagNote.trim(),
        }),
      });
      if (res.ok) {
        setShowFlagForm(false);
        setFlagNote('');
        fetchHistory(); // refresh panel
      }
    } finally {
      setFlagSubmitting(false);
    }
  };

  const handleDeactivateFlag = async (flagId: string) => {
    const res = await apiFetch(`/api/sporadic-flags/${flagId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    if (res.ok) fetchHistory();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: 460,
      maxWidth: '100vw',
      background: '#333',
      borderLeft: '1px solid #444',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
      zIndex: 900,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid #444',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{fullName}</div>
          <div style={{ fontSize: 12, color: '#a0a0a0', marginTop: 2, wordBreak: 'break-all' }}>{userEmail}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 3,
              background: '#3a3a3a', color: '#f0f0f0',
            }}>
              {classification}
            </span>
            <span className={`tag ${confidenceLevel}`} style={{ fontSize: 11 }}>
              {confidenceLevel}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', fontSize: 20, color: '#777',
            cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {loading && (
          <div style={{ textAlign: 'center', color: '#777', padding: 40 }}>Loading history...</div>
        )}

        {error && (
          <div style={{ color: '#ff6b6b', fontSize: 13, padding: 16 }}>{error}</div>
        )}

        {data && !loading && (
          <>
            {/* Status Flags */}
            {data.sporadicFlag?.active && (
              <div style={{
                padding: '10px 14px', borderRadius: 6, marginBottom: 12,
                background: '#3d3520', border: '1px solid #5a4a20',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ffc107' }}>
                  Temporary / Project-Based Access
                </div>
                <div style={{ fontSize: 12, color: '#ffc107', marginTop: 4 }}>{data.sporadicFlag.note}</div>
                <div style={{ fontSize: 11, color: '#ffc107', marginTop: 4 }}>
                  Flagged by {data.sporadicFlag.flaggedBy} on{' '}
                  {new Date(data.sporadicFlag.flaggedAt).toLocaleDateString()}
                  {data.sporadicFlag.removalCount > 0 && (
                    <> &middot; Removed {data.sporadicFlag.removalCount} time{data.sporadicFlag.removalCount !== 1 ? 's' : ''}</>
                  )}
                </div>
                <button
                  onClick={() => handleDeactivateFlag(data.sporadicFlag!.id)}
                  style={{
                    marginTop: 8, fontSize: 11, padding: '3px 10px', borderRadius: 3,
                    background: '#3a3a3a', border: '1px solid #5a4a20', color: '#ffc107', cursor: 'pointer',
                  }}
                >
                  Deactivate Flag
                </button>
              </div>
            )}

            {data.priorException && (
              <div style={{
                padding: '10px 14px', borderRadius: 6, marginBottom: 12,
                background: '#1e2a4a', border: '1px solid #3a4a6a',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7c93c3' }}>Prior Exception</div>
                <div style={{ fontSize: 12, color: '#a0a0a0', marginTop: 4 }}>{data.priorException.justification}</div>
                {data.priorException.role && (
                  <div style={{ fontSize: 11, color: '#7c93c3', marginTop: 2 }}>Role: {data.priorException.role}</div>
                )}
                <div style={{ fontSize: 11, color: '#7c93c3', marginTop: 2 }}>
                  Action: {data.priorException.action === 'keep_flag' ? 'Keep flagged' : 'Remove with confirmation'}
                </div>
              </div>
            )}

            {/* Flag as Temporary Access button */}
            {(!data.sporadicFlag || !data.sporadicFlag.active) && (
              <div style={{ marginBottom: 12 }}>
                {!showFlagForm ? (
                  <button
                    onClick={() => setShowFlagForm(true)}
                    style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 4,
                      background: '#3d3520', border: '1px solid #5a4a20', color: '#ffc107',
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    Flag as Temporary Access
                  </button>
                ) : (
                  <div style={{
                    padding: '10px 14px', borderRadius: 6,
                    background: '#3d3520', border: '1px solid #5a4a20',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#ffc107', marginBottom: 6 }}>
                      Flag as Temporary Access
                    </div>
                    <input
                      type="text"
                      placeholder="Reason (e.g. quarter-end AP reconciliation)"
                      value={flagNote}
                      onChange={(e) => setFlagNote(e.target.value)}
                      style={{
                        width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 4,
                        border: '1px solid #555', boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button
                        onClick={handleCreateFlag}
                        disabled={!flagNote.trim() || flagSubmitting}
                        style={{
                          fontSize: 11, padding: '4px 12px', borderRadius: 3,
                          background: flagNote.trim() ? '#f59e0b' : '#555',
                          border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {flagSubmitting ? 'Saving...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => { setShowFlagForm(false); setFlagNote(''); }}
                        style={{
                          fontSize: 11, padding: '4px 12px', borderRadius: 3,
                          background: '#3a3a3a', border: 'none', color: '#a0a0a0', cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Summary Stats */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16,
              padding: '10px 14px', background: '#2a2a2a', borderRadius: 6,
            }}>
              <StatItem label="Appearances" value={data.totalAppearances} />
              <StatItem label="Actioned" value={data.totalTimesActioned} />
              <StatItem label="Deferred" value={data.totalTimesDeferred} />
              {data.firstSeen && (
                <StatItem label="First seen" value={new Date(data.firstSeen).toLocaleDateString()} />
              )}
            </div>

            {/* Timeline */}
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#f0f0f0' }}>Timeline</div>
            {data.events.length === 0 ? (
              <div style={{
                padding: '20px 14px', textAlign: 'center', color: '#777', fontSize: 13,
                background: '#2a2a2a', borderRadius: 6,
              }}>
                First appearance in analysis for {instanceName}.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.events.map((event) => (
                  <TimelineEvent key={event.id} event={event} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#777', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>{value}</div>
    </div>
  );
}

const EVENT_STYLES: Record<string, { icon: string; color: string; bg: string }> = {
  analysis_run:       { icon: '\u{1F4CA}', color: '#a0a0a0', bg: '#2a2a2a' },
  actioned:           { icon: '\u2705',    color: '#66bb6a', bg: '#1e3a2a' },
  deferred:           { icon: '\u23F8\uFE0F',  color: '#777', bg: '#2a2a2a' },
  sporadic_flagged:   { icon: '\u{1F3F7}\uFE0F', color: '#ffc107', bg: '#3d3520' },
  sporadic_unflagged: { icon: '\u{1F3F7}\uFE0F', color: '#777', bg: '#2a2a2a' },
  exception_added:    { icon: '\u{1F6E1}\uFE0F', color: '#7c93c3', bg: '#1e2a4a' },
  chat_override:      { icon: '\u{1F4AC}',       color: '#b08cd8', bg: '#2a1e3a' },
  reappeared:         { icon: '\u{1F504}',       color: '#7c93c3', bg: '#1e2a4a' },
};

function TimelineEvent({ event }: { event: HistoryEvent }) {
  const style = EVENT_STYLES[event.eventType] ?? EVENT_STYLES['analysis_run'];
  const date = new Date(event.eventDate).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <div style={{
      display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 6,
      background: style.bg, fontSize: 12,
    }}>
      <div style={{ fontSize: 14, lineHeight: '20px', flexShrink: 0 }}>{style.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, color: style.color }}>
            {formatEventType(event.eventType)}
          </span>
          <span style={{ fontSize: 10, color: '#777', flexShrink: 0 }}>{date}</span>
        </div>
        {event.note && (
          <div style={{ color: '#a0a0a0', marginTop: 3, lineHeight: 1.4 }}>{event.note}</div>
        )}
        {event.actorEmail && (
          <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>by {event.actorEmail}</div>
        )}
      </div>
    </div>
  );
}

function formatEventType(eventType: string): string {
  switch (eventType) {
    case 'analysis_run': return 'Analysis Run';
    case 'actioned': return 'Actioned for Removal';
    case 'deferred': return 'Deferred';
    case 'sporadic_flagged': return 'Flagged as Temporary Access';
    case 'sporadic_unflagged': return 'Temporary Access Flag Removed';
    case 'exception_added': return 'Added to Exception Register';
    case 'chat_override': return 'Reclassified via Chat';
    case 'reappeared': return 'Reappeared on Instance';
    default: return eventType;
  }
}
