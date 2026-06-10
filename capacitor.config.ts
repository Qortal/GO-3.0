import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.github.Qortal.qortalGo2',
  appName: 'Qortal GO 2.0',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
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
