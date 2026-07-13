import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

const KEY = 'payments_v1';
const START_KEY = 'quit_start_v1';

export async function getPayments() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function savePayment(record) {
  const list = await getPayments();
  // 같은 알림 중복 방지 (10초 내 동일 금액+가맹점)
  const dup = list.find(p => p.merchant === record.merchant && p.amount === record.amount
    && Math.abs(new Date(p.ts) - new Date(record.ts)) < 10000);
  if (dup) return list;
  const next = [record, ...list].slice(0, 2000);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  syncToSupabase(record); // 실패해도 앱 동작에는 지장 없음
  return next;
}

export async function updateMemo(id, memo) {
  const list = await getPayments();
  const next = list.map(p => p.id === id ? { ...p, memo } : p);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  const rec = next.find(p => p.id === id);
  if (rec) syncToSupabase(rec);
  return next;
}

export async function getQuitStart() {
  let v = await AsyncStorage.getItem(START_KEY);
  if (!v) {
    v = new Date().toISOString();
    await AsyncStorage.setItem(START_KEY, v);
  }
  return v;
}

// 연속 클린 일수: 마지막 '실패' 이후 (실패 없으면 시작일 이후)
export async function getStreak() {
  const list = await getPayments();
  const start = await getQuitStart();
  const lastFail = list.find(p => p.status === '실패');
  const from = lastFail ? new Date(lastFail.ts) : new Date(start);
  return Math.floor((Date.now() - from.getTime()) / 86400000);
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
        status: record.status,
        memo: record.memo || null,
        matched_keyword: record.matchedKeyword || null,
      }),
    });
  } catch (e) { /* 오프라인이면 무시. 다음 앱 실행 시 syncAll로 재전송 */ }
}

export async function syncAll() {
  const list = await getPayments();
  for (const r of list.slice(0, 100)) await syncToSupabase(r);
}
