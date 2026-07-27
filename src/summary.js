// 위젯/앱이 함께 쓰는 요약 계산 — AsyncStorage에서 직접 읽어 계산한다.
// (위젯은 앱과 별도 프로세스에서 잠깐 실행되므로 App.js의 상태를 쓸 수 없음)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATEGORIES } from './config';

const KEY = 'payments_v1';
const BUDGET_KEY = 'budgets_v1';
const QUIT_DATES_KEY = 'quit_dates_v1';

const isSpend = p => !p.deleted && !p.refunded && !p.isRefund
  && p.type !== 'income' && p.type !== 'saving';

function daysSince(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - new Date(y, m - 1, d)) / 86400000) + 1;
}

export async function buildSummary() {
  let payments = [], budgets = { total: 0 }, quit = null;
  try {
    const [rawP, rawB, rawQ] = await AsyncStorage.multiGet([KEY, BUDGET_KEY, QUIT_DATES_KEY]);
    payments = rawP[1] ? JSON.parse(rawP[1]) : [];
    budgets = rawB[1] ? JSON.parse(rawB[1]) : { total: 0 };
    quit = rawQ[1] ? JSON.parse(rawQ[1]) : null;
  } catch { /* 읽기 실패해도 빈 값으로 그림 */ }

  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();

  let todaySum = 0, monthSum = 0, topCatKey = null;
  const cats = {};
  for (const p of payments) {
    if (!isSpend(p)) continue;
    const t = new Date(p.ts);
    if (t.getFullYear() !== y || t.getMonth() !== m) continue;
    monthSum += p.amount;
    const k = p.category || 'etc';
    cats[k] = (cats[k] || 0) + p.amount;
    if (t.getDate() === d) todaySum += p.amount;
  }
  let best = 0;
  for (const [k, v] of Object.entries(cats)) if (v > best) { best = v; topCatKey = k; }
  const topCat = CATEGORIES.find(c => c.key === topCatKey) || null;

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysLeft = daysInMonth - d + 1;
  const budgetTotal = budgets.total || 0;
  const budgetLeft = budgetTotal ? budgetTotal - monthSum : null;
  const perDay = budgetTotal ? Math.floor(Math.max(0, budgetLeft) / Math.max(1, daysLeft)) : null;

  return {
    todaySum, monthSum,
    budgetTotal,
    budgetLeft,
    budgetPct: budgetTotal ? Math.round(monthSum / budgetTotal * 100) : null,
    todayLeft: perDay != null ? perDay - todaySum : null,
    topCatLabel: topCat ? topCat.label : null,
    topCatColor: topCat ? topCat.color : null,
    topCatAmount: best,
    soberDays: quit ? daysSince(quit.sober) : null,
    smokeDays: quit ? daysSince(quit.smoke) : null,
    month: m + 1,
  };
}

export const wonShort = n => Number(n || 0).toLocaleString('ko-KR');
