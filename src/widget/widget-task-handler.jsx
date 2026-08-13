import React from 'react';
import { Linking } from 'react-native';
import { CleanpayWidget } from './CleanpayWidget';
import { buildSummary } from '../summary';

// 위젯이 추가/갱신/클릭될 때 안드로이드가 이 핸들러를 부른다 (앱이 꺼져 있어도 실행됨)
export async function widgetTaskHandler(props) {
  const { widgetAction, clickAction, renderWidget } = props;

  if (widgetAction === 'WIDGET_DELETED') return;

  if (widgetAction === 'WIDGET_CLICK' && clickAction === 'OPEN_APP') {
    try { await Linking.openURL('cleanpay://'); } catch (e) { /* 앱 열기 실패는 무시 */ }
  }

  let data = null;
  try { data = await buildSummary(); } catch (e) { /* 값 못 읽어도 빈 위젯은 그림 */ }
  renderWidget(<CleanpayWidget data={data} />);
}
