package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.provider.Settings;

/**
 * Shared radio/network probe for the tray dot and the in-app Reticulum badge.
 * Airplane with Wi-Fi/ethernet/VPN still on can reach the mesh; radios off cannot.
 */
public final class DeviceNetwork {
    private DeviceNetwork() {}

    public static boolean isAirplaneModeOn(Context context) {
        return Settings.Global.getInt(
            context.getContentResolver(),
            Settings.Global.AIRPLANE_MODE_ON,
            0
        ) != 0;
    }

    public static boolean isAvailable(Context context) {
        if (context == null) return false;
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        if (cm == null) return false;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            return false;
        }
        if (isAirplaneModeOn(context)) {
            return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
        }
        return true;
    }
}
