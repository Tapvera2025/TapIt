import { useCallback, useEffect, useRef, useState } from 'react';
import { listBidPool, type MaskedBidCard } from './api.js';
import { PassCooldown, prependCard, removeCard } from './bidPool-helpers.js';

/**
 * Bid-pool subscription hook (R1 plan step 1.13).
 *
 * R1 ships the polling fallback the plan calls for in its risks table:
 * "Bid-pool WebSocket flakes under load → Fall back to 15-second poll
 * if WS disconnects". The WebSocket path lands with its own PR; this
 * hook's surface is stable so swapping transports is one import away.
 *
 * The cooldown is held in a ref so Pass hides the card locally for 5
 * minutes regardless of what the poll returns in the meantime.
 */

const POLL_INTERVAL_MS = 15_000;

export interface UseBidPool {
  readonly cards: readonly MaskedBidCard[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly removeLocally: (leadId: string, options?: { cooldown?: boolean }) => void;
  readonly addLocally: (card: MaskedBidCard) => void;
}

export function useBidPool(): UseBidPool {
  const [cards, setCards] = useState<readonly MaskedBidCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useRef(new PassCooldown());
  const mounted = useRef(true);

  const applySnapshot = useCallback((snapshot: readonly MaskedBidCard[]) => {
    if (!mounted.current) return;
    const filtered = snapshot.filter((card) => !cooldown.current.isCoolingDown(card.leadId));
    setCards(filtered);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await listBidPool();
      applySnapshot(result.items);
      if (mounted.current) setError(null);
    } catch (cause: unknown) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : 'Unable to load bid pool.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const removeLocally = useCallback((leadId: string, options: { cooldown?: boolean } = {}) => {
    if (options.cooldown) cooldown.current.passUntil(leadId);
    setCards((prev) => removeCard(prev, leadId));
  }, []);

  const addLocally = useCallback((card: MaskedBidCard) => {
    if (cooldown.current.isCoolingDown(card.leadId)) return;
    setCards((prev) => prependCard(prev, card));
  }, []);

  return { cards, loading, error, refresh, removeLocally, addLocally };
}
