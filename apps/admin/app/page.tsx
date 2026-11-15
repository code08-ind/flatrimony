// Placeholder for the M1 pipeline (docs/03 §19). Queues, user view and audit log arrive in M6 (T6.2).
const QUEUES = [
  { name: 'Reports', note: 'Safety reports first; 2-hour SLA 9 AM–11 PM IST (FR-ADM-05)' },
  { name: 'Listings pending review', note: 'Flagged by automatic checks (FR-LST-08)' },
  { name: 'Broker signals', note: 'Risk score above threshold (PRD §9)' },
  { name: 'Failed verifications', note: 'DigiLocker failures needing support (FR-VER-07)' },
];

export default function AdminHome() {
  return (
    <main className="shell">
      <p className="wordmark">Flatrimony Admin</p>
      <h1>Moderation</h1>
      <p className="muted">Queues are not connected yet. They ship with milestone M6.</p>
      <ul className="queues">
        {QUEUES.map((q) => (
          <li key={q.name} className="card">
            <h2>{q.name}</h2>
            <p className="muted">{q.note}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
