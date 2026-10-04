import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.github.Qortal.qortalGo2',
  appName: 'GO 3.0',
  webDir: 'dist',
  // Capacitor's own logging is on by default in a debuggable build, and it
  // writes plugin arguments (key-derivation inputs, vault and API keys) to
  // logcat. Off in every build. This does not cover the WebView itself: in a
  // debuggable build Chromium still copies JS console messages to logcat.
  loggingBehavior: 'none',
  // Top-level backgroundColor is what Capacitor applies to the native WebView
  // (the SplashScreen-nested key is ignored for this). Matching the app's dark
  // base means a stalled/blank compositor surface shows the app color instead
  // of an off-tone gray.
  backgroundColor: '#0E0F14',
  android: {
    backgroundColor: '#0E0F14',
    // WebView DevTools (chrome://inspect) can read the unlocked wallet.
    // Pinned off (and not switchable) so a release, non-debuggable build
    // never ships with it. It has no effect on a debuggable build:
    // Chromium turns DevTools on for those itself and ignores this, so the
    // debug lab APK keeps chrome://inspect / CDP. Keeping debuggable builds
    // off users' phones is the gradle side (GO-02).
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'http',
  },
  // npx cap sync writes these into android res/xml/config.xml. DisableDeploy
  // makes Capacitor ignore a saved "serve GO from this folder" path
  // (serverBasePath), so nothing can swap the bundled app for other files
  // that load on every start (N-18). MainActivity also clears that path.
  cordova: {
    preferences: {
      DisableDeploy: 'true',
    },
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_qortal',
      iconColor: '#09B6E8',
    },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#0E0F14',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    CapacitorHttp: {
      enabled: false,
    },
  },
};

export default config;
