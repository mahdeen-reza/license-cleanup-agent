import { useState, useEffect } from 'react';
import type { MeResponse, RunResult } from './types';
import WelcomeBanner from './components/WelcomeBanner';
import RunConfig from './components/RunConfig';
import AnalysisResults from './components/AnalysisResults';
import ReviewChat from './components/ReviewChat';
import KnowledgeBase from './components/KnowledgeBase';
import RunHistory from './components/RunHistory';
import SystemOnboarder from './components/SystemOnboarder';
import AccessDenied from './components/AccessDenied';
import AdminConsole from './components/AdminConsole';

type View = 'analysis' | 'knowledge' | 'onboard' | 'history' | 'admin';
type AuthStatus = 'loading' | 'authenticated' | 'denied';

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<MeResponse | null>(null);
  const [currentView, setCurrentView] = useState<View>('analysis');
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [historyRunResult, setHistoryRunResult] = useState<RunResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then(async (r) => {
        if (r.status === 403) {
          setAuthStatus('denied');
          return;
        }
        if (!r.ok) throw new Error('Failed to fetch user');
        const data = await r.json() as MeResponse;
        setUser(data);
        setAuthStatus('authenticated');
      })
      .catch(() => setAuthStatus('denied'));
  }, []);

  function handleRunComplete(result: RunResult) {
    setRunResult(result);
  }

  function handleNav(view: View) {
    setCurrentView(view);
    if (view !== 'analysis') setRunResult(null);
    if (view !== 'history') {
      setHistoryRunResult(null);
      setHistoryError(null);
    }
  }

  async function handleSelectHistoryRun(runId: string) {
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryRunResult(null);
    try {
      const res = await fetch(`/api/analysis/${runId}`);
      if (!res.ok) {
        const err = await res.json();
        setHistoryError(err.error ?? 'Failed to load run details.');
        return;
      }
      const data = await res.json() as RunResult;
      setHistoryRunResult(data);
    } catch {
      setHistoryError('Network error loading run details.');
    } finally {
      setHistoryLoading(false);
    }
  }

  // ── Auth gating ──────────────────────────────────────────────────────────────

  if (authStatus === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 14, color: '#a0a0a0' }}>Loading...</span>
      </div>
    );
  }

  if (authStatus === 'denied' || !user) {
    return <AccessDenied />;
  }

  // ── Authenticated app ────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <WelcomeBanner
        email={user.email}
        name={user.name}
        role={user.role}
        currentView={currentView}
        onNav={handleNav}
      />

      <main style={{ flex: 1, padding: '20px 24px', maxWidth: 1400, width: '100%', margin: '0 auto' }}>

        {/* ── Analysis view ─────────────────────────────────────────── */}
        {currentView === 'analysis' && (
          <>
            {!runResult ? (
              <RunConfig onRunComplete={handleRunComplete} />
            ) : (
              <div>
                {/* Back to new run */}
                <div style={{ marginBottom: 16 }}>
                  <button onClick={() => setRunResult(null)}>← New Run</button>
                </div>

                {/* Results + chat side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>
                  <AnalysisResults result={runResult} />
                  <div style={{ position: 'sticky', top: 20, height: 'calc(100vh - 120px)' }}>
                    <ReviewChat runId={runResult.runId} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Knowledge Base view ────────────────────────────────────── */}
        {currentView === 'knowledge' && <KnowledgeBase />}

        {/* ── Onboard System view ────────────────────────────────────── */}
        {currentView === 'onboard' && (
          <SystemOnboarder onConfirmed={() => handleNav('analysis')} />
        )}

        {/* ── Run History view ───────────────────────────────────────── */}
        {currentView === 'history' && (
          <>
            {historyRunResult ? (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <button onClick={() => { setHistoryRunResult(null); setHistoryError(null); }}>
                    ← Back to Run History
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>
                  <AnalysisResults result={historyRunResult} isHistoryView />
                  <div style={{ position: 'sticky', top: 20, height: 'calc(100vh - 120px)' }}>
                    <ReviewChat runId={historyRunResult.runId} />
                  </div>
                </div>
              </div>
            ) : (
              <>
                {historyLoading && (
                  <div className="muted" style={{ padding: 16, marginBottom: 12 }}>Loading run details...</div>
                )}
                {historyError && (
                  <div style={{ color: '#ff6b6b', fontSize: 13, padding: '12px 16px', marginBottom: 12, background: '#3d2020', borderRadius: 6 }}>
                    {historyError}
                  </div>
                )}
                <RunHistory onSelectRun={handleSelectHistoryRun} />
              </>
            )}
          </>
        )}

        {/* ── Admin view ────────────────────────────────────────────── */}
        {currentView === 'admin' && (
          <AdminConsole currentUser={user} />
        )}
      </main>
    </div>
  );
}
