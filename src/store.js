import AsyncStorage from '@react-native-async-storage/async-storage';
import { guessCategory, parsePayment } from './parser';
import { supabase, hasSupabase } from './supabase';
import { occurrencesSince, sinceAnchor, findRecurringMatch, merchantMatches } from './recurring';

const KEY = 'payments_v1';
const MERCHANT_CAT_KEY = 'merchant_categories_v1';

// 같은 결제로 볼 시간 범위 (카드앱 푸시와 문자가 몇 십 초 차이로 도착)
const DUP_WINDOW_MS = 3 * 60 * 1000;

// 알림 출처를 큰 갈래로 나눔: 문자 / 은행앱·카드앱 / 직접입력 등
function sourceKind(app) {
  if (!app || app === 'manual' || app === 'recurring' || app === 'restored' || app === 'test') return 'manual';
  if (/messaging/.test(app)) return 'sms';
  return 'app';
}
// 문자 ↔ 카드앱처럼 서로 다른 경로로 들어온 알림인지 (둘 다 자동 감지된 것일 때만)
function isDifferentSource(a, b) {
  const ka = sourceKind(a), kb = sourceKind(b);
  if (ka === 'manual' || kb === 'manual') return false;
  return ka !== kb;
}
const BUDGET_KEY = 'budgets_v1';
const DIARY_KEY = 'diary_v1';
const QUIT_SET_KEY = 'quit_settings_v1';

// ---------------- 금주/금연 일기 ----------------
export async function getDiary() {
  try {
    const raw = await AsyncStorage.getItem(DIARY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
export async function addDiary(text, ts) {
  const list = await getDiary();
  const next = [{ id: `d_${Date.now()}`, ts: ts || new Date().toISOString(), text }, ...list]
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 1000);
  await AsyncStorage.setItem(DIARY_KEY, JSON.stringify(next));
  return next;
}
export async function deleteDiary(id) {
  const next = (await getDiary()).filter(d => d.id !== id);
  await AsyncStorage.setItem(DIARY_KEY, JSON.stringify(next));
  return next;
}

// ---------------- 금주/금연 시작일 (사용자별로 다름 — 처음엔 오늘로 설정) ----------------
const QUIT_DATES_KEY = 'quit_dates_v1';

export async function getQuitDates() {
  try {
    const raw = await AsyncStorage.getItem(QUIT_DATES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // 이 키가 없다는 건 이전 버전(고정 시작일 2026-07-13)에서 막 올라왔거나 새 설치라는 뜻.
  // 기존 사용자의 진행일수가 갑자기 리셋되지 않도록 이전 고정값을 기본값으로 사용.
  // 새로 설치한 사람은 "아낀돈 탭 → 시작일 바꾸기"에서 본인 날짜로 바꾸면 됨.
  const def = { sober: '2026-07-13', smoke: '2026-07-13' };
  await AsyncStorage.setItem(QUIT_DATES_KEY, JSON.stringify(def));
  return def;
}

export async function saveQuitDates(dates) {
  await AsyncStorage.setItem(QUIT_DATES_KEY, JSON.stringify(dates));
  if (!hasSupabase) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('profiles').update({ sober_start: dates.sober, smoke_start: dates.smoke }).eq('id', user.id);
  } catch (e) { /* 오프라인이면 무시, 다음 저장 때 재시도됨 */ }
}

// ---------------- 아낀 돈 계산 기준 (하루 술값 / 담배 개비 / 갑 가격) ----------------
export async function getQuitSettings() {
  try {
    const raw = await AsyncStorage.getItem(QUIT_SET_KEY);
    return raw ? JSON.parse(raw) : { soberPerDay: 15000, cigsPerDay: 10, packPrice: 4500 };
  } catch { return { soberPerDay: 15000, cigsPerDay: 10, packPrice: 4500 }; }
}
export async function saveQuitSettings(s) {
  await AsyncStorage.setItem(QUIT_SET_KEY, JSON.stringify(s));
}

// 예산: { total: 전체 월예산(0=미설정), cats: { food: 금액, ... } }
export async function getBudgets() {
  try {
    const raw = await AsyncStorage.getItem(BUDGET_KEY);
    return raw ? JSON.parse(raw) : { total: 0, cats: {} };
  } catch { return { total: 0, cats: {} }; }
}
export async function saveBudgets(b) {
  await AsyncStorage.setItem(BUDGET_KEY, JSON.stringify(b));
}

export async function getPayments() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    let migrated = false;
    // 예전 버전(클린/실패) 기록 마이그레이션: category 없으면 추측해서 채움
    const memory = await getMerchantMap();
    for (const p of list) {
      if (!p.category) { p.category = guessCategory(p.merchant, memory); migrated = true; }
    }
    // 파서 개선 후 1회 재분석: 잘못 잡힌 이름 교정, 이제 걸러야 하는 알림(카드값 출금 등)은 삭제 처리
    if (!(await AsyncStorage.getItem('reparse_v1_done'))) {
      for (const p of list) {
        if (!p.raw || p.deleted || p.app === 'manual' || p.type === 'income') continue;
        const re = parsePayment(p.raw);
        if (!re) { p.deleted = true; migrated = true; }
        else if (re.merchant !== p.merchant && re.merchant !== '알수없음') { p.merchant = re.merchant; migrated = true; }
      }
      await AsyncStorage.setItem('reparse_v1_done', '1');
    }
    if (migrated) await AsyncStorage.setItem(KEY, JSON.stringify(list));
    return list;
  } catch { return []; }
}

export async function savePayment(record) {
  const list = await getPayments();

  // 문자에 잔액이 찍혀 왔으면 통장 잔액으로 기록 (결제 저장 여부와 무관하게)
  if (record.balance != null) {
    await recordBalance(record.balance, record.ts, record.app);
    delete record.balance;
  }

  // 결제 취소/환불 알림: 원래 결제를 찾아 '환불됨'으로 표시해 합계에서 빼줌.
  // 원 결제를 못 찾으면(앱 설치 전 결제 등) 환불 기록만 따로 남겨 사용자가 확인할 수 있게 함.
  if (record.refund && record.type !== 'income') {
    const rTs = new Date(record.ts);
    const origin = list.find(p => !p.deleted && !p.refunded && !p.isRefund
      && p.amount === record.amount
      && merchantMatches(p.merchant, record.merchant)
      && rTs - new Date(p.ts) >= 0 && rTs - new Date(p.ts) < 90 * 86400000);
    if (origin) {
      origin.refunded = true;
      origin.refundedAt = record.ts;
      await AsyncStorage.setItem(KEY, JSON.stringify(list));
      deleteFromSupabase(origin.id); // 환불된 건 공유 페이지에서도 빠지도록
      return list;
    }
    record.isRefund = true; // 짝을 못 찾은 환불 — 목록에 별도 표시
  }

  // 고정지출과 매칭되는 실제 이체/알림이면 자동생성 항목과 합치거나, 다음 자동생성을 건너뛰게 함
  // (예: 매주 일요일 헌금 자동등록 + 실제 이체 알림이 둘 다 잡혀서 이중지출 되는 것 방지)
  if (record.app !== 'recurring' && !record.recurringId && !record.isRefund
      && record.type !== 'income' && record.type !== 'saving') {
    const templates = await getRecurring();
    const matched = findRecurringMatch(record, templates.filter(t => t.active));
    if (matched) {
      const recTs = new Date(record.ts);
      const dateKey = `${recTs.getFullYear()}-${String(recTs.getMonth()+1).padStart(2,'0')}-${String(recTs.getDate()).padStart(2,'0')}`;
      const placeholder = list.find(p => p.recurringId === matched.id && p.app === 'recurring' && !p.deleted
        && Math.abs(new Date(p.ts) - recTs) < 5 * 86400000);
      if (placeholder) {
        // 이미 자동으로 채워둔 항목을 실제 데이터로 교체 (별도 항목을 새로 만들지 않음)
        placeholder.ts = record.ts;
        placeholder.amount = record.amount;
        placeholder.app = record.app;
        if (record.category) placeholder.category = record.category;
        placeholder.confirmed = true;
        await AsyncStorage.setItem(KEY, JSON.stringify(list));
        await advanceRecurringLastGenerated(matched.id, dateKey);
        syncToSupabase(placeholder);
        return list;
      }
      // 자동생성보다 실제 알림이 먼저 온 경우: 이 기록에 태그만 남기고 다음 자동생성을 건너뛰게 함
      record.recurringId = matched.id;
      record.confirmed = true;
      await advanceRecurringLastGenerated(matched.id, dateKey);
    }
  }

  // 같은 결제가 여러 알림으로 중복 저장되는 것 방지.
  // 카드앱 푸시와 문자가 같이 오면 가맹점 표기가 다르고(예: "이마트24" vs "이마트24군포복합")
  // 도착 시간도 몇 십 초씩 벌어지므로, 금액+시간 근접을 기본으로 보고
  // (가맹점 유사) 또는 (알림 출처가 서로 다름)이면 같은 결제로 판단한다.
  const dup = list.find(p => {
    if (p.deleted || p.amount !== record.amount) return false;
    const gap = Math.abs(new Date(p.ts) - new Date(record.ts));
    if (gap > DUP_WINDOW_MS) return false;
    if (merchantMatches(p.merchant, record.merchant)) return true;
    return isDifferentSource(p.app, record.app); // 문자 ↔ 카드앱처럼 출처가 다르면 같은 건으로 봄
  });
  if (dup) {
    // 더 정보가 많은 가맹점명으로 보정 (예: '알수없음' → 실제 상호)
    if ((dup.merchant === '알수없음' || dup.merchant.length < record.merchant.length)
        && record.merchant !== '알수없음') {
      dup.merchant = record.merchant;
      await AsyncStorage.setItem(KEY, JSON.stringify(list));
      syncToSupabase(dup);
    }
    return list;
  }
  if (!record.category) {
    const memory = await getMerchantMap();
    record.category = guessCategory(record.merchant, memory);
  }
  const next = [record, ...list].slice(0, 5000);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  syncToSupabase(record); // 실패해도 앱 동작에는 지장 없음
  return next;
}

async function advanceRecurringLastGenerated(id, dateKey) {
  const list = await getRecurring();
  const tpl = list.find(t => t.id === id);
  if (!tpl) return;
  if (!tpl.lastGenerated || tpl.lastGenerated < dateKey) {
    tpl.lastGenerated = dateKey;
    await saveRecurringList(list);
  }
}

// 내역 수정 (카테고리/메모). 카테고리를 바꾸면 같은 가맹점을 기억해 이후 자동 분류에 반영
export async function updateItem(id, { category, memo }) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (!rec) return list;
  const catChanged = category != null && category !== rec.category;
  if (category != null) rec.category = category;
  if (memo != null) rec.memo = memo;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  if (catChanged) {
    const memory = await getMerchantMap();
    memory[rec.merchant] = category;
    await AsyncStorage.setItem(MERCHANT_CAT_KEY, JSON.stringify(memory));
  }
  syncToSupabase(rec);
  return list;
}

// 엔빵(나눠 내기): 카드로 전체 금액을 결제했지만 실제 내 몫만 지출로 잡고 싶을 때.
// 처음 분할할 때만 원래 금액을 originalAmount에 보존해두고, amount는 내 몫으로 바꿈.
export async function applySplit(id, newAmount, splitCount) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (!rec) return list;
  if (rec.originalAmount == null) rec.originalAmount = rec.amount;
  rec.amount = newAmount;
  rec.splitCount = splitCount || null;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  syncToSupabase(rec);
  return list;
}

// 분할 해제: 원래 결제 금액으로 되돌림
export async function clearSplit(id) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (!rec || rec.originalAmount == null) return list;
  rec.amount = rec.originalAmount;
  delete rec.originalAmount;
  delete rec.splitCount;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  syncToSupabase(rec);
  return list;
}

// 소프트 삭제: 목록에서 숨기고 '삭제된 항목'으로 이동 (복원 가능)
export async function deletePayment(id) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (rec) rec.deleted = true;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  deleteFromSupabase(id); // 웹 조회 페이지에서는 안 보이게
  return list;
}

export async function restorePayment(id) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (rec) { delete rec.deleted; syncToSupabase(rec); }
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

// 완전 삭제 (복원 불가)
export async function purgePayment(id) {
  const list = await getPayments();
  const next = list.filter(p => p.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  deleteFromSupabase(id);
  return next;
}

export async function getMerchantMap() {
  try {
    const raw = await AsyncStorage.getItem(MERCHANT_CAT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// ---------------- 지출 목표 (주간/월간/사용자 설정 기간 + 금액) ----------------
const GOALS_KEY = 'spend_goals_v1';

export async function getGoals() {
  try {
    const raw = await AsyncStorage.getItem(GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveGoalsList(list) {
  await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(list));
}
// goal: { label?, kind:'weekly'|'monthly'|'custom', amount, startDate?, endDate? } (startDate/endDate는 custom일 때만)
export async function addGoal(goal) {
  const list = await getGoals();
  const next = [{ id: `g_${Date.now()}`, ...goal }, ...list];
  await saveGoalsList(next);
  return next;
}
export async function updateGoal(id, patch) {
  const list = await getGoals();
  const rec = list.find(g => g.id === id);
  if (!rec) return list;
  Object.assign(rec, patch);
  await saveGoalsList(list);
  return list;
}
export async function deleteGoal(id) {
  const next = (await getGoals()).filter(g => g.id !== id);
  await saveGoalsList(next);
  return next;
}

// ---------------- 고정지출(정기결제) ----------------
const RECUR_KEY = 'recurring_v1';

export async function getRecurring() {
  try {
    const raw = await AsyncStorage.getItem(RECUR_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveRecurringList(list) {
  await AsyncStorage.setItem(RECUR_KEY, JSON.stringify(list));
}

// tpl: { merchant, amount, category, memo?, cycle:'monthly'|'daily'|'custom', dayOfMonth?, intervalDays?, startDate:'YYYY-MM-DD' }
// fromPaymentId를 넘기면 그 결제는 이미 기록된 것으로 보고 다음 주기부터 자동 생성함 (중복 생성 방지)
export async function addRecurring(tpl, fromPaymentId) {
  const list = await getRecurring();
  const rec = {
    id: `rc_${Date.now()}`, active: true,
    lastGenerated: fromPaymentId ? tpl.startDate : null,
    ...tpl,
  };
  const next = [rec, ...list];
  await saveRecurringList(next);
  if (fromPaymentId) await linkPaymentToRecurring(fromPaymentId, rec.id);
  return next;
}

export async function updateRecurring(id, patch) {
  const list = await getRecurring();
  const rec = list.find(r => r.id === id);
  if (!rec) return list;
  Object.assign(rec, patch);
  await saveRecurringList(list);
  return list;
}

export async function deleteRecurring(id) {
  const next = (await getRecurring()).filter(r => r.id !== id);
  await saveRecurringList(next);
  return next;
}

async function linkPaymentToRecurring(paymentId, recurringId) {
  const list = await getPayments();
  const rec = list.find(p => p.id === paymentId);
  if (!rec) return;
  rec.recurringId = recurringId;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

// 등록된 고정지출 중 도래한 주기를 자동으로 지출 내역에 추가 (앱 시작 시 호출)
export async function runRecurringGenerator() {
  const list = await getRecurring();
  if (!list.length) return false;
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let changed = false;
  for (const tpl of list) {
    if (!tpl.active) continue;
    const since = sinceAnchor(tpl);
    const occ = occurrencesSince(tpl, since, todayMid);
    if (!occ.length) continue;
    for (const d of occ) {
      const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0).toISOString();
      await savePayment({
        id: `r_${tpl.id}_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`,
        ts, merchant: tpl.merchant, amount: tpl.amount, category: tpl.category,
        memo: tpl.memo || undefined, app: 'recurring', recurringId: tpl.id,
        ...(tpl.type === 'income' ? { type: 'income' } : {}), // 정기 수입(월급 등)
      });
    }
    tpl.lastGenerated = `${occ[occ.length-1].getFullYear()}-${String(occ[occ.length-1].getMonth()+1).padStart(2,'0')}-${String(occ[occ.length-1].getDate()).padStart(2,'0')}`;
    changed = true;
  }
  if (changed) await saveRecurringList(list);
  return changed;
}

// ---------------- 알림 진단 / 감시 앱 직접 추가 ----------------
// 카드사·은행 앱 패키지명은 앱마다 제각각이라 미리 다 알 수 없다.
// 그래서 들어온 알림을 전부 기록해두고, 사용자가 목록에서 직접 감시 대상을 켤 수 있게 한다.
const SEEN_APPS_KEY = 'seen_apps_v1';
const WATCH_APPS_KEY = 'watch_apps_v1';

export async function getSeenApps() {
  try {
    const raw = await AsyncStorage.getItem(SEEN_APPS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// 알림이 올 때마다 호출: 어떤 앱이 무슨 내용을 보냈는지, 결제로 인식됐는지 기록
export async function noteSeenApp(app, sampleText, captured) {
  if (!app) return;
  try {
    const map = await getSeenApps();
    const prev = map[app] || { count: 0 };
    map[app] = {
      count: prev.count + 1,
      lastTs: new Date().toISOString(),
      lastText: String(sampleText || '').slice(0, 80),
      captured: captured || prev.captured || false,
    };
    // 너무 많이 쌓이지 않게 최근 40개 앱만 유지
    const entries = Object.entries(map).sort((a, b) => new Date(b[1].lastTs) - new Date(a[1].lastTs)).slice(0, 40);
    await AsyncStorage.setItem(SEEN_APPS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* 진단 기록 실패는 무시 */ }
}

export async function getWatchApps() {
  try {
    const raw = await AsyncStorage.getItem(WATCH_APPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function toggleWatchApp(app) {
  const list = await getWatchApps();
  const next = list.includes(app) ? list.filter(a => a !== app) : [...list, app];
  await AsyncStorage.setItem(WATCH_APPS_KEY, JSON.stringify(next));
  return next;
}

// ---------------- 통장 잔액 (결제 문자에 찍혀 오는 "잔액 000원"을 기록) ----------------
const BALANCE_KEY = 'balance_v1';

export async function getBalance() {
  try {
    const raw = await AsyncStorage.getItem(BALANCE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function recordBalance(amount, ts, source) {
  if (amount == null) return;
  const cur = await getBalance();
  // 더 최신 문자일 때만 갱신 (과거 문자가 늦게 처리돼도 잔액이 되돌아가지 않게)
  if (cur && new Date(cur.ts) > new Date(ts)) return;
  await AsyncStorage.setItem(BALANCE_KEY, JSON.stringify({ amount, ts, source: source || null }));
}

// ---------------- 카드(결제수단)별 실적 목표 ----------------
const CARD_TARGET_KEY = 'card_targets_v1';

export async function getCardTargets() {
  try {
    const raw = await AsyncStorage.getItem(CARD_TARGET_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
export async function saveCardTargets(map) {
  await AsyncStorage.setItem(CARD_TARGET_KEY, JSON.stringify(map));
}

// ---------------- 받을 돈 (엔빵 정산) ----------------
// 엔빵한 결제에 owedAmount/owedFrom을 달아두고, 받으면 owedSettled 처리
export async function setOwed(id, { owedAmount, owedFrom }) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (!rec) return list;
  if (owedAmount > 0) {
    rec.owedAmount = owedAmount;
    rec.owedFrom = owedFrom || null;
    rec.owedSettled = false;
  } else {
    delete rec.owedAmount; delete rec.owedFrom; delete rec.owedSettled;
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export async function toggleOwedSettled(id) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (!rec || rec.owedAmount == null) return list;
  rec.owedSettled = !rec.owedSettled;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

// ---------------- 태그 (카테고리와 별개로 자유롭게 묶기: #제주도여행 #회사경비) ----------------
const TAGS_KEY = 'known_tags_v1';

export async function getKnownTags() {
  try {
    const raw = await AsyncStorage.getItem(TAGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function rememberTags(tags) {
  if (!tags || !tags.length) return;
  const known = await getKnownTags();
  let changed = false;
  for (const t of tags) if (!known.includes(t)) { known.unshift(t); changed = true; }
  if (changed) await AsyncStorage.setItem(TAGS_KEY, JSON.stringify(known.slice(0, 50)));
}

// "#제주도 #회사경비" 또는 "제주도, 회사경비" → ['제주도','회사경비']
export function parseTags(input) {
  return String(input || '')
    .split(/[\s,]+/)
    .map(t => t.replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

// 이미 쌓여 있는 중복 결제 찾기 (같은 금액 + 3분 이내 + 가맹점 유사하거나 출처가 다름)
export async function findDuplicates() {
  const list = await getPayments();
  const live = list.filter(p => !p.deleted && p.type !== 'income' && p.type !== 'saving')
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const pairs = [];
  const taken = new Set();
  for (let i = 0; i < live.length; i++) {
    if (taken.has(live[i].id)) continue;
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const gap = new Date(b.ts) - new Date(a.ts);
      if (gap > DUP_WINDOW_MS) break; // 시간순 정렬이라 더 볼 필요 없음
      if (taken.has(b.id) || a.amount !== b.amount) continue;
      if (merchantMatches(a.merchant, b.merchant) || isDifferentSource(a.app, b.app)) {
        // 정보가 더 적은 쪽을 지울 후보로 (가맹점명이 짧거나 '알수없음')
        const worse = (b.merchant === '알수없음' || b.merchant.length < a.merchant.length) ? b : a;
        const keep = worse === b ? a : b;
        pairs.push({ keep, remove: worse });
        taken.add(a.id); taken.add(b.id);
        break;
      }
    }
  }
  return pairs;
}

// 찾은 중복을 삭제 처리 (휴지통으로 이동 — 복원 가능)
export async function removeDuplicates(pairs) {
  const list = await getPayments();
  let n = 0;
  for (const { remove } of pairs) {
    const rec = list.find(p => p.id === remove.id);
    if (rec && !rec.deleted) { rec.deleted = true; n++; deleteFromSupabase(rec.id); }
  }
  if (n) await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return { list, count: n };
}

// 같은 가맹점의 과거 기록을 한 번에 같은 카테고리로 변경
export async function recategorizeMerchant(merchant, category) {
  const list = await getPayments();
  let count = 0;
  for (const p of list) {
    if (p.deleted || p.type === 'income' || p.type === 'saving') continue;
    if (p.merchant === merchant && p.category !== category) {
      p.category = category; count++;
      syncToSupabase(p);
    }
  }
  if (count) await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return { list, count };
}

// 같은 가맹점의 과거 기록 중 카테고리가 다른 것 개수 (물어보기 전에 확인용)
export async function countOtherCategory(merchant, category) {
  const list = await getPayments();
  return list.filter(p => !p.deleted && p.type !== 'income' && p.type !== 'saving'
    && p.merchant === merchant && p.category !== category).length;
}

export async function setPaymentTags(id, tags) {
  const list = await getPayments();
  const rec = list.find(p => p.id === id);
  if (!rec) return list;
  rec.tags = tags && tags.length ? tags : undefined;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  await rememberTags(tags);
  syncToSupabase(rec);
  return list;
}

// ---------------- 고액 지출 소명 (하루 10만원 이상) ----------------
const EXPLAIN_KEY = 'spend_explanations_v1';
export async function getExplanations() {
  try {
    const raw = await AsyncStorage.getItem(EXPLAIN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
export async function saveExplanation(dateKey, text) {
  const map = await getExplanations();
  map[dateKey] = text;
  await AsyncStorage.setItem(EXPLAIN_KEY, JSON.stringify(map));
  return map;
}

// ---------------- 백업 / 복구 ----------------
// 결제 내역은 payments 테이블에 이미 동기화되지만, 일기·예산·고정지출·목표 등은
// 폰에만 있어서 앱을 지우거나 폰을 바꾸면 사라짐. 이 값들을 서버(user_data)에 통째로 저장/복원.
const BACKUP_KEYS = [
  DIARY_KEY, BUDGET_KEY, QUIT_SET_KEY, QUIT_DATES_KEY,
  MERCHANT_CAT_KEY, EXPLAIN_KEY, GOALS_KEY, RECUR_KEY, TAGS_KEY,
  CARD_TARGET_KEY, BALANCE_KEY, WATCH_APPS_KEY,
];

// 폰에 실제 데이터가 있는지 (재설치 직후 빈 상태를 구분하기 위함)
export async function hasLocalData() {
  try {
    const vals = await AsyncStorage.multiGet([DIARY_KEY, GOALS_KEY, RECUR_KEY, BUDGET_KEY, KEY]);
    return vals.some(([k, v]) => {
      if (!v) return false;
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed.length > 0;
        if (k === BUDGET_KEY) return !!(parsed && (parsed.total || Object.keys(parsed.cats || {}).length));
        return !!parsed;
      } catch { return false; }
    });
  } catch { return false; }
}

// force=true면 사용자가 직접 누른 백업이므로 빈 데이터라도 올림
export async function backupNow(force = false) {
  if (!hasSupabase) return { ok: false, reason: 'no-supabase' };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: 'no-user' };

    const entries = await AsyncStorage.multiGet(BACKUP_KEYS);
    const data = {};
    entries.forEach(([k, v]) => { if (v != null) data[k] = v; });

    // 안전장치: 폰이 비어 있는데 서버에 백업이 있으면 덮어쓰지 않는다.
    // (앱 재설치 직후 자동 백업이 좋은 백업을 빈 값으로 날려버리는 사고 방지)
    if (!force) {
      const local = await hasLocalData();
      if (!local) {
        const { data: existing } = await supabase.from('user_data').select('data').maybeSingle();
        const serverKeys = existing && existing.data ? Object.keys(existing.data).length : 0;
        if (serverKeys > Object.keys(data).length) {
          return { ok: false, reason: 'skipped-empty' };
        }
      }
    }

    const { error } = await supabase.from('user_data')
      .upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
    if (error) return { ok: false, reason: error.message };
    await AsyncStorage.setItem('last_backup_at', new Date().toISOString());
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

export async function getLastBackupAt() {
  try { return await AsyncStorage.getItem('last_backup_at'); } catch { return null; }
}

export async function fetchBackupInfo() {
  if (!hasSupabase) return null;
  try {
    const { data, error } = await supabase.from('user_data')
      .select('updated_at, data, prev_updated_at, prev_data').maybeSingle();
    if (error || !data) return null;
    const keys = data.data ? Object.keys(data.data).length : 0;
    const prevKeys = data.prev_data ? Object.keys(data.prev_data).length : 0;
    return { updatedAt: data.updated_at, keys, prevUpdatedAt: data.prev_updated_at, prevKeys };
  } catch { return null; }
}

export async function restoreFromBackup() {
  if (!hasSupabase) return { ok: false, reason: 'no-supabase' };
  try {
    const { data, error } = await supabase.from('user_data')
      .select('data, prev_data').maybeSingle();
    if (error || !data) return { ok: false, reason: 'no-backup' };

    // 최신 백업이 이전 세대보다 빈약하면(덮어쓰기 사고) 알맹이가 있는 쪽을 복구
    const cur = data.data || {};
    const prev = data.prev_data || {};
    const chosen = Object.keys(prev).length > Object.keys(cur).length ? prev : cur;

    const pairs = Object.entries(chosen).filter(([, v]) => typeof v === 'string');
    if (!pairs.length) return { ok: false, reason: 'empty' };
    await AsyncStorage.multiSet(pairs);
    return { ok: true, count: pairs.length };
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

// 로그인 직후: 폰에 데이터가 없고 서버에 백업이 있으면 자동 복원 (새 폰/재설치 시나리오)
export async function autoRestoreIfEmpty() {
  try {
    const diary = await AsyncStorage.getItem(DIARY_KEY);
    const goals = await AsyncStorage.getItem(GOALS_KEY);
    const recur = await AsyncStorage.getItem(RECUR_KEY);
    const isEmpty = !diary && !goals && !recur;
    if (!isEmpty) return false;
    const res = await restoreFromBackup();
    return !!res.ok;
  } catch { return false; }
}

// ---------------- 응원 메시지 (웹페이지에서 작성 → 로그인한 나만 볼 수 있음) ----------------
export async function fetchCheers() {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await supabase.from('cheers').select('*').order('ts', { ascending: false }).limit(100);
    if (error) return [];
    return data || [];
  } catch { return []; }
}
export async function deleteCheer(id) {
  if (!hasSupabase) return;
  try { await supabase.from('cheers').delete().eq('id', id); } catch (e) { /* 무시 */ }
}

// ---------------- Supabase 동기화 (로그인한 사용자 소유로 저장) ----------------
export async function syncToSupabase(record) {
  if (!hasSupabase) return;
  if (record.type === 'income' || record.type === 'saving') return; // 수입/저축은 폰에만 기록 (웹 페이지는 지출 전용)
  if (record.deleted) return;           // 삭제된 항목은 웹에 안 보이게
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // 로그인 전에는 동기화하지 않음 (로컬에는 그대로 남아있음)
    await supabase.from('payments').upsert({
      id: record.id,
      ts: record.ts,
      merchant: record.merchant,
      amount: record.amount,
      category: record.category || 'etc',
      memo: record.memo || null,
      original_amount: record.originalAmount ?? null,
      split_count: record.splitCount ?? null,
      tags: record.tags && record.tags.length ? record.tags.join(',') : null,
      user_id: user.id,
    });
  } catch (e) { /* 오프라인이면 무시. 다음 앱 실행 시 syncAll로 재전송 */ }
}

async function deleteFromSupabase(id) {
  if (!hasSupabase) return;
  try { await supabase.from('payments').delete().eq('id', id); } catch (e) { /* 무시 */ }
}

export async function syncAll() {
  const list = await getPayments();
  // 삭제된 항목은 다시 올리지 않음 (재업로드되면 웹에서 되살아나는 버그 방지)
  for (const r of list.filter(p => !p.deleted).slice(0, 100)) await syncToSupabase(r);
  // 예전 버그로 서버에 남아있을 수 있는 삭제 항목 정리
  for (const r of list.filter(p => p.deleted).slice(0, 100)) await deleteFromSupabase(r.id);
}

// 서버에 있는 결제 내역을 폰으로 내려받아 합침 (앱 재설치/새 폰 복구용).
// 폰에 없는 id만 추가하므로 로컬 수정(카테고리/메모 등)은 그대로 유지된다.
export async function pullFromSupabase() {
  if (!hasSupabase) return 0;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;
    const { data, error } = await supabase
      .from('payments').select('*').order('ts', { ascending: false }).limit(5000);
    if (error || !data) return 0;

    const list = await getPayments();
    const have = new Set(list.map(p => p.id));
    const added = [];
    for (const r of data) {
      if (have.has(r.id)) continue;
      added.push({
        id: r.id, ts: r.ts, merchant: r.merchant, amount: r.amount,
        category: r.category || 'etc',
        ...(r.memo ? { memo: r.memo } : {}),
        ...(r.original_amount != null ? { originalAmount: r.original_amount } : {}),
        ...(r.split_count != null ? { splitCount: r.split_count } : {}),
        ...(r.tags ? { tags: String(r.tags).split(',').filter(Boolean) } : {}),
        app: 'restored',
      });
    }
    if (!added.length) return 0;
    const merged = [...added, ...list].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 5000);
    await AsyncStorage.setItem(KEY, JSON.stringify(merged));
    return added.length;
  } catch { return 0; }
}
