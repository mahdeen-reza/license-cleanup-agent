export default function AccessDenied() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#292929',
    }}>
      <div className="card" style={{
        maxWidth: 480,
        textAlign: 'center',
        padding: '40px 32px',
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#7c93c3', display: 'block', marginBottom: 24 }}>
          SaaS License Clean-Up Agent
        </span>

        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#f0f0f0', marginBottom: 12 }}>
          Access Denied
        </h1>

        <p style={{ fontSize: 14, color: '#a0a0a0', lineHeight: 1.5 }}>
          You do not have access to this application.
          Please contact an administrator to request provisioning.
        </p>
      </div>
    </div>
  );
}
