export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="state">
      <div className="spinner" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state">
      <p style={{ color: "var(--accent-2)" }}>⚠ {message}</p>
      {onRetry && (
        <button className="btn secondary sm" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="state">{children}</div>;
}

export function TopBar({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="topbar">
      {onBack && (
        <button className="back" onClick={onBack} aria-label="Назад">
          ‹
        </button>
      )}
      <h1>{title}</h1>
    </header>
  );
}
