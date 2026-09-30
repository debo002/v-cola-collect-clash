/** Inline SVG game icons — no emoji in UI. Stroke = currentColor. */

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

export function PlayIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DeckIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="7" width="13" height="13" rx="2.5" />
      <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3H18a2.5 2.5 0 0 1 2.5 2.5v7.5" />
      <path d="M8 7a2.5 2.5 0 0 1 2.5-2.5H18" />
    </svg>
  );
}

export function ExitIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function SpeakerOnIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function SpeakerOffIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
      <path d="M22 9l-6 6" />
      <path d="M16 9l6 6" />
    </svg>
  );
}

export function LockIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function CoolIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 2v20" />
      <path d="M4 6l16 12" />
      <path d="M20 6L4 18" />
      <path d="M12 2l-2 3m2-3l2 3M12 22l-2-3m2 3l2-3" />
    </svg>
  );
}

export function PartyIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 15L15 5l4 4L9 19z" />
      <path d="M15 5l2-2 4 4-2 2" />
      <path d="M5 15l-2 2" />
      <circle cx="19" cy="15" r="1.2" fill="currentColor" />
      <circle cx="21" cy="19" r="1" fill="currentColor" />
      <circle cx="15" cy="19" r="1" fill="currentColor" />
    </svg>
  );
}

export function EnergyIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PhoneIcon({ size = 44, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

export function CrownIcon({ size = 32, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 8l4 4 5-6 5 6 4-4v9H3z" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="21" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
