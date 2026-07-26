// 고정지출(정기결제) 주기 계산 — 순수 날짜 계산만, 저장은 store.js가 담당
const MAX_GEN = 24; // 한 번에 자동 생성하는 최대 건수 (오래된 시작일로 폭주하는 것 방지)

export function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
export function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
// 'YYYY-MM-DD' 문자열을 로컬 자정 기준으로 파싱 (new Date(iso)는 UTC로 해석돼 시간대에 따라 하루 밀릴 수 있음)
export function toDateOnly(dateStr) {
  if (dateStr instanceof Date) return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// dayOfMonth 기준으로 since(제외) ~ until(포함) 사이에 있는 날짜들
export function monthlyOccurrences(dayOfMonth, since, until) {
  const out = [];
  let y = since.getFullYear(), m = since.getMonth();
  for (let i = 0; i < 1200 && out.length < MAX_GEN; i++) {
    const d = Math.min(dayOfMonth, daysInMonth(y, m));
    const cand = new Date(y, m, d);
    if (cand > since && cand <= until) out.push(cand);
    if (cand > until) break;
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

// anchorDate(시작일)를 기준으로 intervalDays 간격 날짜 중 since(제외) ~ until(포함) 사이에 있는 것들.
// since 경계와 무관하게 항상 시작일에 정렬되도록(예: 7일마다면 항상 시작일+7n) anchor부터 계산.
export function intervalOccurrences(anchorDate, intervalDays, since, until) {
  const out = [];
  let cur = anchorDate;
  if (cur <= since) {
    const diffDays = Math.round((since - cur) / 86400000);
    const steps = Math.floor(diffDays / intervalDays) + 1;
    cur = addDays(cur, steps * intervalDays);
  }
  for (let i = 0; i < 5000 && out.length < MAX_GEN; i++) {
    if (cur > until) break;
    if (cur > since) out.push(cur);
    cur = addDays(cur, intervalDays);
  }
  return out;
}

export function occurrencesSince(tpl, since, until) {
  if (tpl.cycle === 'monthly') return monthlyOccurrences(tpl.dayOfMonth, since, until);
  const interval = tpl.cycle === 'daily' ? 1 : Math.max(1, Number(tpl.intervalDays) || 1);
  return intervalOccurrences(toDateOnly(tpl.startDate), interval, since, until);
}

// lastGenerated가 없으면(신규 등록) startDate 자체부터 포함되도록 하루 전을 기준점으로
export function sinceAnchor(tpl) {
  return tpl.lastGenerated ? toDateOnly(tpl.lastGenerated) : addDays(toDateOnly(tpl.startDate), -1);
}

export function cycleLabel(tpl) {
  if (tpl.cycle === 'monthly') return `매월 ${tpl.dayOfMonth}일`;
  if (tpl.cycle === 'daily') return '매일';
  return `${tpl.intervalDays}일마다`;
}

// ── 실제 알림/수동 기록이 등록된 고정지출과 같은 건인지 매칭 ──
function normMerchant(s) { return (s || '').toLowerCase().replace(/\s+/g, ''); }

export function merchantMatches(a, b) {
  const na = normMerchant(a), nb = normMerchant(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

export function amountMatches(a, b, tolerance = 0.3) {
  if (!b) return false;
  return Math.abs(a - b) / b <= tolerance;
}

// record: { merchant, amount, ts(ISO) }. 날짜가 주기상 발생 예정일 근처(±dayWindow일)인지,
// 가맹점/금액이 비슷한지 함께 확인해서 실제 이체가 고정지출과 같은 건인지 판단.
export function matchesRecurring(record, tpl, dayWindow = 3) {
  if (!tpl.active) return false;
  if (!merchantMatches(record.merchant, tpl.merchant)) return false;
  if (!amountMatches(record.amount, tpl.amount)) return false;
  const d = toDateOnly(new Date(record.ts));
  const winStart = addDays(d, -dayWindow - 1); // occurrencesSince의 since는 제외 경계라 하루 더 당김
  const winEnd = addDays(d, dayWindow);
  return occurrencesSince(tpl, winStart, winEnd).length > 0;
}

export function findRecurringMatch(record, templates) {
  return templates.find(tpl => matchesRecurring(record, tpl)) || null;
}

export function nextDueLabel(tpl) {
  const since = sinceAnchor(tpl);
  const far = new Date(since.getFullYear() + 2, 0, 1);
  const occ = occurrencesSince(tpl, since, far);
  if (!occ.length) return '';
  const n = occ[0];
  return `다음 ${n.getMonth() + 1}월 ${n.getDate()}일`;
}
