package com.github.Qortal.qortalMobile;

/**
 * Paces the hub redial after a switch of default network. A switch comes as
 * a burst of callbacks, so the redial waits until the network has settled;
 * and a flaky network can switch every few seconds, while each redial costs
 * three DNS lookups and TCP connects and rebuilds every link. Redials are
 * therefore at least {@link #MIN_INTERVAL_MS} apart, with one more at the end
 * of that window for a switch that happened inside it.
 */
final class NetworkRefreshPacer {
    static final long SETTLE_MS = 2_000L;
    static final long MIN_INTERVAL_MS = 30_000L;

    private boolean ran;
    private long lastRunAt;
    private long switchedAt;

    /** A switch at {@code now}: returns how long to wait before redialling. */
    synchronized long onSwitch(long now) {
        switchedAt = now;
        long wait = SETTLE_MS;
        if (ran) wait = Math.max(wait, lastRunAt + MIN_INTERVAL_MS - now);
        return wait;
    }

    /** The redial runs at {@code now}: returns how long ago the switch was. */
    synchronized long onRun(long now) {
        ran = true;
        lastRunAt = now;
        return Math.max(0L, now - switchedAt);
    }
}
