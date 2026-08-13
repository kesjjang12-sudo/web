// 알림 리스너 라이브러리가 매니페스트에 allowBackup=false를 넣어서
// Expo 기본값(true)과 충돌 → 빌드 실패. 앱 쪽 값이 이기도록 tools:replace 지정.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withAllowBackupFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
    const app = manifest.application[0];
    app.$['tools:replace'] = 'android:allowBackup';
    return config;
  });
};
