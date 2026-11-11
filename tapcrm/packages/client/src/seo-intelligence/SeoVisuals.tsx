import { useId } from 'react';

export function SeoWebsiteIllustration({ className = '' }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 380 270" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}-bg`}
          x1="50"
          y1="15"
          x2="330"
          y2="260"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--app-accent)" stopOpacity=".17" />
          <stop offset="1" stopColor="var(--app-accent)" stopOpacity=".02" />
        </linearGradient>
      </defs>
      <ellipse
        cx="192"
        cy="239"
        rx="148"
        ry="15"
        fill="var(--app-accent)"
        opacity=".08"
      />
      <circle cx="190" cy="131" r="112" fill={`url(#${id}-bg)`} />
      <path
        d="M41 116c-13-40 41-67 61-45M290 210c42 5 60-25 47-47"
        stroke="var(--app-accent)"
        strokeOpacity=".2"
        strokeWidth="2"
        strokeDasharray="4 7"
      />
      <rect
        x="67"
        y="53"
        width="234"
        height="164"
        rx="14"
        fill="var(--app-surface)"
        stroke="var(--app-border)"
        strokeWidth="2"
      />
      <path d="M68 83h232" stroke="var(--app-border)" />
      <circle cx="83" cy="68" r="3" fill="#f6b4ad" />
      <circle cx="94" cy="68" r="3" fill="#f5d491" />
      <circle cx="105" cy="68" r="3" fill="var(--app-accent)" opacity=".7" />
      <rect
        x="125"
        y="63"
        width="113"
        height="10"
        rx="5"
        fill="var(--app-surface-raised)"
      />
      <rect
        x="84"
        y="99"
        width="68"
        height="82"
        rx="7"
        fill="var(--app-accent)"
        fillOpacity=".1"
      />
      <path
        d="M102 154l16-19 19 22"
        stroke="var(--app-accent)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="130" cy="119" r="7" fill="var(--app-accent)" fillOpacity=".25" />
      <rect
        x="166"
        y="102"
        width="103"
        height="8"
        rx="4"
        fill="var(--app-foreground)"
        fillOpacity=".7"
      />
      <rect
        x="166"
        y="121"
        width="85"
        height="5"
        rx="2.5"
        fill="var(--app-muted)"
        fillOpacity=".2"
      />
      <rect
        x="166"
        y="133"
        width="100"
        height="5"
        rx="2.5"
        fill="var(--app-muted)"
        fillOpacity=".2"
      />
      <rect
        x="166"
        y="145"
        width="67"
        height="5"
        rx="2.5"
        fill="var(--app-muted)"
        fillOpacity=".2"
      />
      <rect
        x="84"
        y="194"
        width="133"
        height="5"
        rx="2.5"
        fill="var(--app-muted)"
        fillOpacity=".15"
      />
      <rect
        x="253"
        y="21"
        width="88"
        height="102"
        rx="13"
        fill="var(--app-surface)"
        stroke="var(--app-border)"
        strokeWidth="2"
      />
      {[44, 68, 92].map((y, i) => (
        <g key={y}>
          <circle
            cx="270"
            cy={y}
            r="7"
            fill={i === 2 ? '#f59e0b' : 'var(--app-accent)'}
            fillOpacity=".13"
          />
          <path
            d={i === 2 ? `M270 ${y - 3}v3m0 3h.01` : `M267 ${y}l2 2 4-4`}
            stroke={i === 2 ? '#d97706' : 'var(--app-accent)'}
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <rect
            x="284"
            y={y - 2}
            width={i === 1 ? 31 : 40}
            height="4"
            rx="2"
            fill="var(--app-muted)"
            fillOpacity=".22"
          />
        </g>
      ))}
      <circle
        cx="246"
        cy="176"
        r="43"
        fill="var(--app-surface)"
        fillOpacity=".9"
        stroke="var(--app-accent)"
        strokeWidth="7"
      />
      <circle cx="246" cy="176" r="32" fill="var(--app-accent)" fillOpacity=".07" />
      <path
        d="M275 208l34 34"
        stroke="var(--app-accent)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d="M231 176l10 10 20-22"
        stroke="var(--app-accent)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="54"
        cy="178"
        r="22"
        fill="var(--app-surface)"
        stroke="var(--app-border)"
      />
      <path
        d="M44 178h20m-10-10v20"
        stroke="var(--app-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M190 23v10m-5-5h10M326 139v8m-4-4h8"
        stroke="var(--app-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".5"
      />
    </svg>
  );
}

export function SeoProgressRing({
  value,
  total,
  label,
  caption,
  tone = 'accent',
}: {
  value: number;
  total: number;
  label: string;
  caption?: string;
  tone?: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div
      className={`seo-progress-ring seo-tone-${tone}`}
      role="img"
      aria-label={`${label}: ${value} of ${total}${caption ? `. ${caption}` : ''}`}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="var(--app-border)"
          strokeWidth="9"
        />
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="var(--seo-tone)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${percent * Math.PI} 314.16`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div>
        <strong>{total > 0 ? `${Math.round(percent)}%` : '—'}</strong>
        <span>{label}</span>
      </div>
      {caption && <p>{caption}</p>}
    </div>
  );
}
