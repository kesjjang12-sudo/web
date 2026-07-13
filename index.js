import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import App from './App';
import { BANK_PACKAGES } from './src/config';
import { parsePayment, classify } from './src/parser';
import { savePayment } from './src/store';

/**
 * 백그라운드 알림 처리 태스크
 * 앱이 꺼져 있어도 폰에 알림이 오면 이 함수가 실행됨
 */
const headlessNotificationListener = async ({ notification }) => {
  try {
    if (!notification) return;
    const n = typeof notification === 'string' ? JSON.parse(notification) : notification;

    // 1) 금융앱 알림만 필터링
    if (!BANK_PACKAGES.includes(n.app)) return;

    // 2) 알림 텍스트 합치기 (앱마다 title/text/bigText 위치가 다름)
    const fullText = [n.title, n.text, n.bigText, n.subText]
      .filter(Boolean).join(' ');

    // 3) 금액/가맹점 추출
    const parsed = parsePayment(fullText);
    if (!parsed) return;

    // 4) 위험 키워드 판별 → 클린/실패 분류
    const record = classify(parsed);

    // 5) 저장 + Supabase 동기화
    await savePayment({
      ...record,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: new Date().toISOString(),
      app: n.app,
    });
  } catch (e) {
    // 백그라운드 태스크는 조용히 실패해야 함
  }
};

AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => headlessNotificationListener,
);

registerRootComponent(App);
