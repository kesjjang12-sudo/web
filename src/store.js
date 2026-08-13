import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

const KEY = 'payments_v1';
const BACKUP_KEY = 'payments_v1_backup';
const START_KEY = 'quit_start_v1';

// 같은 앱 안에서 저장이 동시에 겹치면 기록이 서로를 덮어쓸 수 있어서
// 저장 작업을 한 줄로 세워서 순서대로 처리
let writeQueue = Promise.resolve();
function enqueue(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

// 저장소 읽기. 본 데이터가 깨졌으면 백업으로 복구.
// "읽기 실패"와 "기록 없음"을 구분하는 게 핵심 —
// 실패를 빈 목록으로 착각하면 다음 저장 때 전체 기록이 지워짐.
async function readList() {
  let raw = null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw != null) {
    try { return JSON.parse(raw); } catch { /* 깨짐 → 백업 시도 */ }
  }
  try {
    const bak = await AsyncStorage.getItem(BACKUP_KEY);
    if (bak != null) return JSON.parse(bak);
  } catch { /* 백업도 실패 */ }
  if (raw == null) return []; // 진짜 기록이 없는 첫 실행
  throw new Error('storage_corrupt'); // 데이터는 있는데 읽을 수 없음 → 덮어쓰기 금지
}

// 본 데이터와 백업에 같이 저장 (한쪽이 깨져도 복구 가능)
async function writeList(next) {
  const json = JSON.stringify(next);
  await AsyncStorage.setItem(KEY, json);
  try { await AsyncStorage.setItem(BACKUP_KEY, json); } catch { /* 백업 실패는 무시 */ }
}

export async function getPayments() {
  try { return await readList(); } catch { return []; }
}

export async function savePayment(record) {
  return enqueue(async () => {
    let list;
    try {
      list = await readList();
    } catch {
      // 저장소가 깨진 상태에서 덮어쓰면 전체 기록이 날아가므로 이번 건은 저장 보류
      return [];
    }
    // 같은 알림 중복 방지 (10초 내 동일 금액+가맹점)
    const dup = list.find(p => p.merchant === record.merchant && p.amount === record.amount
      && Math.abs(new Date(p.ts) - new Date(record.ts)) < 10000);
    if (dup) return list;
    const next = [record, ...list].slice(0, 2000);
    await writeList(next);
    syncToSupabase(record); // 실패해도 앱 동작에는 지장 없음
    return next;
  });
}

export async function updateMemo(id, memo) {
  return enqueue(async () => {
    let list;
    try {
      list = await readList();
    } catch {
      return [];
    }
    const next = list.map(p => p.id === id ? { ...p, memo } : p);
    await writeList(next);
    const rec = next.find(p => p.id === id);
    if (rec) syncToSupabase(rec);
    return next;
  });
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
