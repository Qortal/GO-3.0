package com.github.Qortal.qortalMobile;

/**
 * Paces the hub redial after a switch of default network. A switch comes as
 * a burst of callbacks, so the redial waits until the network has settled;
 * and a flaky network can switch every few seconds, while each redial costs
 * three DNS lookups and TCP connects and rebuilds every link. Redials are
 * therefore at least {@link #MIN_INTERVAL_MS} apart, with one more at the end
 * of that window for a switch that happened inside it.
 *
 * In a call both waits are short: a call carried by the hubs is silent until
 * they are redialled, and it does not last all day. When the old network was
 * gone before the new one came (Wi-Fi out of reach, then mobile data), the
 * time in between counts as settling.
 */
final class NetworkRefreshPacer {
    static final long SETTLE_MS = 2_000L;
    static final long MIN_INTERVAL_MS = 30_000L;
    static final long CALL_SETTLE_MS = 500L;
    /** Even with the old network long gone, the new one gets this long. */
    static final long CALL_NEW_NETWORK_MS = 100L;
    static final long CALL_MIN_INTERVAL_MS = 2_000L;

    private boolean ran;
    private long lastRunAt;
    private long switchedAt;
    /** When the switch began: the loss of the old network, if that came first. */
    private long changedAt;
    private boolean lost;
    private long lostAt;
    /** A switch has not been followed by its redial yet. */
    private boolean waiting;

    /** The default network went away at {@code now}, with no other one yet. */
    synchronized void onLost(long now) {
        lost = true;
        lostAt = now;
    }

    /** A switch at {@code now}: returns how long to wait before redialling. */
    synchronized long onSwitch(long now, boolean inCall) {
        switchedAt = now;
        changedAt = lost ? lostAt : now;
        lost = false;
        waiting = true;
        return waitFrom(now, inCall);
    }

    /**
     * A call begins at {@code now}: returns how long a redial that is still
     * waiting has left now, or -1 when there is none.
     */
    synchronized long onCallStart(long now) {
        return waiting ? waitFrom(now, true) : -1L;
    }

    /** The redial runs at {@code now}: returns how long ago the switch was. */
    synchronized long onRun(long now) {
        ran = true;
        waiting = false;
        lastRunAt = now;
        return Math.max(0L, now - switchedAt);
    }

    private long waitFrom(long now, boolean inCall) {
        long due = inCall
            ? Math.max(changedAt + CALL_SETTLE_MS, switchedAt + CALL_NEW_NETWORK_MS)
            : switchedAt + SETTLE_MS;
        if (ran) {
            due = Math.max(due, lastRunAt + (inCall ? CALL_MIN_INTERVAL_MS : MIN_INTERVAL_MS));
        }
        return Math.max(0L, due - now);
    }
}
