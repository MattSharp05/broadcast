"use client";

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * "Now" for labels and countdowns, updated on every minute boundary. A frozen clock (a Sandbox
 * scenario with `?now=`) never moves. Starts from the server's now, so the first render matches
 * the server's HTML.
 */
export function useMinuteClock(initial: Date, frozen: boolean): Date {
  const [now, setNow] = useState(initial);

  useEffect(() => {
    if (frozen) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const real = new Date();
      setNow(new Date(Math.floor(real.getTime() / MINUTE_MS) * MINUTE_MS));
      timer = setTimeout(tick, MINUTE_MS - (real.getTime() % MINUTE_MS) + 50);
    };
    timer = setTimeout(tick, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [initial, frozen]);

  return frozen || now < initial ? initial : now;
}
