/** Dynotator's mark: annotation brackets around a highlight, on the accent square. Same drawing as public/favicon.svg. */
export function DynotatorMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--primary)" />
      <path d="M12 8.5H8.5v15H12M20 8.5h3.5v15H20" fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d="M13.5 16h5" stroke="#1f1f1f" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
