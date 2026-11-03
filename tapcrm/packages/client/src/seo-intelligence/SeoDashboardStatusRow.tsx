/**
 * The "Beyond the checkup" status row on the Overview dashboard.
 *
 * Three compact tiles that pulse the signals the crawler can't see:
 *   1. Google traffic — 28-day clicks + impressions + delta vs previous 28 days.
 *   2. Core Web Vitals — latest origin-level LCP / INP / CLS with ratings.
 *   3. AI Visibility — % of prompts that cited the domain, from recent observations.
 *
 * Each tile fetches its own data in parallel and is independently resilient —
 * a failing GSC call never prevents the CWV tile from rendering. Every tile
 * surfaces an "unavailable" state honestly (zero-fabrication) rather than
 * showing a stale or made-up zero.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon.js';
import {
  listGscMetrics,
  listSeoCwvObservations,
  listSeoAiObservations,
} from './api.js';
import type { SeoSection } from './seo-navigation.js';
import type { SeoCwvObservation, SeoAiObservation, SeoGscMetrics } from './types.js';

export function SeoDashboardStatusRow({
  siteId,
  onNavigate,
}: {
  siteId: string;
  onNavigate: (section: SeoSection) => void;
}) {
  return (
    <section className="seo-surface p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="seo-subtitle">Beyond the checkup</h3>
          <p className="seo-small-copy mt-1">
            Signals from Google and AI that live outside the crawler. Click a tile for the full view.
          </p>
        </div>
      </div>
      <div className="seo-status-row">
        <GoogleTrafficTile siteId={siteId} onNavigate={onNavigate} />
        <CwvStatusTile siteId={siteId} onNavigate={onNavigate} />
        <AiVisibilityTile siteId={siteId} onNavigate={onNavigate} />
      </div>
    </section>
  );
}

// ─── Google traffic ──────────────────────────────────────────────────────────

function GoogleTrafficTile({
  siteId,
  onNavigate,
}: {
  siteId: string;
  onNavigate: (section: SeoSection) => void;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [currentClicks, setCurrentClicks] = useState(0);
  const [currentImpressions, setCurrentImpressions] = useState(0);
  const [previousClicks, setPreviousClicks] = useState(0);

  useEffect(() => {
    const today = new Date();
    const toIso = (d: Date) => d.toISOString().slice(0, 10);
    const start28 = new Date(today);
    start28.setDate(start28.getDate() - 27);
    const start56 = new Date(today);
    start56.setDate(start56.getDate() - 55);
    const endPrev = new Date(today);
    endPrev.setDate(endPrev.getDate() - 28);

    let cancelled = false;
    Promise.all([
      listGscMetrics(siteId, toIso(start28), toIso(today), 5000),
      listGscMetrics(siteId, toIso(start56), toIso(endPrev), 5000),
    ])
      .then(([current, previous]: [SeoGscMetrics[], SeoGscMetrics[]]) => {
        if (cancelled) return;
        if (current.length === 0 && previous.length === 0) {
          setState('empty');
          return;
        }
        setCurrentClicks(current.reduce((sum, row) => sum + (row.clicks ?? 0), 0));
        setCurrentImpressions(current.reduce((sum, row) => sum + (row.impressions ?? 0), 0));
        setPreviousClicks(previous.reduce((sum, row) => sum + (row.clicks ?? 0), 0));
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const deltaPct =
    previousClicks > 0
      ? Math.round(((currentClicks - previousClicks) / previousClicks) * 100)
      : null;
  const deltaTone = deltaPct == null ? 'neutral' : deltaPct > 0 ? 'good' : deltaPct < 0 ? 'bad' : 'neutral';

  return (
    <button
      type="button"
      className="seo-status-tile"
      onClick={() => onNavigate('search-performance')}
    >
      <div className="seo-status-tile-head">
        <span className="seo-status-tile-icon seo-status-tile-icon-google">
          <Icon name="trending-up" className="size-4" />
        </span>
        <span className="seo-status-tile-label">Google traffic (28d)</span>
      </div>
      {state === 'loading' ? (
        <p className="seo-status-tile-body">Loading…</p>
      ) : state === 'empty' ? (
        <p className="seo-status-tile-body">
          No Google Search Console data yet. Connect GSC to see clicks and impressions.
        </p>
      ) : state === 'error' ? (
        <p className="seo-status-tile-body">Could not load Google traffic.</p>
      ) : (
        <>
          <p className="seo-status-tile-value">{currentClicks.toLocaleString()}</p>
          <p className="seo-status-tile-sub">
            clicks · {currentImpressions.toLocaleString()} impressions
          </p>
          {deltaPct != null && (
            <p className={`seo-status-tile-delta seo-status-tile-delta-${deltaTone}`}>
              {deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : '•'} {Math.abs(deltaPct)}% vs previous 28 days
            </p>
          )}
        </>
      )}
    </button>
  );
}

// ─── Core Web Vitals ─────────────────────────────────────────────────────────

function CwvStatusTile({
  siteId,
  onNavigate,
}: {
  siteId: string;
  onNavigate: (section: SeoSection) => void;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [latest, setLatest] = useState<SeoCwvObservation | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSeoCwvObservations(siteId, { limit: 20 })
      .then((rows: SeoCwvObservation[]) => {
        if (cancelled) return;
        const origin = rows.find((row) => row.url === null) ?? rows[0] ?? null;
        if (!origin) {
          setState('empty');
          return;
        }
        setLatest(origin);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  return (
    <button type="button" className="seo-status-tile" onClick={() => onNavigate('performance')}>
      <div className="seo-status-tile-head">
        <span className="seo-status-tile-icon seo-status-tile-icon-cwv">
          <Icon name="zap" className="size-4" />
        </span>
        <span className="seo-status-tile-label">Core Web Vitals</span>
      </div>
      {state === 'loading' ? (
        <p className="seo-status-tile-body">Loading…</p>
      ) : state === 'empty' ? (
        <p className="seo-status-tile-body">
          No CrUX data yet. Field data appears once Chrome has enough samples for your site.
        </p>
      ) : state === 'error' || !latest ? (
        <p className="seo-status-tile-body">Could not load Core Web Vitals.</p>
      ) : (
        <>
          <div className="seo-cwv-metric-row">
            <CwvMetric
              label="LCP"
              value={latest.lcpP75 != null ? `${(latest.lcpP75 / 1000).toFixed(1)}s` : null}
              rating={latest.lcpRating}
            />
            <CwvMetric
              label="INP"
              value={latest.inpP75 != null ? `${latest.inpP75}ms` : null}
              rating={latest.inpRating}
            />
            <CwvMetric
              label="CLS"
              value={latest.clsP75 != null ? latest.clsP75.toFixed(2) : null}
              rating={latest.clsRating}
            />
          </div>
          <p className="seo-status-tile-sub">75th-percentile, origin-level, mobile</p>
        </>
      )}
    </button>
  );
}

function CwvMetric({
  label,
  value,
  rating,
}: {
  label: string;
  value: string | null;
  rating: 'good' | 'needs_improvement' | 'poor' | null;
}) {
  const tone = rating === 'good' ? 'good' : rating === 'poor' ? 'bad' : rating === 'needs_improvement' ? 'warn' : 'neutral';
  return (
    <div className="seo-cwv-metric">
      <p className="seo-cwv-metric-label">{label}</p>
      <p className={`seo-cwv-metric-value seo-cwv-metric-${tone}`}>{value ?? '—'}</p>
    </div>
  );
}

// ─── AI Visibility ───────────────────────────────────────────────────────────

function AiVisibilityTile({
  siteId,
  onNavigate,
}: {
  siteId: string;
  onNavigate: (section: SeoSection) => void;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [observed, setObserved] = useState(0);
  const [cited, setCited] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listSeoAiObservations(siteId, { limit: 100 })
      .then((rows: SeoAiObservation[]) => {
        if (cancelled) return;
        if (rows.length === 0) {
          setState('empty');
          return;
        }
        setObserved(rows.length);
        setCited(rows.filter((row) => row.domainCited).length);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const pct = observed > 0 ? Math.round((cited / observed) * 100) : null;
  const tone = pct == null ? 'neutral' : pct >= 40 ? 'good' : pct >= 15 ? 'warn' : 'bad';

  return (
    <button
      type="button"
      className="seo-status-tile"
      onClick={() => onNavigate('ai-visibility')}
    >
      <div className="seo-status-tile-head">
        <span className="seo-status-tile-icon seo-status-tile-icon-ai">
          <Icon name="sparkles" className="size-4" />
        </span>
        <span className="seo-status-tile-label">AI Visibility</span>
      </div>
      {state === 'loading' ? (
        <p className="seo-status-tile-body">Loading…</p>
      ) : state === 'empty' ? (
        <p className="seo-status-tile-body">
          No AI observations yet. The next AI visibility run will check whether AI assistants cite your domain.
        </p>
      ) : state === 'error' ? (
        <p className="seo-status-tile-body">Could not load AI visibility.</p>
      ) : (
        <>
          <p className={`seo-status-tile-value seo-status-tile-value-${tone}`}>{pct}%</p>
          <p className="seo-status-tile-sub">
            of {observed} recent prompts cited {cited === 0 ? 'you nowhere' : `your domain (${cited})`}
          </p>
        </>
      )}
    </button>
  );
}
