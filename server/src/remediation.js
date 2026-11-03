// Automatic remediation for Part 1 ("Release and Remediate").
//
// The reactions/comments API reports every request outcome to an
// ErrorRateMonitor. If the error rate inside a sliding window crosses the
// threshold, the monitor POSTs to a LaunchDarkly *flag trigger* URL. The
// trigger turns `wall-reactions-comments` OFF, the change streams to every open
// browser, and the broken feature disappears - no deploy, no page reload.
//
// You can fire the same trigger by hand:  npm run trigger   (or curl -X POST $LD_TRIGGER_URL)

export class ErrorRateMonitor {
  /**
   * @param {object} opts
   * @param {number} opts.windowMs     sliding window size
   * @param {number} opts.threshold    error ratio (0-1) that trips the monitor
   * @param {number} opts.minRequests  don't trip on tiny samples
   * @param {number} [opts.cooldownMs] minimum time between two trips
   * @param {() => Promise<void>} opts.onTrip  called when the threshold is crossed
   * @param {() => number} [opts.now]
   */
  constructor({ windowMs, threshold, minRequests, cooldownMs = 30_000, onTrip, now = Date.now }) {
    Object.assign(this, { windowMs, threshold, minRequests, cooldownMs, onTrip, now });
    this.events = [];
    this.lastTripAt = -Infinity;
    this.trips = [];
  }

  record(ok) {
    const t = this.now();
    this.events.push({ t, ok });
    this.events = this.events.filter((e) => t - e.t <= this.windowMs);
    const stats = this.stats();
    if (stats.total >= this.minRequests && stats.errorRate >= this.threshold && t - this.lastTripAt > this.cooldownMs) {
      this.lastTripAt = t;
      this.trips.push({ at: new Date(t).toISOString(), ...stats });
      // Clear the window so recovery starts from a clean slate.
      this.events = [];
      Promise.resolve(this.onTrip(stats)).catch((err) => console.error('[remediation] trip handler failed:', err));
      return true;
    }
    return false;
  }

  stats() {
    const total = this.events.length;
    const errors = this.events.filter((e) => !e.ok).length;
    return { total, errors, errorRate: total ? errors / total : 0 };
  }
}

/** POST to a LaunchDarkly flag trigger URL. Triggers need no auth header: the URL is the secret. */
export async function fireTrigger(url, reason) {
  if (!url) {
    console.warn('[remediation] LD_TRIGGER_URL is not set - cannot fire trigger. Turn the flag off in the dashboard instead.');
    return { fired: false, reason: 'LD_TRIGGER_URL not configured' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The body is optional; LaunchDarkly records it in the flag's audit log.
    body: JSON.stringify({ source: 'tatami-auto-remediation', reason }),
  });
  console.warn(`[remediation] fired LaunchDarkly trigger (${res.status}) - reason: ${reason}`);
  return { fired: res.ok, status: res.status };
}
