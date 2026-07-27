import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { wonShort } from '../summary';

const C = {
  bg: '#17171C', card2: '#26262C', text: '#E5E8EB',
  sub: '#8B95A1', faint: '#6B7684',
  blue: '#3182F6', blueText: '#4E9BFA', green: '#16C47F', gold: '#E5B84B', red: '#F04452',
};

// 홈 화면 위젯 — 오늘/이번 달 지출, 예산 진행, 금주·금연 일수
export function CleanpayWidget({ data }) {
  const d = data || {};
  const hasBudget = !!d.budgetTotal;
  const overBudget = hasBudget && d.budgetLeft < 0;
  const todayColor = d.todayLeft == null ? C.text : d.todayLeft < 0 ? C.red : C.blueText;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent', width: 'match_parent',
        flexDirection: 'column', justifyContent: 'space-between',
        backgroundColor: C.bg, borderRadius: 20, padding: 14,
      }}
    >
      {/* 상단: 오늘 쓴 돈 */}
      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
        <TextWidget text="오늘 쓴 돈" style={{ fontSize: 11, color: C.sub }} />
        <TextWidget
          text={`${wonShort(d.todaySum)}원`}
          style={{ fontSize: 24, fontWeight: 'bold', color: C.text }}
        />
        {d.todayLeft != null && (
          <TextWidget
            text={d.todayLeft >= 0
              ? `오늘 ${wonShort(d.todayLeft)}원 더 쓸 수 있어요`
              : `오늘 ${wonShort(-d.todayLeft)}원 초과`}
            style={{ fontSize: 10.5, color: todayColor }}
          />
        )}
      </FlexWidget>

      {/* 중간: 이번 달 */}
      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 6 }}>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between' }}>
          <TextWidget text={`${d.month || ''}월 지출`} style={{ fontSize: 11, color: C.sub }} />
          <TextWidget
            text={`${wonShort(d.monthSum)}원`}
            style={{ fontSize: 12, fontWeight: 'bold', color: C.text }}
          />
        </FlexWidget>
        {hasBudget && (
          <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', marginTop: 2 }}>
            <TextWidget
              text={`예산 ${d.budgetPct}%`}
              style={{ fontSize: 10.5, color: C.faint }}
            />
            <TextWidget
              text={overBudget ? `${wonShort(-d.budgetLeft)}원 초과` : `${wonShort(d.budgetLeft)}원 남음`}
              style={{ fontSize: 10.5, color: overBudget ? C.red : C.green, fontWeight: 'bold' }}
            />
          </FlexWidget>
        )}
        {!hasBudget && d.topCatLabel && (
          <TextWidget
            text={`${d.topCatLabel} ${wonShort(d.topCatAmount)}원`}
            style={{ fontSize: 10.5, color: d.topCatColor || C.faint, marginTop: 2 }}
          />
        )}
      </FlexWidget>

      {/* 하단: 금주 · 금연 */}
      {(d.soberDays != null || d.smokeDays != null) && (
        <FlexWidget
          style={{
            flexDirection: 'row', width: 'match_parent', marginTop: 8,
            backgroundColor: C.card2, borderRadius: 12, padding: 8,
            justifyContent: 'space-around', alignItems: 'center',
          }}
        >
          <TextWidget
            text={`금주 ${d.soberDays ?? '-'}일`}
            style={{ fontSize: 11.5, color: C.green, fontWeight: 'bold' }}
          />
          <TextWidget
            text={`금연 ${d.smokeDays ?? '-'}일`}
            style={{ fontSize: 11.5, color: C.blueText, fontWeight: 'bold' }}
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
