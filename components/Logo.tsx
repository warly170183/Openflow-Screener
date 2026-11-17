// orderflow mark — a "split orb". The solid half is resting liquidity on one
// side of the book; the bars on the other half are a volume profile stepping
// out from the mid. Drawn on a 32-unit grid so it stays crisp from 16px up.

export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="var(--accent, #d7f75b)" />
      <path d="M16 4.5a11.5 11.5 0 0 0 0 23z" fill="var(--on-accent, #0a0b0d)" />
      <g fill="var(--on-accent, #0a0b0d)">
        <rect x="18.5" y="9" width="6" height="3.6" rx="1.8" />
        <rect x="18.5" y="14.2" width="8" height="3.6" rx="1.8" />
        <rect x="18.5" y="19.4" width="4" height="3.6" rx="1.8" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wordmark-text whitespace-nowrap">
        OrderFlow <span className="wordmark-dot">Screener</span>
      </span>
    </span>
  );
}
