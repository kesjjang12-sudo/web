import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  SafeAreaView, View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Modal, TextInput, AppState, RefreshControl, Share,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import {
  getPayments, savePayment, updateItem, deletePayment, restorePayment, purgePayment,
  syncAll, getBudgets, saveBudgets,
  getDiary, addDiary, deleteDiary, getQuitSettings, saveQuitSettings,
} from './src/store';
import { parsePayment } from './src/parser';
import { QUIT_GOALS, CATEGORIES, SHOP_ITEMS, SUPABASE_URL } from './src/config';

// 토스 스타일 다크 팔레트
const C = {
  bg:'#101013', card:'#17171C', card2:'#26262C', press:'#2E2E36',
  text:'#E5E8EB', sub:'#8B95A1', faint:'#6B7684',
  blue:'#3182F6', blueText:'#4E9BFA', green:'#16C47F', red:'#F04452', gold:'#E5B84B',
};
const REV = 'r11'; // OTA 배포마다 +1 (화면 우상단에 표시 — 업데이트 적용 확인용)
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
const won = n => n.toLocaleString('ko-KR');
const DAY_NAMES = ['일','월','화','수','목','금','토'];

// 32,400 → "3.2만" / 6,800 → "6.8천" (달력 칸용 축약)
function fmtShort(n) {
  if (n >= 10000) { const v = n / 10000; return (v >= 10 ? Math.round(v) : +v.toFixed(1)) + '만'; }
  if (n >= 1000) return +(n / 1000).toFixed(1) + '천';
  return String(n);
}

function dayLabel(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - that) / 86400000);
  const base = `${d.getMonth()+1}월 ${d.getDate()}일`;
  if (diff === 0) return `${base} · 오늘`;
  if (diff === 1) return `${base} · 어제`;
  return `${base} · ${DAY_NAMES[d.getDay()]}요일`;
}
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
// 시작 당일을 1일째로 계산 (로컬 자정 기준 — UTC 파싱으로 하루 밀리는 것 방지)
function daysSince(start) {
  const [y, m, d] = start.split('-').map(Number);
  const s = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - s) / 86400000) + 1;
}
const srcName = app => !app || app === 'manual' ? '직접 입력' : app === 'test' ? '테스트'
  : /messaging/.test(app) ? '문자'
  : /kakaobank|kbstar|sbanking/.test(app) ? '은행' : '카드 알림';

const isIncome = p => p.type === 'income';

export default function App() {
  const [perm, setPerm] = useState('unknown');
  const [payments, setPayments] = useState([]);
  const [budgets, setBudgets] = useState({ total: 0, cats: {} });
  const [refreshing, setRefreshing] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0); // 0=이번달, -1=지난달 ...
  const [view, setView] = useState('list');          // 'list' | 'cal' | 'stat'
  const [selDay, setSelDay] = useState(null);        // 달력에서 선택한 일자
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState(null);  // null=전체
  const [pickTarget, setPickTarget] = useState(null); // 수정할 기록
  const [editCat, setEditCat] = useState('etc');
  const [editMemo, setEditMemo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState('expense'); // 'expense' | 'income'
  const [addName, setAddName] = useState('');
  const [addAmt, setAddAmt] = useState('');
  const [addCat, setAddCat] = useState('food');
  const [showDeleted, setShowDeleted] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState({ total: '', cats: {} });
  const [screen, setScreen] = useState('home');      // 'home' | 'save' | 'diary' (하단 탭)
  const [diary, setDiary] = useState([]);
  const [diaryText, setDiaryText] = useState('');
  const [quitSet, setQuitSet] = useState({ soberPerDay: 15000, cigsPerDay: 10, packPrice: 4500 });
  const [quitEdit, setQuitEdit] = useState(false);
  const [quitDraft, setQuitDraft] = useState({ soberPerDay: '', cigsPerDay: '', packPrice: '' });

  const load = useCallback(async () => {
    const [p, b, d, q, st] = await Promise.all([
      getPayments(), getBudgets(), getDiary(), getQuitSettings(),
      RNAndroidNotificationListener.getPermissionStatus(),
    ]);
    setPayments(p); setBudgets(b); setDiary(d); setQuitSet(q); setPerm(st);
  }, []);

  useEffect(() => {
    load();
    syncAll();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') load(); });
    const t = setInterval(load, 20000);
    return () => { sub.remove(); clearInterval(t); };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  // ── 보고 있는 달 데이터 ──
  const now = new Date();
  const viewYM = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const isThisMonth = monthOffset === 0;
  const todayDate = now.getDate();
  const daysInViewMonth = new Date(viewYM.getFullYear(), viewYM.getMonth()+1, 0).getDate();
  const inMonth = (p, ym) => {
    const d = new Date(p.ts);
    return d.getFullYear() === ym.getFullYear() && d.getMonth() === ym.getMonth();
  };
  // 지출 (삭제/수입 제외)
  const monthPays = useMemo(() => payments.filter(p => !p.deleted && !isIncome(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthIncome = useMemo(() => payments.filter(p => !p.deleted && isIncome(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthDeleted = useMemo(() => payments.filter(p => p.deleted && inMonth(p, viewYM)), [payments, monthOffset]);
  const total = monthPays.reduce((s, p) => s + p.amount, 0);
  const incomeTotal = monthIncome.reduce((s, p) => s + p.amount, 0);

  // 지난달 대비: 이번 달=같은 기간(1일~오늘), 과거 달=전체
  const prevPays = useMemo(() => {
    const prevYM = new Date(viewYM.getFullYear(), viewYM.getMonth() - 1, 1);
    const sameWindow = monthOffset === 0;
    return payments.filter(p => {
      if (p.deleted || isIncome(p) || !inMonth(p, prevYM)) return false;
      return sameWindow ? new Date(p.ts).getDate() <= now.getDate() : true;
    });
  }, [payments, monthOffset]);
  const prevTotal = prevPays.reduce((s, p) => s + p.amount, 0);
  const delta = prevTotal > 0 ? total - prevTotal : null;

  // 예상 지출 (토스식): 지금 속도대로면 이번 달 얼마
  const projected = isThisMonth && todayDate >= 2 && total > 0
    ? Math.round(total / todayDate * daysInViewMonth) : null;

  // 카테고리별 합계 + 지난달 대비
  const catRows = useMemo(() => {
    const sums = {}, prevSums = {};
    monthPays.forEach(p => { const k = CAT[p.category] ? p.category : 'etc'; sums[k] = (sums[k]||0) + p.amount; });
    prevPays.forEach(p => { const k = CAT[p.category] ? p.category : 'etc'; prevSums[k] = (prevSums[k]||0) + p.amount; });
    return Object.entries(sums).sort((a,b) => b[1]-a[1])
      .map(([k, v]) => [k, v, prevSums[k] != null ? v - prevSums[k] : null]);
  }, [monthPays, prevPays]);
  const maxCat = catRows.length ? catRows[0][1] : 1;

  // 검색/필터 적용된 내역 (내역 탭)
  const listPays = useMemo(() => {
    const all = [...monthPays, ...monthIncome].sort((a,b) => new Date(b.ts) - new Date(a.ts));
    return all.filter(p => {
      if (filterCat && (isIncome(p) || (CAT[p.category] ? p.category : 'etc') !== filterCat)) return false;
      if (search.trim() && !(p.merchant + (p.memo||'')).toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [monthPays, monthIncome, search, filterCat]);

  const groups = useMemo(() => {
    const g = [];
    listPays.forEach(p => {
      const label = dayLabel(new Date(p.ts));
      let grp = g.find(x => x.label === label);
      if (!grp) { grp = { label, items: [] }; g.push(grp); }
      grp.items.push(p);
    });
    return g;
  }, [listPays]);

  // 달력 데이터 + 무지출 데이
  const cal = useMemo(() => {
    const y = viewYM.getFullYear(), m = viewYM.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const totals = {};
    monthPays.forEach(p => { const d = new Date(p.ts).getDate(); totals[d] = (totals[d]||0) + p.amount; });
    const lastDay = isThisMonth ? todayDate : daysInViewMonth;
    let noSpend = 0;
    for (let d = 1; d <= lastDay; d++) if (!totals[d]) noSpend++;
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInViewMonth; d++) cells.push({ d, amt: totals[d] || 0 });
    while (cells.length % 7 !== 0) cells.push(null);
    return { cells, noSpend };
  }, [monthPays, monthOffset]);

  const selDayPays = selDay == null ? [] : monthPays
    .filter(p => new Date(p.ts).getDate() === selDay)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const selDayTotal = selDayPays.reduce((s, p) => s + p.amount, 0);

  // 통계: 최근 6개월 추이
  const trend = useMemo(() => {
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const ym = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const sum = payments.filter(p => !p.deleted && !isIncome(p) && inMonth(p, ym)).reduce((s,p) => s+p.amount, 0);
      out.push({ label: `${ym.getMonth()+1}월`, sum, cur: i === 0 });
    }
    return out;
  }, [payments]);
  const trendMax = Math.max(...trend.map(t => t.sum), 1);

  // 통계: 고정지출 감지 (이번 달 + 지난달 같은 가맹점 & 금액 ±20%)
  const recurring = useMemo(() => {
    const prevYM = new Date(viewYM.getFullYear(), viewYM.getMonth() - 1, 1);
    const cur = {}, prv = {};
    payments.filter(p => !p.deleted && !isIncome(p) && inMonth(p, viewYM)).forEach(p => { cur[p.merchant] = (cur[p.merchant]||0) + p.amount; });
    payments.filter(p => !p.deleted && !isIncome(p) && inMonth(p, prevYM)).forEach(p => { prv[p.merchant] = (prv[p.merchant]||0) + p.amount; });
    return Object.entries(cur)
      .filter(([m, v]) => prv[m] && Math.abs(v - prv[m]) / Math.max(v, prv[m]) <= 0.2)
      .sort((a,b) => b[1]-a[1]);
  }, [payments, monthOffset]);

  // ── 액션 ──
  const openEdit = useCallback((p) => {
    setEditCat(CAT[p.category] ? p.category : 'etc');
    setEditMemo(p.memo || '');
    setPickTarget(p);
  }, []);

  const saveEdit = useCallback(async () => {
    const next = await updateItem(pickTarget.id, {
      category: isIncome(pickTarget) ? undefined : editCat, memo: editMemo.trim(),
    });
    setPayments([...next]); setPickTarget(null);
  }, [pickTarget, editCat, editMemo]);

  const addManual = useCallback(async () => {
    const amount = parseInt(addAmt.replace(/[^\d]/g, ''), 10);
    if (!addName.trim() || !amount) { Alert.alert('입력 확인', '이름과 금액을 입력해주세요.'); return; }
    const next = await savePayment({
      id: `m_${Date.now()}`, ts: new Date().toISOString(),
      merchant: addName.trim(), amount, app: 'manual',
      ...(addType === 'income' ? { type: 'income', category: 'etc' } : { category: addCat }),
    });
    setPayments([...next]); setAdding(false); setAddName(''); setAddAmt('');
  }, [addName, addAmt, addCat, addType]);

  const confirmDelete = useCallback((p) => {
    Alert.alert('삭제할까요?', `${p.merchant} · ${won(p.amount)}원\n아래 "삭제된 항목"에서 복원할 수 있어요.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => setPayments([...await deletePayment(p.id)]) },
    ]);
  }, []);

  const confirmRestore = useCallback((p) => {
    Alert.alert('복원할까요?', `${p.merchant} · ${won(p.amount)}원`, [
      { text: '취소', style: 'cancel' },
      { text: '복원', onPress: async () => setPayments([...await restorePayment(p.id)]) },
    ]);
  }, []);

  const confirmPurge = useCallback((p) => {
    Alert.alert('완전히 삭제할까요?', `${p.merchant} · ${won(p.amount)}원\n복원할 수 없어요.`, [
      { text: '취소', style: 'cancel' },
      { text: '완전 삭제', style: 'destructive', onPress: async () => setPayments([...await purgePayment(p.id)]) },
    ]);
  }, []);

  const openBudget = useCallback(() => {
    setBudgetDraft({
      total: budgets.total ? String(budgets.total) : '',
      cats: Object.fromEntries(CATEGORIES.map(c => [c.key, budgets.cats[c.key] ? String(budgets.cats[c.key]) : ''])),
    });
    setBudgetOpen(true);
  }, [budgets]);

  const saveBudgetDraft = useCallback(async () => {
    const num = v => parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0;
    const next = {
      total: num(budgetDraft.total),
      cats: Object.fromEntries(Object.entries(budgetDraft.cats).map(([k, v]) => [k, num(v)]).filter(([, v]) => v > 0)),
    };
    await saveBudgets(next);
    setBudgets(next); setBudgetOpen(false);
  }, [budgetDraft]);

  const exportCSV = useCallback(async () => {
    const rows = [...monthPays, ...monthIncome].sort((a,b) => new Date(a.ts) - new Date(b.ts));
    if (rows.length === 0) { Alert.alert('내보내기', '이 달에는 기록이 없어요.'); return; }
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = ['날짜,시간,이름,금액,종류,카테고리,메모'];
    rows.forEach(p => {
      const d = new Date(p.ts);
      lines.push([
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        hhmm(p.ts), esc(p.merchant), p.amount,
        isIncome(p) ? '수입' : '지출',
        isIncome(p) ? '' : (CAT[p.category] || CAT.etc).label,
        esc(p.memo || ''),
      ].join(','));
    });
    await Share.share({
      title: `가계부 ${viewYM.getFullYear()}-${viewYM.getMonth()+1}`,
      message: lines.join('\n'),
    });
  }, [monthPays, monthIncome, monthOffset]);

  // ── 금주·금연 아낀 돈 ──
  const soberDays = daysSince(QUIT_GOALS[0].start);
  const smokeDays = daysSince(QUIT_GOALS[1].start);
  const savedSober = Math.max(0, soberDays) * quitSet.soberPerDay;
  const savedSmoke = Math.max(0, smokeDays) * Math.round(quitSet.cigsPerDay / 20 * quitSet.packPrice);
  const savedTotal = savedSober + savedSmoke;

  // 일기 쓴 날이 금주 며칠째였는지
  const diaryDayNo = (iso) => {
    const d = new Date(iso);
    const [y, m, dd] = QUIT_GOALS[0].start.split('-').map(Number);
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((t - new Date(y, m - 1, dd)) / 86400000) + 1;
  };

  // 일기: 월 → 날짜별 그룹 + 요약 통계
  const diaryGroups = useMemo(() => {
    const months = [];
    diary.forEach(d => {
      const dt = new Date(d.ts);
      const mLabel = `${dt.getFullYear()}년 ${dt.getMonth()+1}월`;
      let mo = months.find(x => x.label === mLabel);
      if (!mo) { mo = { label: mLabel, days: [] }; months.push(mo); }
      const dLabel = dayLabel(dt);
      let dy = mo.days.find(x => x.label === dLabel);
      if (!dy) { dy = { label: dLabel, dayNo: diaryDayNo(d.ts), items: [] }; mo.days.push(dy); }
      dy.items.push(d);
    });
    return months;
  }, [diary]);

  const diaryStats = useMemo(() => {
    const daySet = new Set(diary.map(d => new Date(d.ts).toDateString()));
    // 연속 작성일 (오늘 또는 어제부터 거꾸로)
    let streak = 0;
    const cur = new Date();
    if (!daySet.has(cur.toDateString())) cur.setDate(cur.getDate() - 1);
    while (daySet.has(cur.toDateString())) { streak++; cur.setDate(cur.getDate() - 1); }
    const thisMonth = diary.filter(d => {
      const dt = new Date(d.ts);
      return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    }).length;
    return { total: diary.length, days: daySet.size, streak, thisMonth };
  }, [diary]);

  const submitDiary = useCallback(async () => {
    if (!diaryText.trim()) return;
    setDiary(await addDiary(diaryText.trim()));
    setDiaryText('');
  }, [diaryText]);

  const confirmDiaryDelete = useCallback((d) => {
    Alert.alert('일기를 삭제할까요?', '', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => setDiary(await deleteDiary(d.id)) },
    ]);
  }, []);

  const openQuitEdit = useCallback(() => {
    setQuitDraft({
      soberPerDay: String(quitSet.soberPerDay), cigsPerDay: String(quitSet.cigsPerDay), packPrice: String(quitSet.packPrice),
    });
    setQuitEdit(true);
  }, [quitSet]);

  const saveQuitDraft = useCallback(async () => {
    const num = (v, def) => parseInt(String(v).replace(/[^\d]/g, ''), 10) || def;
    const next = {
      soberPerDay: num(quitDraft.soberPerDay, 0),
      cigsPerDay: num(quitDraft.cigsPerDay, 0),
      packPrice: num(quitDraft.packPrice, 4500),
    };
    await saveQuitSettings(next);
    setQuitSet(next); setQuitEdit(false);
  }, [quitDraft]);

  // 테스트: 가짜 결제 알림 흘려보기
  const testNotif = useCallback(async () => {
    const samples = [
      '신한카드승인 김*성 5,500원 일시불 07/13 12:10 스타벅스강남점',
      'KB국민카드 승인 김*성 9,500원 일시불 김밥천국역삼점',
      '신한카드승인 김*성 13,200원 일시불 카카오T',
    ];
    const parsed = parsePayment(samples[Math.floor(Math.random()*samples.length)]);
    const next = await savePayment({ ...parsed, id:`test_${Date.now()}`, ts:new Date().toISOString(), app:'test' });
    setPayments([...next]);
  }, []);

  const monthTitle = `${viewYM.getFullYear()}년 ${viewYM.getMonth()+1}월`;

  // 예산 진행률 색
  const budgetPct = budgets.total > 0 ? Math.round(total / budgets.total * 100) : 0;
  const budgetColor = budgetPct >= 100 ? C.red : budgetPct >= 80 ? C.gold : C.green;

  // 결제 행 렌더러 (내역/일자상세 공용)
  const renderItem = (p, fromDaySheet) => {
    const inc = isIncome(p);
    const cat = inc ? { label: '수입', color: C.green } : (CAT[p.category] || CAT.etc);
    return (
      <TouchableOpacity key={p.id} style={s.item} activeOpacity={0.6}
        onPress={() => { if (fromDaySheet) setSelDay(null); openEdit(p); }}
        onLongPress={() => { if (fromDaySheet) setSelDay(null); confirmDelete(p); }} delayLongPress={450}>
        <View style={[s.dot, { backgroundColor: cat.color + '26' }]}>
          <View style={[s.dotCore, { backgroundColor: cat.color }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.itemName} numberOfLines={1}>{p.merchant}</Text>
          <Text style={s.itemSub}>{hhmm(p.ts)} · {srcName(p.app)} · {cat.label}</Text>
          {!!p.memo && <Text style={s.itemMemo} numberOfLines={2}>{p.memo}</Text>}
        </View>
        <Text style={[s.itemAmt, inc && { color: C.green }]}>{inc ? '+' : ''}{won(p.amount)}원</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      {screen === 'home' && (
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.sub} />}>

        <View style={s.topRow}>
          <Text style={s.appTitle}>클린페이</Text>
          <Text style={s.appSub}>은성의 가계부 · {REV}</Text>
        </View>

        {perm !== 'authorized' && (
          <TouchableOpacity style={s.permBanner} activeOpacity={0.85}
            onPress={() => RNAndroidNotificationListener.requestPermission()}>
            <Text style={s.permTitle}>알림 접근 권한이 필요해요</Text>
            <Text style={s.permSub}>탭하면 설정이 열려요 → 목록에서 "클린페이" 켜기</Text>
          </TouchableOpacity>
        )}

        {/* D-day 카드 (탭 → 아낀 돈 + 일기장) */}
        <View style={s.ddayRow}>
          {QUIT_GOALS.map((g, i) => {
            const days = daysSince(g.start);
            const color = i === 0 ? C.green : C.blueText;
            const [, sm, sd] = g.start.split('-').map(Number);
            return (
              <TouchableOpacity key={g.key} style={s.dday} activeOpacity={0.7} onPress={() => setScreen('save')}>
                <Text style={s.ddayTag}>{g.label}</Text>
                <Text style={[s.ddayNum, { color }]}>{days}일째</Text>
                <Text style={s.ddaySince}>{sm}월 {sd}일부터</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity activeOpacity={0.7} onPress={() => setScreen('save')}>
          <Text style={s.savedTeaser}>💰 지금까지 <Text style={{ color: C.green, fontWeight: '800' }}>{won(savedTotal)}원</Text> 아꼈어요 · 탭해서 보기 ›</Text>
        </TouchableOpacity>

        {/* 월 요약 */}
        <View style={s.month}>
          <View style={s.monthHead}>
            <TouchableOpacity onPress={() => { setMonthOffset(o => o-1); setSelDay(null); }} style={s.navBtn} hitSlop={8}>
              <Text style={s.navT}>‹</Text>
            </TouchableOpacity>
            <Text style={s.monthTitle}>{monthTitle}</Text>
            <TouchableOpacity onPress={() => { setMonthOffset(o => Math.min(0, o+1)); setSelDay(null); }} style={s.navBtn} hitSlop={8}>
              <Text style={[s.navT, isThisMonth && { opacity: 0.25 }]}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>{isThisMonth ? '이번 달 쓴 돈' : '이 달에 쓴 돈'}</Text>
            <TouchableOpacity onPress={openBudget} hitSlop={8}>
              <Text style={s.budgetLink}>예산 설정 ›</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.total}>{won(total)}원</Text>
          {incomeTotal > 0 && <Text style={s.incomeLine}>수입 +{won(incomeTotal)}원</Text>}
          {delta !== null && (
            <View style={s.deltaPill}>
              <Text style={[s.deltaT, { color: delta <= 0 ? C.blueText : C.red }]}>
                지난달{isThisMonth ? ' 같은 기간' : ''}보다 {won(Math.abs(delta))}원 {delta <= 0 ? (isThisMonth ? '아끼는 중' : '아꼈어요') : (isThisMonth ? '더 쓰는 중' : '더 썼어요')}
              </Text>
            </View>
          )}
          {projected !== null && (
            <Text style={[s.projLine, budgets.total > 0 && projected > budgets.total && { color: C.red }]}>
              이대로면 이번 달 약 {won(projected)}원 쓸 것 같아요{budgets.total > 0 && projected > budgets.total ? ' (예산 초과 예상!)' : ''}
            </Text>
          )}

          {/* 예산 진행률 */}
          {budgets.total > 0 && isThisMonth && (
            <View style={{ marginTop: 12 }}>
              <View style={s.budBarBg}>
                <View style={[s.budBarFill, { width: `${Math.min(100, budgetPct)}%`, backgroundColor: budgetColor }]} />
              </View>
              <Text style={s.budText}>
                예산 {won(budgets.total)}원 · {budgetPct}% 사용 ·{' '}
                <Text style={{ color: budgetColor, fontWeight: '700' }}>
                  {total <= budgets.total ? won(budgets.total - total) + '원 남음' : won(total - budgets.total) + '원 초과!'}
                </Text>
              </Text>
            </View>
          )}

          {/* 카테고리 바 */}
          {catRows.length > 0 && (
            <View style={{ marginTop: 18, gap: 12 }}>
              {catRows.map(([k, v, d]) => {
                const cb = budgets.cats[k];
                const cbPct = cb ? Math.round(v / cb * 100) : null;
                const cbColor = cbPct == null ? null : cbPct >= 100 ? C.red : cbPct >= 80 ? C.gold : C.faint;
                return (
                  <View key={k} style={s.catRow}>
                    <Text style={s.catName}>{CAT[k].label}</Text>
                    <View style={s.catBar}>
                      <View style={[s.catFill, { width: `${Math.max(5, v/maxCat*100)}%`, backgroundColor: CAT[k].color }]} />
                    </View>
                    <View style={s.catAmtCol}>
                      <Text style={s.catAmt}>{won(v)}원</Text>
                      {cbPct != null ? (
                        <Text style={[s.catDelta, { color: cbColor }]}>예산의 {cbPct}%</Text>
                      ) : (d !== null && d !== 0 && (
                        <Text style={[s.catDelta, { color: d < 0 ? C.blueText : C.red }]}>
                          {d < 0 ? '▼' : '▲'} {fmtShort(Math.abs(d))}
                        </Text>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* 뷰 전환 탭 */}
        <View style={s.tabs}>
          {[['list','내역'],['cal','달력'],['stat','통계']].map(([k, label]) => (
            <TouchableOpacity key={k} style={[s.tab, view === k && s.tabOn]} onPress={() => setView(k)}>
              <Text style={[s.tabT, view === k && s.tabTOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 내역 뷰 ── */}
        {view === 'list' && (
          <>
            <TextInput style={s.searchInput} placeholder="🔍 가게 이름이나 메모 검색" placeholderTextColor={C.faint}
              value={search} onChangeText={setSearch} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={[s.filterChip, !filterCat && s.filterChipOn]} onPress={() => setFilterCat(null)}>
                <Text style={[s.filterChipT, !filterCat && { color: C.text }]}>전체</Text>
              </TouchableOpacity>
              {CATEGORIES.map(c => (
                <TouchableOpacity key={c.key} style={[s.filterChip, filterCat === c.key && s.filterChipOn]}
                  onPress={() => setFilterCat(filterCat === c.key ? null : c.key)}>
                  <View style={[s.chipDot, { backgroundColor: c.color }]} />
                  <Text style={[s.filterChipT, filterCat === c.key && { color: C.text }]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {groups.map(g => (
              <View key={g.label} style={s.dayCard}>
                <View style={s.dayHead}>
                  <Text style={s.dayHeadT}>{g.label}</Text>
                  <Text style={s.dayHeadT}>{won(g.items.filter(x => !isIncome(x)).reduce((s2,x)=>s2+x.amount,0))}원</Text>
                </View>
                {g.items.map(p => renderItem(p, false))}
              </View>
            ))}
            {listPays.length === 0 && (
              <Text style={s.empty}>{search || filterCat ? '조건에 맞는 기록이 없어요.' : '아직 이 달 기록이 없어요.\n카드 결제 알림이 오면 자동으로 쌓이고,\n현금은 아래 + 버튼으로 직접 추가할 수 있어요.'}</Text>
            )}
          </>
        )}

        {/* ── 달력 뷰 ── */}
        {view === 'cal' && (
          <View style={s.calCard}>
            {isThisMonth && cal.noSpend > 0 && (
              <Text style={s.noSpendLine}>🎉 이번 달 무지출 <Text style={{ color: C.green, fontWeight: '800' }}>{cal.noSpend}일</Text></Text>
            )}
            <View style={s.calHead}>
              {DAY_NAMES.map((d, i) => (
                <Text key={d} style={[s.calDow, i === 0 && { color: '#C96A6A' }, i === 6 && { color: '#6A8FC9' }]}>{d}</Text>
              ))}
            </View>
            {Array.from({ length: cal.cells.length / 7 }, (_, r) => (
              <View key={r} style={s.calRow}>
                {cal.cells.slice(r*7, r*7+7).map((cell, i) => {
                  if (!cell) return <View key={i} style={s.calCell} />;
                  const isToday = isThisMonth && cell.d === todayDate;
                  const isFuture = isThisMonth && cell.d > todayDate;
                  const noSpendDay = !isFuture && !cell.amt;
                  return (
                    <TouchableOpacity key={i} style={[s.calCell, selDay === cell.d && s.calCellOn]}
                      activeOpacity={0.6} disabled={isFuture}
                      onPress={() => setSelDay(cell.d)}>
                      <View style={[s.calDayWrap, isToday && s.calToday]}>
                        <Text style={[s.calDay, isToday && { color: '#fff' }, isFuture && { color: '#3A3A42' }]}>{cell.d}</Text>
                      </View>
                      <Text style={[s.calAmt, noSpendDay && { color: C.green }]} numberOfLines={1}>
                        {cell.amt ? fmtShort(cell.amt) : noSpendDay ? '✓' : ' '}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <Text style={s.calHint}>날짜를 누르면 그날 쓴 내역이 보여요 · ✓ = 무지출</Text>
          </View>
        )}

        {/* ── 통계 뷰 ── */}
        {view === 'stat' && (
          <>
            <View style={s.statCard}>
              <Text style={s.statTitle}>최근 6개월 지출</Text>
              <View style={s.trendRow}>
                {trend.map(t => (
                  <View key={t.label} style={s.trendCol}>
                    <Text style={s.trendAmt}>{t.sum ? fmtShort(t.sum) : ''}</Text>
                    <View style={[s.trendBar, {
                      height: Math.max(4, t.sum / trendMax * 90),
                      backgroundColor: t.cur ? C.blue : C.card2,
                    }]} />
                    <Text style={[s.trendLabel, t.cur && { color: C.text, fontWeight: '700' }]}>{t.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={s.statCard}>
              <Text style={s.statTitle}>매달 나가는 돈 (고정지출·구독)</Text>
              {recurring.length > 0 ? (
                <>
                  {recurring.map(([m, v]) => (
                    <View key={m} style={s.recurRow}>
                      <Text style={s.recurName} numberOfLines={1}>{m}</Text>
                      <Text style={s.recurAmt}>{won(v)}원</Text>
                    </View>
                  ))}
                  <View style={[s.recurRow, { borderTopWidth: 1, borderTopColor: C.card2, paddingTop: 10, marginTop: 4 }]}>
                    <Text style={[s.recurName, { color: C.sub }]}>합계</Text>
                    <Text style={[s.recurAmt, { color: C.blueText }]}>{won(recurring.reduce((s2,[,v])=>s2+v,0))}원</Text>
                  </View>
                </>
              ) : (
                <Text style={s.statEmpty}>지난달과 이번 달에 같은 곳에서 비슷한 금액이 나가면{'\n'}자동으로 여기에 잡혀요 (2개월치 데이터 필요)</Text>
              )}
            </View>

            <View style={s.statCard}>
              <Text style={s.statTitle}>{viewYM.getMonth()+1}월 수입 vs 지출</Text>
              <View style={s.recurRow}><Text style={s.recurName}>수입</Text><Text style={[s.recurAmt, { color: C.green }]}>+{won(incomeTotal)}원</Text></View>
              <View style={s.recurRow}><Text style={s.recurName}>지출</Text><Text style={s.recurAmt}>-{won(total)}원</Text></View>
              <View style={[s.recurRow, { borderTopWidth: 1, borderTopColor: C.card2, paddingTop: 10, marginTop: 4 }]}>
                <Text style={[s.recurName, { color: C.sub }]}>남은 돈</Text>
                <Text style={[s.recurAmt, { color: incomeTotal - total >= 0 ? C.green : C.red }]}>{won(incomeTotal - total)}원</Text>
              </View>
              <Text style={s.statEmpty}>수입은 + 버튼에서 "수입" 탭으로 기록해요</Text>
            </View>

            <TouchableOpacity style={s.exportBtn} activeOpacity={0.8} onPress={exportCSV}>
              <Text style={s.exportBtnT}>📤 {viewYM.getMonth()+1}월 기록 내보내기 (CSV)</Text>
            </TouchableOpacity>
          </>
        )}

        {/* 삭제된 항목 (복원 가능) */}
        {view === 'list' && monthDeleted.length > 0 && (
          <View style={s.dayCard}>
            <TouchableOpacity style={s.dayHead} activeOpacity={0.6} onPress={() => setShowDeleted(v => !v)}>
              <Text style={s.dayHeadT}>🗑 삭제된 항목 {monthDeleted.length}건</Text>
              <Text style={s.dayHeadT}>{showDeleted ? '접기 ▴' : '보기 ▾'}</Text>
            </TouchableOpacity>
            {showDeleted && monthDeleted.map(p => {
              const cat = CAT[p.category] || CAT.etc;
              return (
                <TouchableOpacity key={p.id} style={[s.item, { opacity: 0.5 }]} activeOpacity={0.6}
                  onPress={() => confirmRestore(p)} onLongPress={() => confirmPurge(p)} delayLongPress={450}>
                  <View style={[s.dot, { backgroundColor: cat.color + '26' }]}>
                    <View style={[s.dotCore, { backgroundColor: cat.color }]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.itemName, { textDecorationLine: 'line-through' }]} numberOfLines={1}>{p.merchant}</Text>
                    <Text style={s.itemSub}>{hhmm(p.ts)} · {srcName(p.app)} · 탭하면 복원</Text>
                  </View>
                  <Text style={s.itemAmt}>{won(p.amount)}원</Text>
                </TouchableOpacity>
              );
            })}
            {showDeleted && (
              <Text style={[s.hint, { marginTop: 2, marginBottom: 8 }]}>탭 = 복원 · 길게 = 완전 삭제 (합계에는 포함 안 돼요)</Text>
            )}
          </View>
        )}

        {/* 도움말/테스트 */}
        <View style={{ marginTop: 20 }}>
          <TouchableOpacity style={s.testBtn} onPress={testNotif} activeOpacity={0.7}>
            <Text style={s.testBtnT}>동작 테스트 (가짜 결제 1건 추가)</Text>
          </TouchableOpacity>
          <Text style={s.hint}>내역을 누르면 수정 · 길게 누르면 삭제{'\n'}설정 → 배터리 → 클린페이 → "제한 없음" 권장</Text>
          {!SUPABASE_URL && (
            <Text style={s.hint}>src/config.js에 Supabase 주소를 넣으면 여자친구가 웹으로 조회할 수 있어요</Text>
          )}
        </View>
      </ScrollView>
      )}

      {/* ── 아낀돈 탭 ── */}
      {screen === 'save' && (
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.topRow}>
          <Text style={s.appTitle}>아낀 돈</Text>
          <Text style={s.appSub}>금주 · 금연</Text>
        </View>

        <View style={s.ddayRow}>
          <View style={s.dday}>
            <Text style={s.ddayTag}>금주</Text>
            <Text style={[s.ddayNum, { color: C.green }]}>{soberDays}일째</Text>
            <Text style={s.ddaySince}>+{won(savedSober)}원 아낌</Text>
          </View>
          <View style={s.dday}>
            <Text style={s.ddayTag}>금연</Text>
            <Text style={[s.ddayNum, { color: C.blueText }]}>{smokeDays}일째</Text>
            <Text style={s.ddaySince}>+{won(savedSmoke)}원 아낌</Text>
          </View>
        </View>

        <View style={s.statCard}>
          <View style={s.totalRow}>
            <Text style={s.statTitle}>지금까지 아낀 돈</Text>
            <TouchableOpacity onPress={openQuitEdit} hitSlop={8}>
              <Text style={s.budgetLink}>기준 바꾸기 ›</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.total, { color: C.green }]}>{won(savedTotal)}원</Text>
          <Text style={s.projLine}>
            술 하루 {won(quitSet.soberPerDay)}원 × {soberDays}일 · 담배 하루 {quitSet.cigsPerDay}개비(갑 {won(quitSet.packPrice)}원) × {smokeDays}일
          </Text>
          {quitEdit && (
            <View style={{ marginTop: 6 }}>
              <Text style={s.budLabel}>하루 평균 술값 (원)</Text>
              <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                value={quitDraft.soberPerDay} onChangeText={v => setQuitDraft(d => ({ ...d, soberPerDay: v }))} />
              <Text style={s.budLabel}>하루 피우던 담배 (개비)</Text>
              <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                value={quitDraft.cigsPerDay} onChangeText={v => setQuitDraft(d => ({ ...d, cigsPerDay: v }))} />
              <Text style={s.budLabel}>담배 한 갑 가격 (원)</Text>
              <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                value={quitDraft.packPrice} onChangeText={v => setQuitDraft(d => ({ ...d, packPrice: v }))} />
              <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveQuitDraft}>
                <Text style={s.bigBtnT}>저장</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={s.statCard}>
          <Text style={s.statTitle}>이 돈이면 살 수 있어요 🛒</Text>
          {SHOP_ITEMS.map(it => {
            const v = savedTotal / it.price;
            const can = v >= 1;
            const shown = v >= 10 ? String(Math.floor(v)) : (Math.floor(v * 10) / 10).toString();
            return (
              <View key={it.name} style={s.shopRow}>
                <Text style={s.shopEmoji}>{it.emoji}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.shopName}>{it.name}</Text>
                  <View style={s.shopBarBg}>
                    <View style={[s.shopBarFill, {
                      width: `${Math.min(100, v * 100)}%`,
                      backgroundColor: can ? C.green : '#3A3F4A',
                    }]} />
                  </View>
                </View>
                <Text style={[s.shopCount, can && { color: C.green }]}>
                  {can ? `${shown}${it.unit} 가능!` : `${shown}${it.unit} (${Math.round(v*100)}%)`}
                </Text>
              </View>
            );
          })}
          <Text style={s.statEmpty}>가격은 대략적인 기준이에요 · 하루하루 지날수록 올라가요 📈</Text>
        </View>
      </ScrollView>
      )}

      {/* ── 일기 탭 ── */}
      {screen === 'diary' && (
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.topRow}>
          <Text style={s.appTitle}>일기</Text>
          <Text style={s.appSub}>금주 · 금연 기록</Text>
        </View>

        {/* 요약 */}
        <View style={s.diaryStatsRow}>
          <View style={s.diaryStat}><Text style={s.diaryStatV}>{diaryStats.streak}일</Text><Text style={s.diaryStatL}>연속 작성</Text></View>
          <View style={s.diaryStat}><Text style={s.diaryStatV}>{diaryStats.thisMonth}개</Text><Text style={s.diaryStatL}>이번 달</Text></View>
          <View style={s.diaryStat}><Text style={s.diaryStatV}>{diaryStats.total}개</Text><Text style={s.diaryStatL}>전체</Text></View>
        </View>

        <View style={s.statCard}>
          <TextInput style={[s.input, { minHeight: 70, textAlignVertical: 'top', marginTop: 0 }]} multiline
            placeholder="오늘 어땠나요? (예: 회식이었는데 사이다로 버텼다. 뿌듯함)"
            placeholderTextColor={C.faint} value={diaryText} onChangeText={setDiaryText} />
          <TouchableOpacity style={[s.bigBtn, { backgroundColor: C.green }]} activeOpacity={0.85} onPress={submitDiary}>
            <Text style={s.bigBtnT}>기록하기</Text>
          </TouchableOpacity>
        </View>

        {diary.length === 0 && (
          <Text style={s.empty}>첫 일기를 남겨보세요.{'\n'}나중에 다시 읽으면 힘이 돼요.</Text>
        )}
        {diaryGroups.map(mo => (
          <View key={mo.label}>
            <Text style={s.diaryMonth}>{mo.label}</Text>
            {mo.days.map(dy => (
              <View key={dy.label} style={s.dayCard}>
                <View style={s.dayHead}>
                  <Text style={s.dayHeadT}>{dy.label}</Text>
                  <Text style={s.dayHeadT}>{dy.dayNo}일째</Text>
                </View>
                {dy.items.map(d => (
                  <TouchableOpacity key={d.id} style={s.diaryRow} activeOpacity={0.7}
                    onLongPress={() => confirmDiaryDelete(d)} delayLongPress={450}>
                    <Text style={s.diaryDate}>{hhmm(d.ts)}</Text>
                    <Text style={s.diaryText}>{d.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        ))}
        {diary.length > 0 && <Text style={s.hint}>일기를 길게 누르면 삭제돼요</Text>}
      </ScrollView>
      )}

      {/* 하단 고정 탭바 */}
      <View style={s.bottomBar}>
        {[['home','🏠','가계부'],['save','💰','아낀돈'],['diary','✍️','일기']].map(([k, icon, label]) => (
          <TouchableOpacity key={k} style={s.bottomTab} activeOpacity={0.7} onPress={() => setScreen(k)}>
            <Text style={{ fontSize: 20, opacity: screen === k ? 1 : 0.45 }}>{icon}</Text>
            <Text style={[s.bottomTabT, screen === k && { color: C.text }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* + 직접 추가 버튼 (가계부 탭에서만) */}
      {screen === 'home' && (
        <TouchableOpacity style={s.fab} activeOpacity={0.8} onPress={() => { setAddType('expense'); setAddCat('food'); setAdding(true); }}>
          <Text style={s.fabT}>＋</Text>
        </TouchableOpacity>
      )}

      {/* 달력 일자 상세 모달 */}
      <Modal visible={selDay != null} transparent animationType="slide" onRequestClose={() => setSelDay(null)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setSelDay(null)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>{viewYM.getMonth()+1}월 {selDay}일</Text>
            <Text style={s.daySheetTotal}>{won(selDayTotal)}원</Text>
            {selDayPays.length === 0
              ? <Text style={s.emptySmall}>이날은 쓴 돈이 없어요 👍</Text>
              : <ScrollView style={{ maxHeight: 380 }}>{selDayPays.map(p => renderItem(p, true))}</ScrollView>}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 내역 수정 모달 (카테고리 + 메모) */}
      <Modal visible={!!pickTarget} transparent animationType="slide" onRequestClose={() => setPickTarget(null)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickTarget(null)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>{pickTarget?.merchant}</Text>
            <Text style={s.modalSub}>{pickTarget ? won(pickTarget.amount) + '원' : ''}{pickTarget && !isIncome(pickTarget) ? ' — 카테고리를 바꾸면 이 가맹점은 그걸로 기억해요' : ''}</Text>
            {pickTarget && !isIncome(pickTarget) && (
              <View style={s.catGrid}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity key={c.key} activeOpacity={0.7}
                    style={[s.catBtn, editCat === c.key && s.catBtnOn]}
                    onPress={() => setEditCat(c.key)}>
                    <View style={[s.catBtnDot, { backgroundColor: c.color }]} />
                    <Text style={[s.catBtnT, editCat === c.key && { color: C.text }]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput style={s.input} placeholder="메모 (예: 친구랑 점심, 회사 경비 처리)" placeholderTextColor={C.faint}
              value={editMemo} onChangeText={setEditMemo} />
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveEdit}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 직접 추가 모달 (지출/수입) */}
      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setAdding(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>직접 추가</Text>
            <View style={[s.tabs, { marginTop: 10, marginBottom: 14 }]}>
              <TouchableOpacity style={[s.tab, addType === 'expense' && s.tabOn]} onPress={() => setAddType('expense')}>
                <Text style={[s.tabT, addType === 'expense' && s.tabTOn]}>지출</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.tab, addType === 'income' && s.tabOn]} onPress={() => setAddType('income')}>
                <Text style={[s.tabT, addType === 'income' && { color: C.green }]}>수입</Text>
              </TouchableOpacity>
            </View>
            {addType === 'expense' && (
              <View style={s.catGrid}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity key={c.key} activeOpacity={0.7}
                    style={[s.catBtn, addCat === c.key && s.catBtnOn]}
                    onPress={() => setAddCat(c.key)}>
                    <View style={[s.catBtnDot, { backgroundColor: c.color }]} />
                    <Text style={[s.catBtnT, addCat === c.key && { color: C.text }]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput style={s.input}
              placeholder={addType === 'expense' ? '어디서 썼나요? (예: 김밥천국)' : '어디서 들어왔나요? (예: 월급)'}
              placeholderTextColor={C.faint} value={addName} onChangeText={setAddName} />
            <TextInput style={s.input} placeholder="금액 (원)" placeholderTextColor={C.faint}
              keyboardType="number-pad" value={addAmt} onChangeText={setAddAmt} />
            <TouchableOpacity style={[s.bigBtn, addType === 'income' && { backgroundColor: C.green }]} activeOpacity={0.85} onPress={addManual}>
              <Text style={s.bigBtnT}>추가하기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 예산 설정 모달 */}
      <Modal visible={budgetOpen} transparent animationType="slide" onRequestClose={() => setBudgetOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setBudgetOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>월 예산 설정</Text>
            <Text style={s.modalSub}>비워두면 예산 없이 사용해요. 카테고리 예산은 선택사항.</Text>
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              <Text style={s.budLabel}>전체 월 예산</Text>
              <TextInput style={s.input} placeholder="예: 500000" placeholderTextColor={C.faint}
                keyboardType="number-pad" value={budgetDraft.total}
                onChangeText={v => setBudgetDraft(d => ({ ...d, total: v }))} />
              {CATEGORIES.map(c => (
                <View key={c.key}>
                  <Text style={s.budLabel}>{c.label}</Text>
                  <TextInput style={s.input} placeholder="비워두면 미설정" placeholderTextColor={C.faint}
                    keyboardType="number-pad" value={budgetDraft.cats[c.key] || ''}
                    onChangeText={v => setBudgetDraft(d => ({ ...d, cats: { ...d.cats, [c.key]: v } }))} />
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveBudgetDraft}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingBottom: 150 },
  bottomBar: { position: 'absolute', left: 16, right: 16, bottom: 14, flexDirection: 'row', backgroundColor: C.card, borderRadius: 22, paddingVertical: 9, elevation: 10, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  bottomTab: { flex: 1, alignItems: 'center', gap: 2 },
  bottomTabT: { color: C.faint, fontSize: 11, fontWeight: '700' },
  diaryStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  diaryStat: { flex: 1, backgroundColor: C.card, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  diaryStatV: { color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  diaryStatL: { color: C.faint, fontSize: 11.5, marginTop: 2 },
  diaryMonth: { color: C.sub, fontSize: 13, fontWeight: '700', marginBottom: 8, marginLeft: 4, marginTop: 4 },
  topRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 10, marginBottom: 16 },
  appTitle: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  appSub: { color: C.faint, fontSize: 13 },
  permBanner: { backgroundColor: '#2A2417', borderRadius: 18, padding: 18, marginBottom: 14 },
  permTitle: { color: C.gold, fontWeight: '800', fontSize: 15 },
  permSub: { color: '#B5A268', fontSize: 13, marginTop: 4, lineHeight: 19 },

  ddayRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  dday: { flex: 1, borderRadius: 20, backgroundColor: C.card, padding: 18 },
  ddayTag: { color: C.sub, fontSize: 13, fontWeight: '600' },
  ddayNum: { fontSize: 26, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  ddaySince: { color: C.faint, fontSize: 12, marginTop: 3 },
  savedTeaser: { color: C.sub, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 12, marginTop: -2 },
  closeX: { color: C.sub, fontSize: 20, fontWeight: '700', padding: 4 },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  shopEmoji: { fontSize: 22, width: 30, textAlign: 'center' },
  shopName: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 5 },
  shopBarBg: { height: 6, borderRadius: 3, backgroundColor: C.card2, overflow: 'hidden' },
  shopBarFill: { height: '100%', borderRadius: 3 },
  shopCount: { color: C.faint, fontSize: 12.5, fontWeight: '700', width: 96, textAlign: 'right' },
  diaryRow: { borderTopWidth: 1, borderTopColor: C.card2, paddingVertical: 12 },
  diaryDate: { color: C.faint, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  diaryText: { color: C.text, fontSize: 14.5, lineHeight: 21 },

  month: { backgroundColor: C.card, borderRadius: 20, padding: 20, marginBottom: 12 },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navBtn: { paddingHorizontal: 6 },
  navT: { color: C.faint, fontSize: 22, fontWeight: '600', marginTop: -3 },
  monthTitle: { color: C.sub, fontWeight: '600', fontSize: 14 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { color: C.sub, fontSize: 14 },
  budgetLink: { color: C.faint, fontSize: 13, fontWeight: '600' },
  total: { color: C.text, fontSize: 34, fontWeight: '800', marginTop: 2, letterSpacing: -1 },
  incomeLine: { color: C.green, fontSize: 13, fontWeight: '700', marginTop: 3 },
  deltaPill: { alignSelf: 'flex-start', backgroundColor: C.card2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginTop: 10 },
  deltaT: { fontSize: 13, fontWeight: '700' },
  projLine: { color: C.faint, fontSize: 12.5, marginTop: 8 },

  budBarBg: { height: 8, borderRadius: 4, backgroundColor: C.card2, overflow: 'hidden' },
  budBarFill: { height: '100%', borderRadius: 4 },
  budText: { color: C.faint, fontSize: 12, marginTop: 6 },
  budLabel: { color: C.sub, fontSize: 13, fontWeight: '600', marginTop: 12 },

  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  catName: { color: C.sub, fontSize: 14, width: 66 },
  catBar: { flex: 1, height: 7, borderRadius: 4, backgroundColor: C.card2, overflow: 'hidden' },
  catFill: { height: '100%', borderRadius: 4 },
  catAmtCol: { width: 90, alignItems: 'flex-end' },
  catAmt: { color: C.text, fontSize: 14, fontWeight: '600', letterSpacing: -0.3 },
  catDelta: { fontSize: 10.5, fontWeight: '700', marginTop: 1 },

  tabs: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 4, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  tabOn: { backgroundColor: C.card2 },
  tabT: { color: C.faint, fontSize: 13.5, fontWeight: '700' },
  tabTOn: { color: C.text },

  searchInput: { backgroundColor: C.card, borderRadius: 14, color: C.text, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14.5, marginBottom: 10 },
  filterRow: { marginBottom: 12, flexGrow: 0 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8, marginRight: 8 },
  filterChipOn: { backgroundColor: C.card2 },
  filterChipT: { color: C.faint, fontSize: 13, fontWeight: '700' },
  chipDot: { width: 8, height: 8, borderRadius: 99 },

  dayCard: { backgroundColor: C.card, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, marginBottom: 12 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  dayHeadT: { color: C.faint, fontSize: 13, fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 },
  dot: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  dotCore: { width: 14, height: 14, borderRadius: 7 },
  itemName: { color: C.text, fontWeight: '700', fontSize: 15.5, letterSpacing: -0.3 },
  itemSub: { color: C.faint, fontSize: 12.5, marginTop: 2 },
  itemAmt: { color: C.text, fontWeight: '700', fontSize: 15.5, letterSpacing: -0.3 },
  itemMemo: { color: C.gold, fontSize: 12.5, marginTop: 3, lineHeight: 17 },

  calCard: { backgroundColor: C.card, borderRadius: 20, padding: 14, paddingBottom: 10, marginBottom: 12 },
  noSpendLine: { color: C.sub, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  calHead: { flexDirection: 'row', marginBottom: 6 },
  calDow: { flex: 1, textAlign: 'center', color: C.faint, fontSize: 12, fontWeight: '600' },
  calRow: { flexDirection: 'row' },
  calCell: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 12 },
  calCellOn: { backgroundColor: C.card2 },
  calDayWrap: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  calToday: { backgroundColor: C.blue },
  calDay: { color: C.text, fontSize: 13.5, fontWeight: '600' },
  calAmt: { color: C.sub, fontSize: 9.5, fontWeight: '600', marginTop: 1, minHeight: 12 },
  calHint: { color: C.faint, fontSize: 11.5, textAlign: 'center', marginTop: 8, marginBottom: 4 },

  statCard: { backgroundColor: C.card, borderRadius: 20, padding: 18, marginBottom: 12 },
  statTitle: { color: C.text, fontSize: 15, fontWeight: '800', marginBottom: 14, letterSpacing: -0.3 },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 130 },
  trendCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  trendAmt: { color: C.sub, fontSize: 10, fontWeight: '600' },
  trendBar: { width: 26, borderRadius: 6 },
  trendLabel: { color: C.faint, fontSize: 11.5 },
  recurRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  recurName: { color: C.text, fontSize: 14, flex: 1, marginRight: 10 },
  recurAmt: { color: C.text, fontSize: 14, fontWeight: '700' },
  statEmpty: { color: C.faint, fontSize: 12.5, lineHeight: 18, textAlign: 'center', paddingVertical: 8 },
  exportBtn: { backgroundColor: C.card, borderRadius: 14, padding: 15, alignItems: 'center', marginBottom: 12 },
  exportBtnT: { color: C.sub, fontWeight: '700', fontSize: 13.5 },

  daySheetTotal: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 2, marginBottom: 10 },
  emptySmall: { color: C.sub, fontSize: 14, textAlign: 'center', paddingVertical: 22 },

  empty: { color: C.sub, fontSize: 14, lineHeight: 22, textAlign: 'center', marginVertical: 28 },
  testBtn: { backgroundColor: C.card, borderRadius: 14, padding: 14, alignItems: 'center' },
  testBtnT: { color: C.sub, fontWeight: '700', fontSize: 13 },
  hint: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },

  fab: { position: 'absolute', right: 22, bottom: 88, width: 56, height: 56, borderRadius: 28, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: C.blue, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  fabT: { color: '#fff', fontSize: 26, fontWeight: '600', marginTop: -2 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 36 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.card2, marginBottom: 14 },
  modalTitle: { color: C.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  modalSub: { color: C.sub, fontSize: 13.5, marginTop: 4, marginBottom: 16, lineHeight: 19 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  catBtn: { width: '23%', flexGrow: 1, backgroundColor: C.card2, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  catBtnOn: { backgroundColor: C.press },
  catBtnDot: { width: 13, height: 13, borderRadius: 99, marginBottom: 7 },
  catBtnT: { color: C.sub, fontSize: 12.5, fontWeight: '700' },
  input: { backgroundColor: C.card2, borderRadius: 14, color: C.text, padding: 15, marginTop: 10, fontSize: 15.5 },
  bigBtn: { backgroundColor: C.blue, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 14 },
  bigBtnT: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
