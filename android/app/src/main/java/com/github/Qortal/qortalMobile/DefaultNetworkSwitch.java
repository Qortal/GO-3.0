package com.github.Qortal.qortalMobile;

/**
 * Tells a real switch of the default network (Wi-Fi to mobile data, a new
 * Wi-Fi network, the same one back after it was lost) apart from the repeats
 * a default network callback delivers for the network already in use.
 * Networks are identified by {@code Network.getNetworkHandle()}.
 */
final class DefaultNetworkSwitch {
    private boolean hasCurrent;
    private long current;
    private boolean currentLost;

    /**
     * The default network is {@code handle} now. Returns true when it
     * replaces an earlier one, or the same one after it was lost: the hub
     * sockets opened before belong to a network that is gone or no longer
     * the default. The first network seen is not a switch.
     */
    synchronized boolean onAvailable(long handle) {
        boolean switched = hasCurrent && (handle != current || currentLost);
        hasCurrent = true;
        current = handle;
        currentLost = false;
        return switched;
    }

    /**
     * {@code handle} went away; only the current default network counts.
     * Returns whether it was that one.
     */
    synchronized boolean onLost(long handle) {
        if (!hasCurrent || handle != current) return false;
        currentLost = true;
        return true;
    }

    /**
     * There was no default network when tracking started (GO opened
     * offline): the hubs then wait in their reconnect backoff, so the first
     * network that comes up is a switch too.
     */
    synchronized void seedNoNetwork() {
        if (hasCurrent) return;
        hasCurrent = true;
        current = Long.MIN_VALUE;
        currentLost = true;
    }
}
