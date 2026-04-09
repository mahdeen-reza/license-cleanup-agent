import { useState, useEffect } from 'react';
import type { HistoryRun } from '../types';

interface Props {
  onSelectRun: (runId: string) => void;
}

export default function RunHistory({ onSelectRun }: Props) {
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/analysis/history')
      .then(r => r.json() as Promise<HistoryRun[]>)
      .then(setRuns)
      .catch(() => setError('Failed to load history.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="muted" style={{ padding: 24, fontSize: 13 }}>Loading...</div>;
  if (error) return <div className="error" style={{ margin: 24, fontSize: 13 }}>{error}</div>;
  if (runs.length === 0) {
    return (
      <div className="card" style={{ padding: '16px 20px', textAlign: 'center' }}>
        <div style={{ color: '#a0a0a0', fontSize: 13 }}>No runs yet. Run an analysis to see history here.</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #444' }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: '#7c93c3' }}>
          Run History
        </span>
        <span style={{ marginLeft: 8, fontSize: 13, color: '#a0a0a0' }}>({runs.length})</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>System</th>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Instance</th>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Mode</th>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Type</th>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Date</th>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Total</th>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Actioned</th>
              <th style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a0a0a0' }}>Run By</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <tr
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#3a3a3a'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
              >
                <td style={{ whiteSpace: 'nowrap', fontWeight: 500, fontSize: 13, color: '#ccc' }}>{run.systemName}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 13, color: '#ccc' }}>{run.instanceName}</td>
                <td style={{ textTransform: 'capitalize', fontSize: 13, color: '#ccc' }}>{run.mode}</td>
                <td style={{ fontSize: 13, color: '#ccc' }}>{run.cleanupType === 'on_demand' ? `On-demand${run.licensesNeeded ? ` (${run.licensesNeeded})` : ''}` : 'Routine'}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 13, color: '#ccc' }}>{new Date(run.ranAt).toLocaleString()}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, color: '#ccc' }}>{run.totalUsers}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, color: run.actionedUsers > 0 ? '#66bb6a' : '#777' }}>
                  {run.actionedUsers}
                </td>
                <td style={{ fontSize: 11, color: '#a0a0a0' }}>{run.ranByEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
