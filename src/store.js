import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { guessCategory, parsePayment } from './parser';

const KEY = 'payments_v1';
const MERCHANT_CAT_KEY = 'merchant_categories_v1';
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
export async function addDiary(text) {
  const list = await getDiary();
  const next = [{ id: `d_${Date.now()}`, ts: new Date().toISOString(), text }, ...list].slice(0, 1000);
  await AsyncStorage.setItem(DIARY_KEY, JSON.stringify(next));
  return next;
}
export async function deleteDiary(id) {
  const next = (await getDiary()).filter(d => d.id !== id);
  await AsyncStorage.setItem(DIARY_KEY, JSON.stringify(next));
  return next;
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
  // 같은 알림 중복 방지 (10초 내 동일 금액+가맹점)
  const dup = list.find(p => p.merchant === record.merchant && p.amount === record.amount
    && Math.abs(new Date(p.ts) - new Date(record.ts)) < 10000);
  if (dup) return list;
  if (!record.category) {
    const memory = await getMerchantMap();
    record.category = guessCategory(record.merchant, memory);
  }
  const next = [record, ...list].slice(0, 5000);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  syncToSupabase(record); // 실패해도 앱 동작에는 지장 없음
  return next;
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

// ---------------- 응원 메시지 (웹페이지에서 작성 → 앱에서만 보임) ----------------
export async function fetchCheers() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cheers?order=ts.desc&limit=100&select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) return []; // 테이블이 아직 없으면 조용히 무시
    return await res.json();
  } catch { return []; }
}
export async function deleteCheer(id) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/cheers?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
  } catch (e) { /* 무시 */ }
}

// ---------------- Supabase 동기화 ----------------
export async function syncToSupabase(record) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  if (record.type === 'income') return; // 수입은 폰에만 기록 (웹 페이지는 지출 전용)
  if (record.deleted) return;           // 삭제된 항목은 웹에 안 보이게
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: record.id,
        ts: record.ts,
        merchant: record.merchant,
        amount: record.amount,
        category: record.category || 'etc',
        memo: record.memo || null,
      }),
    });
  } catch (e) { /* 오프라인이면 무시. 다음 앱 실행 시 syncAll로 재전송 */ }
}

async function deleteFromSupabase(id) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/payments?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
  } catch (e) { /* 무시 */ }
}

export async function syncAll() {
  const list = await getPayments();
  // 삭제된 항목은 다시 올리지 않음 (재업로드되면 웹에서 되살아나는 버그 방지)
  for (const r of list.filter(p => !p.deleted).slice(0, 100)) await syncToSupabase(r);
  // 예전 버그로 서버에 남아있을 수 있는 삭제 항목 정리
  for (const r of list.filter(p => p.deleted).slice(0, 100)) await deleteFromSupabase(r.id);
}
