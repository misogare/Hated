import { useEffect, useState } from 'react';

/** The current time, refreshed every `everyMs`, for countdowns. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** "23 h 12 min", "41 min" or "under a minute": how long until `deadline`. */
export function timeLeft(deadline: string, now: number): string {
  const ms = Date.parse(deadline) - now;
  if (ms < 60_000) return 'under a minute';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes % 60} min`;
}
