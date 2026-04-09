import { useState, useCallback, useMemo } from 'react';
import type { RunResult, AnalysisResultRow } from '../types';
import UserHistoryPanel from './UserHistoryPanel';

type DeltaFilter = 'newly_inactive' | 'persistently_inactive' | 'recovered' | 'reappeared' | 'net_new' | null;

interface Props {
  result: RunResult;
  isHistoryView?: boolean;
}

type TabKey = 'directRemove' | 'notifyFirst' | 'exEmployee' | 'gtmFlagged' | 'priorException' | 'humanReview' | 'excluded';

const TAB_LABELS: Record<TabKey, string> = {
  directRemove:   'Direct Remove',
  notifyFirst:    'Notify First',
  exEmployee:     'Ex-Employee',
  gtmFlagged:     'GTM Flagged',
  priorException: 'Prior Exception',
  humanReview:    'Human Review',
  excluded:       'Excluded',
};

// Tabs where users can be actioned (everything except Excluded)
const ACTIONABLE_TABS = new Set<TabKey>([
  'directRemove', 'notifyFirst', 'exEmployee', 'gtmFlagged', 'priorException', 'humanReview',
]);

function toCSV(rows: AnalysisResultRow[]): string {
  if (rows.length === 0) return '';
  const headers: (keyof AnalysisResultRow)[] = [
    'email', 'fullName', 'department', 'division', 'businessTitle', 'region', 'product',
    'managerEmail', 'onLeave', 'workerType', 'acquisitionCompany', 'sfCreatedDate',
    'lastActivityDate', 'monthlyActivity', 'sfLastActivityDate', 'sfDaysActive',
    'platformLastDate', 'platformDaysActive', 'permissionSets', 'profile',
    'classification', 'confidenceLevel', 'matchTier', 'reasoning',
  ];
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
}

function downloadCSV(rows: AnalysisResultRow[], filename: string) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function mergeSporadicFlags(result: RunResult): RunResult['tabs'] {
  if (!result.sporadicFlags) return result.tabs;
  const flags = result.sporadicFlags;
  const merged = { ...result.tabs };
  for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
    merged[key] = merged[key].map((row) => {
      const flag = flags[row.email];
      return flag ? { ...row, sporadicFlag: flag } : row;
    });
  }
  return merged;
}

// Priority order for smart default tab selection
const TAB_PRIORITY: TabKey[] = [
  'exEmployee', 'directRemove', 'notifyFirst', 'gtmFlagged', 'priorException', 'humanReview', 'excluded',
];

export default function AnalysisResults({ result, isHistoryView = false }: Props) {
  const { summary } = result;

  // Mutable local copy of tabs so we can update actionStatus after confirm
  // Merge sporadic flag data into rows on initial load
  const [tabs, setTabs] = useState(() => mergeSporadicFlags(result));

  // Smart default: first tab with users, in priority order
  const defaultTab = useMemo(() => {
    const merged = mergeSporadicFlags(result);
    for (const key of TAB_PRIORITY) {
      if ((merged[key] ?? []).length > 0) return key;
    }
    return 'directRemove';
  }, [result]);
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

  // Selected result IDs per tab
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Email list display after confirmation
  const [emailListResult, setEmailListResult] = useState<{
    emails: string[];
    tabLabel: string;
  } | null>(null);

  const [copied, setCopied] = useState(false);

  // Delta filter state
  const [deltaFilter, _setDeltaFilter] = useState<DeltaFilter>(null);

  // User history panel state
  const [historyUser, setHistoryUser] = useState<AnalysisResultRow | null>(null);

  // Compute all actioned emails across all tabs (for the persistent actioned list)
  const actionedEmailsList = useMemo(() => {
    const emails: string[] = [];
    for (const key of Object.keys(tabs) as TabKey[]) {
      for (const row of tabs[key]) {
        if (row.actionStatus === 'actioned') {
          emails.push(row.email);
        }
      }
    }
    return emails.sort();
  }, [tabs]);

  const [actionedListCopied, setActionedListCopied] = useState(false);

  // Collapsible state for history view actioned section
  const [actionedCollapsed, setActionedCollapsed] = useState(() => actionedEmailsList.length === 0);

  const tabKeys = Object.keys(TAB_LABELS) as TabKey[];
  const allActiveRows = tabs[activeTab] ?? [];
  // Apply delta filter if active
  const activeRows = useMemo(
    () => deltaFilter ? allActiveRows.filter((r) => r.deltaCategory === deltaFilter) : allActiveRows,
    [allActiveRows, deltaFilter],
  );
  const isActionable = ACTIONABLE_TABS.has(activeTab);

  // Pending rows = rows that haven't been actioned or deferred yet
  const pendingRows = activeRows.filter((r) => r.actionStatus === 'pending');

  const tabSelected = selected[activeTab] ?? new Set<string>();
  const selectedCount = tabSelected.size;

  function tabCount(key: TabKey): number {
    const rows = tabs[key] ?? [];
    return deltaFilter ? rows.filter((r) => r.deltaCategory === deltaFilter).length : rows.length;
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const current = new Set(prev[activeTab] ?? []);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, [activeTab]: current };
    });
  }, [activeTab]);

  const selectAll = useCallback(() => {
    setSelected((prev) => ({
      ...prev,
      [activeTab]: new Set(pendingRows.map((r) => r.id)),
    }));
  }, [activeTab, pendingRows]);

  const deselectAll = useCallback(() => {
    setSelected((prev) => ({ ...prev, [activeTab]: new Set() }));
  }, [activeTab]);

  const handleConfirmSelected = async () => {
    setProcessing(true);
    try {
      // Checked pending rows → actioned, unchecked pending rows → deferred
      const actions = pendingRows.map((row) => ({
        resultId: row.id,
        status: tabSelected.has(row.id) ? 'actioned' as const : 'deferred' as const,
      }));

      const res = await fetch(`/api/analysis/${result.runId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try { const err = await res.json(); errMsg = err.error ?? errMsg; } catch { /* non-JSON response */ }
        alert(`Action failed: ${errMsg}`);
        return;
      }

      const data = await res.json() as {
        actionedEmails: string[];
        emailListText: string;
        actionedCount: number;
        deferredCount: number;
      };

      // Update local tab data with new actionStatus
      setTabs((prev) => {
        const updated = { ...prev };
        updated[activeTab] = updated[activeTab].map((row) => {
          if (row.actionStatus !== 'pending') return row;
          return {
            ...row,
            actionStatus: tabSelected.has(row.id) ? 'actioned' as const : 'deferred' as const,
          };
        });
        return updated;
      });

      // Clear selection for this tab
      setSelected((prev) => ({ ...prev, [activeTab]: new Set() }));

      // Show email list if there were actioned users
      if (data.actionedEmails.length > 0) {
        setEmailListResult({
          emails: data.actionedEmails,
          tabLabel: TAB_LABELS[activeTab],
        });
      }
    } finally {
      setProcessing(false);
      setConfirmOpen(false);
    }
  };

  const copyEmails = () => {
    if (!emailListResult) return;
    navigator.clipboard.writeText(emailListResult.emails.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // Inline delta summary for the current tab
  const tabDeltaCounts = useMemo(() => {
    const rows = tabs[activeTab] ?? [];
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row.deltaCategory) {
        counts[row.deltaCategory] = (counts[row.deltaCategory] ?? 0) + 1;
      }
    }
    return counts;
  }, [tabs, activeTab]);

  const deltaLabels: Record<string, string> = {
    newly_inactive: 'newly inactive',
    persistently_inactive: 'persistently inactive',
    recovered: 'recovered',
    reappeared: 'reappeared',
    net_new: 'net new',
  };

  const inlineDeltaText = useMemo(() => {
    const parts: string[] = [];
    for (const [key, label] of Object.entries(deltaLabels)) {
      const count = tabDeltaCounts[key];
      if (count && count > 0) parts.push(`${count} ${label}`);
    }
    return parts.join(' \u00b7 ');
  }, [tabDeltaCounts]);

  // Show inline delta only when there's actual delta data (not baseline)
  const showInlineDelta = result.deltaSummary && !result.deltaSummary.isBaseline && inlineDeltaText.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Compact run metadata */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 11, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: 1 }}>System </span>
            <span style={{ fontWeight: 600 }}>{summary.systemName}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: 1 }}>Instance </span>
            <span style={{ fontWeight: 600 }}>{summary.instance}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: 1 }}>Mode </span>
            <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{summary.mode}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: 1 }}>Type </span>
            <span style={{ fontWeight: 600 }}>{summary.cleanupType === 'on_demand' ? 'On-demand' : 'Routine'}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: 1 }}>Total </span>
            <span style={{ fontWeight: 600 }}>{summary.totalUsers}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: 1 }}>Run By </span>
            <span style={{ fontWeight: 600 }}>{summary.ranByEmail}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: '#a0a0a0' }}>{new Date(summary.ranAt).toLocaleString()}</span>
          </div>
        </div>

        {/* Warnings */}
        {summary.warnings.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {summary.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: '#ffc107', background: '#3d3520', borderRadius: 4, padding: '4px 10px', marginTop: 4 }}>
                Warning: {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actioned Users — history view only, collapsible */}
      {isHistoryView && (
        <div className="card" style={{
          padding: 0, overflow: 'hidden',
          background: actionedEmailsList.length > 0 ? '#1e3a2a' : '#333',
          border: actionedEmailsList.length > 0 ? '1px solid #2d5a3d' : '1px solid #444',
        }}>
          <div
            onClick={() => setActionedCollapsed(!actionedCollapsed)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '16px 20px', cursor: 'pointer', userSelect: 'none',
            }}
          >
            <span style={{
              fontWeight: 600, fontSize: 13,
              color: actionedEmailsList.length > 0 ? '#66bb6a' : '#777',
            }}>
              {actionedEmailsList.length > 0
                ? `Actioned Users (${actionedEmailsList.length})`
                : 'No users actioned'}
            </span>
            <span style={{ fontSize: 12, color: '#a0a0a0' }}>{actionedCollapsed ? '▸' : '▾'}</span>
          </div>
          {!actionedCollapsed && actionedEmailsList.length > 0 && (
            <div style={{ padding: '0 20px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(actionedEmailsList.join('\n'));
                    setActionedListCopied(true);
                    setTimeout(() => setActionedListCopied(false), 2000);
                  }}
                  style={{
                    background: '#2d7a3e', color: '#fff', border: 'none', padding: '6px 14px',
                    borderRadius: 4, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                  }}
                >
                  {actionedListCopied ? 'Copied!' : 'Copy Email List'}
                </button>
              </div>
              <textarea
                readOnly
                value={actionedEmailsList.join('\n')}
                style={{
                  width: '100%', minHeight: 80, maxHeight: 200, fontFamily: 'monospace', fontSize: 12,
                  padding: 8, border: '1px solid #2d5a3d', borderRadius: 4, resize: 'vertical',
                  background: '#3a3a3a', color: '#f0f0f0', boxSizing: 'border-box',
                }}
              />
              <p style={{ fontSize: 11, color: '#66bb6a', marginTop: 4, marginBottom: 0 }}>
                Paste this list into the support ticket for license removal
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #444', background: '#2a2a2a', overflowX: 'auto' }}>
          {tabKeys.map(key => {
            const count = tabCount(key);
            const isEmpty = count === 0;
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  border: 'none',
                  borderBottom: isActive ? '2px solid #7c93c3' : '2px solid transparent',
                  background: 'transparent',
                  padding: '10px 20px',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#7c93c3' : isEmpty ? '#555' : '#a0a0a0',
                  opacity: isEmpty && !isActive ? 0.5 : 1,
                  borderRadius: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {TAB_LABELS[key]} ({count})
              </button>
            );
          })}
        </div>

        {/* Action bar */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid #444', alignItems: 'center', flexWrap: 'wrap' }}>
          {isActionable && pendingRows.length > 0 && (
            <>
              <button onClick={tabSelected.size === pendingRows.length ? deselectAll : selectAll} style={{ fontSize: 12 }}>
                {tabSelected.size === pendingRows.length ? 'Deselect All' : 'Select All'}
              </button>
              <span style={{ fontSize: 12, color: '#a0a0a0' }}>
                {selectedCount} of {pendingRows.length} selected
              </span>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => downloadCSV(activeRows, `${activeTab}-${summary.instance}-${summary.mode}.csv`)}
            disabled={activeRows.length === 0}
            style={{ fontSize: 12 }}
          >
            Download CSV
          </button>
        </div>

        {/* Inline delta summary for this tab */}
        {showInlineDelta && (
          <div style={{ padding: '4px 20px', fontSize: 12, color: '#a0a0a0' }}>
            {inlineDeltaText} in this tab
          </div>
        )}

        {/* Table */}
        {activeRows.length === 0 ? (
          <div style={{ padding: 24, color: '#a0a0a0', textAlign: 'center' }}>No users in this tab.</div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {isActionable && <th style={{ width: 36 }}></th>}
                  <th>Email</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Division</th>
                  <th>Title</th>
                  <th>Product</th>
                  <th>Region</th>
                  <th>Manager</th>
                  <th>Worker Type</th>
                  <th>On Leave</th>
                  <th>Classification</th>
                  <th>Confidence</th>
                  <th>Delta</th>
                  <th>Flags</th>
                  <th>Tier</th>
                  <th style={{ minWidth: 260 }}>Reasoning</th>
                  {isActionable && <th>Status</th>}
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => {
                  const isPending = row.actionStatus === 'pending';
                  const isChecked = tabSelected.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setHistoryUser(historyUser?.id === row.id ? null : row)}
                      style={{
                        background: historyUser?.id === row.id ? '#2a3a4e'
                          : row.actionStatus === 'actioned' ? '#1e3a2a'
                          : row.actionStatus === 'deferred' ? '#333'
                          : undefined,
                        cursor: 'pointer',
                      }}
                    >
                      {isActionable && (
                        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          {isPending ? (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelect(row.id)}
                            />
                          ) : (
                            <StatusBadge status={row.actionStatus} />
                          )}
                        </td>
                      )}
                      <td style={{ whiteSpace: 'nowrap' }}>{row.email}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{row.fullName}</td>
                      <td>{row.department}</td>
                      <td>{row.division}</td>
                      <td>{row.businessTitle}</td>
                      <td>{row.product}</td>
                      <td>{row.region}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{row.managerEmail}</td>
                      <td>{row.workerType}</td>
                      <td>{row.onLeave}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{row.classification}</td>
                      <td>
                        <span className={`tag ${row.confidenceLevel}`}>{row.confidenceLevel}</span>
                      </td>
                      <td>
                        {row.deltaCategory && <DeltaBadge category={row.deltaCategory} previousClassification={row.previousClassification} />}
                      </td>
                      <td>
                        {row.sporadicFlag && <SporadicBadge flag={row.sporadicFlag} />}
                      </td>
                      <td>{row.matchTier}</td>
                      <td style={{ fontSize: 11, lineHeight: 1.5 }}>{row.reasoning}</td>
                      {isActionable && (
                        <td>
                          {!isPending && <StatusBadge status={row.actionStatus} />}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Confirm Selected button — fixed at bottom of tab */}
        {isActionable && pendingRows.length > 0 && (
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid #444',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
          }}>
            <span style={{ fontSize: 12, color: '#a0a0a0' }}>
              {selectedCount} user{selectedCount !== 1 ? 's' : ''} selected for action
            </span>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={selectedCount === 0}
              style={{
                background: selectedCount > 0 ? '#5b7bb4' : '#555',
                color: '#fff',
                border: 'none',
                padding: '8px 20px',
                borderRadius: 4,
                fontWeight: 600,
                cursor: selectedCount > 0 ? 'pointer' : 'default',
              }}
            >
              Confirm Selected ({selectedCount})
            </button>
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="card" style={{ maxWidth: 460, width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>Confirm Actioning</h3>
            <p>
              Mark <strong>{selectedCount}</strong> user{selectedCount !== 1 ? 's' : ''} as actioned
              for removal in <strong>{TAB_LABELS[activeTab]}</strong>?
            </p>
            <p style={{ fontSize: 12, color: '#a0a0a0' }}>
              {pendingRows.length - selectedCount} unchecked user{pendingRows.length - selectedCount !== 1 ? 's' : ''} will
              be marked as deferred. This will be logged to the audit trail.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setConfirmOpen(false)} disabled={processing}>
                Cancel
              </button>
              <button
                onClick={handleConfirmSelected}
                disabled={processing}
                style={{ background: '#5b7bb4', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 4, fontWeight: 600 }}
              >
                {processing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User History Panel */}
      {historyUser && (
        <UserHistoryPanel
          userEmail={historyUser.email}
          instanceName={summary.instance}
          fullName={historyUser.fullName}
          classification={historyUser.classification}
          confidenceLevel={historyUser.confidenceLevel}
          onClose={() => setHistoryUser(null)}
        />
      )}

      {/* Email list result panel */}
      {emailListResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="card" style={{ maxWidth: 560, width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>
              Removal Email List — {emailListResult.tabLabel} — {monthYear}
            </h3>
            <textarea
              readOnly
              value={emailListResult.emails.join('\n')}
              style={{
                width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 12,
                padding: 10, border: '1px solid #444', borderRadius: 4, resize: 'vertical',
                background: '#3a3a3a', color: '#f0f0f0',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <button
                onClick={copyEmails}
                style={{ background: '#5b7bb4', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, fontWeight: 600 }}
              >
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <span style={{ fontSize: 12, color: '#a0a0a0' }}>
                {emailListResult.emails.length} email{emailListResult.emails.length !== 1 ? 's' : ''}
              </span>
            </div>
            <p style={{ fontSize: 11, color: '#777', marginTop: 8, marginBottom: 0 }}>
              Paste this list directly into the support ticket for license removal
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setEmailListResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SporadicBadge({ flag }: { flag: NonNullable<import('../types').AnalysisResultRow['sporadicFlag']> }) {
  const flagDate = new Date(flag.flaggedAt).toLocaleDateString();
  const title = `Flagged by ${flag.flaggedBy} on ${flagDate}: ${flag.note}. Removed ${flag.removalCount} time${flag.removalCount !== 1 ? 's' : ''} from this instance.`;
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 3,
        background: '#3d3520',
        color: '#ffc107',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        cursor: 'help',
        whiteSpace: 'nowrap',
      }}
    >
      Temporary Access
    </span>
  );
}

const DELTA_BADGE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  newly_inactive:        { bg: '#3d2020', color: '#ff6b6b', label: 'Newly Inactive' },
  persistently_inactive: { bg: '#3d3520', color: '#ffc107', label: 'Persistently Inactive' },
  recovered:             { bg: '#1e3a2a', color: '#66bb6a', label: 'Recovered' },
  reappeared:            { bg: '#1e2a4a', color: '#7c93c3', label: 'Reappeared' },
  net_new:               { bg: '#3a3a3a', color: '#a0a0a0', label: 'Net New' },
};

function DeltaBadge({ category, previousClassification }: { category: string; previousClassification: string | null }) {
  const style = DELTA_BADGE_STYLES[category];
  if (!style) return null;

  let suffix = '';
  if (previousClassification) {
    if (category === 'persistently_inactive') {
      suffix = ` (was: ${previousClassification})`;
    } else if (category === 'recovered') {
      suffix = ` (was: ${previousClassification})`;
    } else if (category === 'reappeared') {
      suffix = ' (removed in previous run)';
    }
  }

  return (
    <span
      title={`${style.label}${suffix}`}
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 3,
        background: style.bg,
        color: style.color,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isActioned = status === 'actioned';
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 600,
      padding: '2px 6px',
      borderRadius: 3,
      background: isActioned ? '#1e3a2a' : '#3a3a3a',
      color: isActioned ? '#66bb6a' : '#a0a0a0',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>
      {status}
    </span>
  );
}
