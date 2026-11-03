import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon.js';
import { SeoWebsiteIllustration } from './SeoVisuals.js';
import type { SeoSeverity } from './types.js';

export type SeoTone = 'accent' | 'warning' | 'danger' | 'info' | 'neutral';
export function SeoSectionHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <header className="seo-section-header">
      <div>
        {eyebrow && <p className="seo-eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && <div className="seo-header-action">{action}</div>}
    </header>
  );
}
export function SeoMetricCard({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: string;
  tone?: SeoTone;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="seo-metric-top">
        <span className="seo-metric-icon">
          <Icon name={icon} />
        </span>
        {onClick && <Icon name="arrow" className="size-4 text-app-muted" />}
      </div>
      <p className="seo-metric-label">{label}</p>
      <strong className="seo-metric-value">{value}</strong>
      <p className="seo-metric-detail">{detail}</p>
    </>
  );
  return onClick ? (
    <button type="button" className={`seo-metric seo-tone-${tone}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`seo-metric seo-tone-${tone}`}>{body}</div>
  );
}
export function SeoEmptyState({
  title,
  description,
  action,
  compact = false,
  kind = 'website',
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
  kind?: 'website' | 'search' | 'links' | 'monitoring';
}) {
  return (
    <div className={`seo-empty seo-surface${compact ? ' seo-empty-compact' : ''}`}>
      {compact ? (
        <span className="seo-empty-icon">
          <Icon
            name={
              kind === 'search'
                ? 'search'
                : kind === 'links'
                  ? 'share'
                  : kind === 'monitoring'
                    ? 'bell'
                    : 'monitor'
            }
            className="size-7"
          />
        </span>
      ) : (
        <SeoWebsiteIllustration className="seo-empty-art" />
      )}
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function SeoHint({
  title,
  children,
  tone = 'info',
  icon = 'alert-circle',
}: {
  title?: string;
  children: ReactNode;
  tone?: SeoTone;
  icon?: string;
}) {
  return (
    <div className={`seo-hint seo-tone-${tone}`}>
      <Icon name={icon} className="mt-0.5 size-5 shrink-0" />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
export function SeoBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: SeoTone;
}) {
  return <span className={`seo-badge seo-tone-${tone}`}>{children}</span>;
}
export const SEVERITY_LABELS: Record<SeoSeverity, string> = {
  critical: 'Urgent',
  high: 'High priority',
  moderate: 'Worth improving',
  low: 'Small improvement',
  informational: 'For your information',
};
export function SeoSeverityBadge({
  severity,
  showMeaning = false,
}: {
  severity: string;
  showMeaning?: boolean;
}) {
  const tone: SeoTone =
    severity === 'critical'
      ? 'danger'
      : severity === 'high' || severity === 'moderate'
        ? 'warning'
        : severity === 'low'
          ? 'info'
          : 'neutral';
  return (
    <SeoBadge tone={tone}>
      {SEVERITY_LABELS[severity as SeoSeverity] ?? 'For review'}
      {showMeaning && (
        <span className="font-normal">
          {' '}
          ·{' '}
          {severity === 'critical'
            ? 'Review first'
            : severity === 'high'
              ? 'Plan a fix soon'
              : 'Review in context'}
        </span>
      )}
    </SeoBadge>
  );
}
export function SeoHorizontalBar({
  value,
  max,
  label,
  caption,
  tone = 'accent',
}: {
  value: number;
  max: number;
  label: string;
  caption?: string;
  tone?: SeoTone;
}) {
  return (
    <div className={`seo-horizontal-bar seo-tone-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString()}</strong>
      </div>
      <div className="seo-bar-track">
        <span style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
      </div>
      {caption && <p>{caption}</p>}
    </div>
  );
}
