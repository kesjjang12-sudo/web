import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { guessCategory } from './parser';

const KEY = 'payments_v1';
const MERCHANT_CAT_KEY = 'merchant_categories_v1';

export async function getPayments() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    // 예전 버전(클린/실패) 기록 마이그레이션: category 없으면 추측해서 채움
    let migrated = false;
    const memory = await getMerchantMap();
    for (const p of list) {
      if (!p.category) { p.category = guessCategory(p.merchant, memory); migrated = true; }
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

// ---------------- Supabase 동기화 ----------------
export async function syncToSupabase(record) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
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
  for (const r of list.slice(0, 100)) await syncToSupabase(r);
}
