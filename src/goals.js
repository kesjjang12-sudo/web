// 지출 목표(주간/월간/사용자 설정 기간) — 순수 날짜 계산만, 저장은 store.js가 담당
import { addDays, toDateOnly } from './recurring';

// 이번 주(월요일~일요일) 범위
export function weekRange(today) {
  const dow = today.getDay(); // 0=일 ... 6=토
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const start = addDays(today, mondayOffset);
  const end = addDays(start, 6);
  return { start, end };
}

// 이번 달 범위
export function monthRange(today) {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start, end };
}

// goal.kind에 따라 오늘 기준 실제 날짜 범위를 계산 (weekly/monthly는 항상 '현재' 기준으로 굴러감)
export function goalRange(goal, today) {
  if (goal.kind === 'weekly') return weekRange(today);
  if (goal.kind === 'monthly') return monthRange(today);
  return { start: toDateOnly(goal.startDate), end: toDateOnly(goal.endDate) };
}

export function fmtMD(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }

export function goalPeriodLabel(goal, today) {
  const { start, end } = goalRange(goal, today);
  if (goal.kind === 'weekly') return `이번 주 ${fmtMD(start)}~${fmtMD(end)}`;
  if (goal.kind === 'monthly') return `${start.getMonth() + 1}월`;
  return `${fmtMD(start)}~${fmtMD(end)}`;
}

export function goalKindLabel(kind) {
  return kind === 'weekly' ? '주간' : kind === 'monthly' ? '월간' : '기간 설정';
}

// 오늘이 범위 안에 있으면 남은 날짜, 지났으면 '종료됨'
export function daysLeftLabel(end, today) {
  const diff = Math.round((end - today) / 86400000);
  if (diff < 0) return '종료됨';
  if (diff === 0) return '오늘까지';
  return `${diff}일 남음`;
}
