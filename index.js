import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import { registerWidgetTaskHandler, requestWidgetUpdate } from 'react-native-android-widget';
import App from './App';
import { BANK_PACKAGES } from './src/config';
import { parsePayment } from './src/parser';
import { savePayment } from './src/store';
import { widgetTaskHandler } from './src/widget/widget-task-handler';
import { CleanpayWidget } from './src/widget/CleanpayWidget';
import { buildSummary } from './src/summary';

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

    // 4) 저장 (카테고리는 savePayment 안에서 자동 추측) + Supabase 동기화
    await savePayment({
      ...parsed,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: new Date().toISOString(),
      app: n.app,
    });

    // 5) 새 결제가 잡혔으니 홈 화면 위젯도 갱신
    try {
      const data = await buildSummary();
      requestWidgetUpdate({
        widgetName: 'Cleanpay',
        renderWidget: () => <CleanpayWidget data={data} />,
      });
    } catch (e) { /* 위젯이 없거나 실패해도 기록은 이미 저장됨 */ }
  } catch (e) {
    // 백그라운드 태스크는 조용히 실패해야 함
  }
};

AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => headlessNotificationListener,
);

// 홈 화면 위젯 (추가/갱신/클릭 처리)
registerWidgetTaskHandler(widgetTaskHandler);

registerRootComponent(App);
