import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  SafeAreaView, View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Modal, TextInput, AppState, RefreshControl, Share, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import {
  getPayments, savePayment, updateItem, deletePayment, restorePayment, purgePayment,
  syncAll, getBudgets, saveBudgets,
  getDiary, addDiary, deleteDiary, getQuitSettings, saveQuitSettings,
  getExplanations, saveExplanation, fetchCheers, deleteCheer,
  getQuitDates, saveQuitDates,
  getRecurring, addRecurring, updateRecurring, deleteRecurring, runRecurringGenerator,
  applySplit, clearSplit,
} from './src/store';
import { cycleLabel, nextDueLabel } from './src/recurring';
import { parsePayment } from './src/parser';
import { QUIT_GOALS, CATEGORIES, SHOP_ITEMS, SUPABASE_URL } from './src/config';
import { hasSupabase } from './src/supabase';
import { getSession, onAuthChange, signUp, signIn, signOut, getMyProfile } from './src/auth';

const SHARE_BASE_URL = 'https://kesjjang12-sudo.github.io/web/';

// 토스 스타일 다크 팔레트
const C = {
  bg:'#101013', card:'#17171C', card2:'#26262C', press:'#2E2E36',
  text:'#E5E8EB', sub:'#8B95A1', faint:'#6B7684',
  blue:'#3182F6', blueText:'#4E9BFA', green:'#16C47F', red:'#F04452', gold:'#E5B84B',
};
const REV = 'r23'; // OTA 배포마다 +1 (화면 우상단에 표시 — 업데이트 적용 확인용)
const LOCK_LIMIT = 100000;   // 하루 이만큼 넘게 쓰면 소명 요청
const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];
// 건강 회복 타임라인 (일 기준)
const HEALTH_SOBER = [
  { d: 1,   t: '혈당이 안정되기 시작해요' },
  { d: 3,   t: '수면의 질이 좋아지기 시작해요' },
  { d: 7,   t: '몸의 수분 균형이 돌아와요' },
  { d: 14,  t: '간에 쌓인 지방이 줄기 시작해요' },
  { d: 30,  t: '간 기능 회복, 피부가 맑아져요' },
  { d: 90,  t: '혈압이 개선돼요' },
  { d: 365, t: '간 질환 위험이 크게 줄어요' },
];
const HEALTH_SMOKE = [
  { d: 1,   t: '심박수와 혈압이 정상으로 돌아와요' },
  { d: 2,   t: '미각과 후각이 되살아나요' },
  { d: 3,   t: '호흡이 한결 편해져요' },
  { d: 14,  t: '혈액순환과 폐 기능이 좋아지기 시작해요' },
  { d: 30,  t: '피부가 좋아지고 기침이 줄어요' },
  { d: 90,  t: '폐 기능이 최대 30% 회복돼요' },
  { d: 365, t: '심장병 위험이 절반으로 줄어요' },
];
const dkey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayISO = () => dkey(new Date());
// 금액 입력창에 콤마 자동 표시 (10000 → 10,000)
const fmtInput = v => { const n = String(v).replace(/[^\d]/g, ''); return n ? Number(n).toLocaleString('ko-KR') : ''; };
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
const srcName = app => !app || app === 'manual' ? '직접 입력' : app === 'test' ? '테스트' : app === 'recurring' ? '고정지출'
  : /messaging/.test(app) ? '문자'
  : /kakaobank|kbstar|sbanking/.test(app) ? '은행' : '카드 알림';

const isIncome = p => p.type === 'income';
const isSaving = p => p.type === 'saving';

export default function Root() {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!hasSupabase) { setChecking(false); return; }

    // 프로필/시작일 동기화는 실패해도 앱 진입을 막지 않음 (네트워크 문제로 영원히 로딩에 갇히는 것 방지)
    const afterLogin = async () => {
      try {
        const p = await getMyProfile();
        setProfile(p);
        if (p && p.sober_start == null) {
          const dates = await getQuitDates();
          await saveQuitDates(dates);
          setProfile({ ...p, sober_start: dates.sober, smoke_start: dates.smoke });
        }
      } catch (e) { /* 다음 앱 실행이나 화면 재진입 때 다시 시도됨 */ }
    };

    let cancelled = false;
    const withTimeout = (p, ms) => Promise.race([
      p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
    (async () => {
      try {
        const s = await withTimeout(getSession(), 8000);
        if (cancelled) return;
        setSession(s);
        if (s) await afterLogin();
      } catch (e) {
        // 세션 확인 자체가 실패해도(오프라인 등) 로그인 화면으로 보내서 재시도할 수 있게 함
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    const sub = onAuthChange(async (s) => {
      setSession(s);
      if (s) await afterLogin(); else setProfile(null);
    });
    return () => { cancelled = true; sub.unsubscribe(); };
  }, []);

  if (!hasSupabase) return <MainApp profile={null} onSignOut={null} />;
  if (checking) {
    return (
      <SafeAreaView style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.blue} />
      </SafeAreaView>
    );
  }
  if (!session) return <AuthScreen />;
  return <MainApp profile={profile} onSignOut={async () => { await signOut(); }} />;
}

function AuthScreen() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = useCallback(async () => {
    if (!email.trim() || pw.length < 6) { setErr('이메일과 6자 이상 비밀번호를 입력해주세요.'); return; }
    setErr(''); setBusy(true);
    try {
      if (mode === 'signup') await signUp(email, pw);
      else await signIn(email, pw);
    } catch (e) {
      setErr(
        /already registered|already exists/i.test(e.message) ? '이미 가입된 이메일이에요. 로그인해주세요.'
        : /invalid login/i.test(e.message) ? '이메일 또는 비밀번호가 올바르지 않아요.'
        : e.message || '문제가 생겼어요. 다시 시도해주세요.'
      );
    } finally { setBusy(false); }
  }, [mode, email, pw]);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={[s.scroll, { flex: 1, justifyContent: 'center' }]}>
          <Text style={s.authTitle}>클린페이</Text>
          <Text style={s.authSub}>{mode === 'signup' ? '계정을 만들고 시작해요' : '로그인하고 계속하기'}</Text>

          <TextInput style={s.input} placeholder="이메일" placeholderTextColor={C.faint}
            autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextInput style={s.input} placeholder="비밀번호 (6자 이상)" placeholderTextColor={C.faint}
            secureTextEntry value={pw} onChangeText={setPw} />
          {!!err && <Text style={s.authErr}>{err}</Text>}

          <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.bigBtnT}>{mode === 'signup' ? '계정 만들기' : '로그인'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={{ marginTop: 18 }} onPress={() => { setErr(''); setMode(m => m === 'signup' ? 'signin' : 'signup'); }}>
            <Text style={s.authSwitch}>
              {mode === 'signup' ? '이미 계정이 있어요 → 로그인' : '처음이에요 → 계정 만들기'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MainApp({ profile, onSignOut }) {
  const [perm, setPerm] = useState('unknown');
  const [payments, setPayments] = useState([]);
  const [budgets, setBudgets] = useState({ total: 0, cats: {} });
  const [refreshing, setRefreshing] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0); // 0=이번달, -1=지난달 ...
  const [view, setView] = useState('list');          // 'list' | 'cal' | 'stat'
  const [selDay, setSelDay] = useState(null);        // 달력에서 선택한 일자
  const [search, setSearch] = useState('');
  const [filterCats, setFilterCats] = useState([]);  // 체크한 카테고리들 (빈 배열=전체)
  const [pickTarget, setPickTarget] = useState(null); // 수정할 기록
  const [editCat, setEditCat] = useState('etc');
  const [editMemo, setEditMemo] = useState('');
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitPeople, setSplitPeople] = useState('');
  const [splitAmount, setSplitAmount] = useState('');
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
  const [diaryView, setDiaryView] = useState('list'); // 'list' | 'cal'
  const [diaryMonthOffset, setDiaryMonthOffset] = useState(0);
  const [diarySelDay, setDiarySelDay] = useState(null);
  const [diarySheetText, setDiarySheetText] = useState('');
  const [quitSet, setQuitSet] = useState({ soberPerDay: 15000, cigsPerDay: 10, packPrice: 4500 });
  const [quitEdit, setQuitEdit] = useState(false);
  const [quitDraft, setQuitDraft] = useState({ soberPerDay: '', cigsPerDay: '', packPrice: '' });
  const [quitDates, setQuitDates] = useState(() => { const t = todayISO(); return { sober: t, smoke: t }; });
  const [dateEdit, setDateEdit] = useState(false);
  const [dateDraft, setDateDraft] = useState({ sober: '', smoke: '' });
  const [dateErr, setDateErr] = useState('');
  const [recurList, setRecurList] = useState([]);
  const [recurOpen, setRecurOpen] = useState(false);
  const [recurEditId, setRecurEditId] = useState(null); // null = 새로 추가
  const [recurDraft, setRecurDraft] = useState(null);
  const [recurErr, setRecurErr] = useState('');
  const [explanations, setExplanations] = useState({});
  const [explainText, setExplainText] = useState('');
  const [cheers, setCheers] = useState([]);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [crisisEntry, setCrisisEntry] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const shareLink = profile?.share_token ? `${SHARE_BASE_URL}?u=${profile.share_token}` : '';

  const shareLinkNative = useCallback(() => {
    if (!shareLink) return;
    Share.share({ message: `내 가계부·D-day를 실시간으로 볼 수 있어요 💙\n${shareLink}` });
  }, [shareLink]);

  const confirmSignOut = useCallback(() => {
    Alert.alert('로그아웃 할까요?', '', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => { setShareOpen(false); onSignOut && onSignOut(); } },
    ]);
  }, [onSignOut]);

  const load = useCallback(async () => {
    await runRecurringGenerator(); // 도래한 고정지출을 먼저 자동 기록
    const [p, b, d, q, qd, ex, ch, rec, st] = await Promise.all([
      getPayments(), getBudgets(), getDiary(), getQuitSettings(), getQuitDates(),
      getExplanations(), fetchCheers(), getRecurring(),
      RNAndroidNotificationListener.getPermissionStatus(),
    ]);
    setPayments(p); setBudgets(b); setDiary(d); setQuitSet(q); setQuitDates(qd);
    setExplanations(ex); setCheers(ch); setRecurList(rec); setPerm(st);
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
  const monthPays = useMemo(() => payments.filter(p => !p.deleted && !isIncome(p) && !isSaving(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthIncome = useMemo(() => payments.filter(p => !p.deleted && isIncome(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthSaving = useMemo(() => payments.filter(p => !p.deleted && isSaving(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthDeleted = useMemo(() => payments.filter(p => p.deleted && inMonth(p, viewYM)), [payments, monthOffset]);
  const total = monthPays.reduce((s, p) => s + p.amount, 0);
  const incomeTotal = monthIncome.reduce((s, p) => s + p.amount, 0);
  const savingTotal = monthSaving.reduce((s, p) => s + p.amount, 0);

  // 지난달 대비: 이번 달=같은 기간(1일~오늘), 과거 달=전체
  const prevPays = useMemo(() => {
    const prevYM = new Date(viewYM.getFullYear(), viewYM.getMonth() - 1, 1);
    const sameWindow = monthOffset === 0;
    return payments.filter(p => {
      if (p.deleted || isIncome(p) || isSaving(p) || !inMonth(p, prevYM)) return false;
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
    const all = [...monthPays, ...monthIncome, ...monthSaving].sort((a,b) => new Date(b.ts) - new Date(a.ts));
    return all.filter(p => {
      if (filterCats.length > 0 && (isIncome(p) || isSaving(p) || !filterCats.includes(CAT[p.category] ? p.category : 'etc'))) return false;
      if (search.trim() && !(p.merchant + (p.memo||'')).toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [monthPays, monthIncome, monthSaving, search, filterCats]);

  // 체크한 카테고리 합계 (검색어와 무관하게, 이 달 전체 기준)
  const filterSum = useMemo(() => {
    if (filterCats.length === 0) return null;
    return monthPays.filter(p => filterCats.includes(CAT[p.category] ? p.category : 'etc')).reduce((s, p) => s + p.amount, 0);
  }, [monthPays, filterCats]);
  const toggleFilterCat = useCallback((k) => {
    setFilterCats(cs => cs.includes(k) ? cs.filter(x => x !== k) : [...cs, k]);
  }, []);

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
      const sum = payments.filter(p => !p.deleted && !isIncome(p) && !isSaving(p) && inMonth(p, ym)).reduce((s,p) => s+p.amount, 0);
      out.push({ label: `${ym.getMonth()+1}월`, sum, cur: i === 0 });
    }
    return out;
  }, [payments]);
  const trendMax = Math.max(...trend.map(t => t.sum), 1);

  // 통계: 고정지출 감지 (이번 달 + 지난달 같은 가맹점 & 금액 ±20%)
  const recurring = useMemo(() => {
    const prevYM = new Date(viewYM.getFullYear(), viewYM.getMonth() - 1, 1);
    const cur = {}, prv = {};
    payments.filter(p => !p.deleted && !isIncome(p) && !isSaving(p) && inMonth(p, viewYM)).forEach(p => { cur[p.merchant] = (cur[p.merchant]||0) + p.amount; });
    payments.filter(p => !p.deleted && !isIncome(p) && !isSaving(p) && inMonth(p, prevYM)).forEach(p => { prv[p.merchant] = (prv[p.merchant]||0) + p.amount; });
    return Object.entries(cur)
      .filter(([m, v]) => prv[m] && Math.abs(v - prv[m]) / Math.max(v, prv[m]) <= 0.2)
      .sort((a,b) => b[1]-a[1]);
  }, [payments, monthOffset]);

  // 고정지출 월 환산 합계 (매일/N일마다인 것도 한 달 기준으로 환산해서 더함)
  const recurMonthlyTotal = useMemo(() => {
    return recurList.filter(t => t.active).reduce((sum, t) => {
      if (t.cycle === 'monthly') return sum + t.amount;
      if (t.cycle === 'daily') return sum + t.amount * 30;
      return sum + t.amount * (30 / Math.max(1, t.intervalDays || 1));
    }, 0);
  }, [recurList]);

  // ── 고정지출 ──
  const openRecurAdd = useCallback(() => {
    setRecurEditId(null); setRecurErr('');
    setRecurDraft({
      merchant: '', amount: '', category: 'sub', memo: '',
      cycle: 'monthly', dayOfMonth: String(new Date().getDate()), intervalDays: '7',
      startDate: todayISO(), fromPaymentId: null,
    });
    setRecurOpen(true);
  }, []);

  const openRecurFromPayment = useCallback((p) => {
    const d = new Date(p.ts);
    setRecurEditId(null); setRecurErr('');
    setRecurDraft({
      merchant: p.merchant, amount: fmtInput(p.amount), category: CAT[p.category] ? p.category : 'etc', memo: '',
      cycle: 'monthly', dayOfMonth: String(d.getDate()), intervalDays: '7',
      startDate: dkey(d), fromPaymentId: p.id,
    });
    setPickTarget(null);
    setRecurOpen(true);
  }, []);

  const openRecurEdit = useCallback((tpl) => {
    setRecurEditId(tpl.id); setRecurErr('');
    setRecurDraft({
      merchant: tpl.merchant, amount: fmtInput(tpl.amount), category: tpl.category, memo: tpl.memo || '',
      cycle: tpl.cycle, dayOfMonth: String(tpl.dayOfMonth || new Date().getDate()), intervalDays: String(tpl.intervalDays || 7),
      startDate: tpl.startDate, fromPaymentId: null,
    });
    setRecurOpen(true);
  }, []);

  const saveRecurDraft = useCallback(async () => {
    const d = recurDraft;
    const amount = parseInt(String(d.amount).replace(/[^\d]/g, ''), 10);
    if (!d.merchant.trim() || !amount) { setRecurErr('이름과 금액을 입력해주세요.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate) || isNaN(new Date(d.startDate))) { setRecurErr('시작일 형식을 확인해주세요 (YYYY-MM-DD)'); return; }
    if (d.cycle === 'monthly' && (d.dayOfMonth < 1 || d.dayOfMonth > 31)) { setRecurErr('날짜는 1~31 사이여야 해요.'); return; }
    if (d.cycle === 'custom' && (!d.intervalDays || Number(d.intervalDays) < 1)) { setRecurErr('며칠마다인지 1 이상으로 입력해주세요.'); return; }

    const tpl = {
      merchant: d.merchant.trim(), amount, category: d.category, memo: d.memo.trim(),
      cycle: d.cycle, dayOfMonth: Number(d.dayOfMonth), intervalDays: Number(d.intervalDays), startDate: d.startDate,
    };
    let next;
    if (recurEditId) next = await updateRecurring(recurEditId, tpl);
    else next = await addRecurring(tpl, d.fromPaymentId);
    setRecurList([...next]);
    if (d.fromPaymentId) setPayments([...await getPayments()]); // 원본 결제에 붙는 배지 반영
    setRecurOpen(false);
  }, [recurDraft, recurEditId]);

  const confirmRecurDelete = useCallback(() => {
    Alert.alert('고정지출을 삭제할까요?', '이미 기록된 지출 내역은 그대로 남아요.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { setRecurList([...await deleteRecurring(recurEditId)]); setRecurOpen(false); } },
    ]);
  }, [recurEditId]);

  // ── 액션 ──
  const openEdit = useCallback((p) => {
    setEditCat(CAT[p.category] ? p.category : 'etc');
    setEditMemo(p.memo || '');
    setSplitOpen(false);
    setSplitPeople(p.splitCount ? String(p.splitCount) : '');
    setSplitAmount(fmtInput(p.amount));
    setPickTarget(p);
  }, []);

  const saveEdit = useCallback(async () => {
    const next = await updateItem(pickTarget.id, {
      category: (isIncome(pickTarget) || isSaving(pickTarget)) ? undefined : editCat, memo: editMemo.trim(),
    });
    setPayments([...next]); setPickTarget(null);
  }, [pickTarget, editCat, editMemo]);

  // ── 엔빵(나눠 내기) ──
  const splitBase = pickTarget ? (pickTarget.originalAmount ?? pickTarget.amount) : 0;

  const onSplitPeopleChange = useCallback((v) => {
    const digits = v.replace(/[^\d]/g, '');
    setSplitPeople(digits);
    const n = Number(digits);
    if (n > 0) setSplitAmount(fmtInput(Math.round(splitBase / n)));
  }, [splitBase]);

  const saveSplit = useCallback(async () => {
    const amt = parseInt(splitAmount.replace(/[^\d]/g, ''), 10);
    if (!amt) return;
    const next = await applySplit(pickTarget.id, amt, splitPeople ? Number(splitPeople) : null);
    setPayments([...next]); setPickTarget(null); setSplitOpen(false);
  }, [pickTarget, splitAmount, splitPeople]);

  const resetSplit = useCallback(async () => {
    const next = await clearSplit(pickTarget.id);
    setPayments([...next]); setPickTarget(null); setSplitOpen(false);
  }, [pickTarget]);

  const addManual = useCallback(async () => {
    const amount = parseInt(addAmt.replace(/[^\d]/g, ''), 10);
    if (!addName.trim() || !amount) { Alert.alert('입력 확인', '이름과 금액을 입력해주세요.'); return; }
    const next = await savePayment({
      id: `m_${Date.now()}`, ts: new Date().toISOString(),
      merchant: addName.trim(), amount, app: 'manual',
      ...(addType === 'income' ? { type: 'income', category: 'etc' }
        : addType === 'saving' ? { type: 'saving', category: 'etc' }
        : { category: addCat }),
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
      total: budgets.total ? fmtInput(budgets.total) : '',
      cats: Object.fromEntries(CATEGORIES.map(c => [c.key, budgets.cats[c.key] ? fmtInput(budgets.cats[c.key]) : ''])),
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
    const rows = [...monthPays, ...monthIncome, ...monthSaving].sort((a,b) => new Date(a.ts) - new Date(b.ts));
    if (rows.length === 0) { Alert.alert('내보내기', '이 달에는 기록이 없어요.'); return; }
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const typeLabel = p => isIncome(p) ? '수입' : isSaving(p) ? '저축' : '지출';
    const lines = ['날짜,시간,이름,금액,종류,카테고리,메모,원래금액'];
    rows.forEach(p => {
      const d = new Date(p.ts);
      lines.push([
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        hhmm(p.ts), esc(p.merchant), p.amount,
        typeLabel(p),
        (isIncome(p) || isSaving(p)) ? '' : (CAT[p.category] || CAT.etc).label,
        esc(p.memo || ''),
        p.originalAmount != null ? p.originalAmount : '',
      ].join(','));
    });
    await Share.share({
      title: `가계부 ${viewYM.getFullYear()}-${viewYM.getMonth()+1}`,
      message: lines.join('\n'),
    });
  }, [monthPays, monthIncome, monthSaving, monthOffset]);

  // ── 소명 잠금: 최근 14일 중 하루 10만원 이상인데 소명 안 한 날 ──
  const lockTarget = useMemo(() => {
    const totals = {}, itemsByDay = {};
    payments.forEach(p => {
      if (p.deleted || isIncome(p) || isSaving(p)) return;
      const d = new Date(p.ts);
      const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
      if (diff < 0 || diff > 14) return;
      const k = dkey(d);
      totals[k] = (totals[k]||0) + p.amount;
      (itemsByDay[k] = itemsByDay[k] || []).push(p);
    });
    const bad = Object.entries(totals)
      .filter(([k, v]) => v >= LOCK_LIMIT && !explanations[k])
      .sort((a, b) => a[0] < b[0] ? -1 : 1);
    if (!bad.length) return null;
    const [k, v] = bad[0];
    const d = new Date(k);
    return { key: k, label: `${d.getMonth()+1}월 ${d.getDate()}일`, total: v, items: itemsByDay[k].sort((a,b)=>b.amount-a.amount) };
  }, [payments, explanations]);

  const submitExplanation = useCallback(async () => {
    if (explainText.trim().length < 5) { Alert.alert('소명 부족', '5자 이상 성의있게 써주세요 😤'); return; }
    setExplanations({ ...await saveExplanation(lockTarget.key, explainText.trim()) });
    setExplainText('');
  }, [lockTarget, explainText]);

  // ── 주간 인사이트: 최근 7일 vs 그 전 3주 평균 ──
  const insight = useMemo(() => {
    const sumRange = (from, to, byCat) => { // from/to: 일수 전 (from > to)
      const out = byCat ? {} : { total: 0 };
      payments.forEach(p => {
        if (p.deleted || isIncome(p) || isSaving(p)) return;
        const d = new Date(p.ts);
        const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
        if (diff > from || diff < to) return;
        if (byCat) { const k = CAT[p.category] ? p.category : 'etc'; out[k] = (out[k]||0) + p.amount; }
        else out.total += p.amount;
      });
      return out;
    };
    const thisWeek = sumRange(6, 0, true);
    const prev = [sumRange(13, 7, true), sumRange(20, 14, true), sumRange(27, 21, true)];
    let best = null;
    for (const k of Object.keys(thisWeek)) {
      const avg = prev.reduce((s, w) => s + (w[k]||0), 0) / 3;
      if (avg < 5000) continue; // 비교할 데이터 부족
      const pct = Math.round((thisWeek[k] - avg) / avg * 100);
      if (Math.abs(pct) >= 30 && Math.abs(thisWeek[k] - avg) >= 10000) {
        if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { cat: k, pct, cur: thisWeek[k] };
      }
    }
    return best;
  }, [payments]);

  // ── 마일스톤 ──
  const soberDaysNow = daysSince(quitDates.sober);
  const smokeDaysNow = daysSince(quitDates.smoke);
  const milestoneToday = [];
  if (MILESTONES.includes(soberDaysNow)) milestoneToday.push(`금주 ${soberDaysNow}일`);
  if (MILESTONES.includes(smokeDaysNow)) milestoneToday.push(`금연 ${smokeDaysNow}일`);
  const nextMs = MILESTONES.find(m => m > Math.min(soberDaysNow, smokeDaysNow));

  const openCrisis = useCallback(() => {
    setCrisisEntry(diary.length ? diary[Math.floor(Math.random() * diary.length)] : null);
    setCrisisOpen(true);
  }, [diary]);

  const confirmCheerDelete = useCallback((c) => {
    Alert.alert('응원을 삭제할까요?', '', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { await deleteCheer(c.id); setCheers(cs => cs.filter(x => x.id !== c.id)); } },
    ]);
  }, []);

  // ── 금주·금연 아낀 돈 ──
  const soberDays = daysSince(quitDates.sober);
  const smokeDays = daysSince(quitDates.smoke);
  const savedSober = Math.max(0, soberDays) * quitSet.soberPerDay;
  const savedSmoke = Math.max(0, smokeDays) * Math.round(quitSet.cigsPerDay / 20 * quitSet.packPrice);
  const savedTotal = savedSober + savedSmoke;

  // 일기 쓴 날이 금주 며칠째였는지
  const diaryDayNo = (iso) => {
    const d = new Date(iso);
    const [y, m, dd] = quitDates.sober.split('-').map(Number);
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

  // ── 일기 달력 ──
  const diaryViewYM = new Date(now.getFullYear(), now.getMonth() + diaryMonthOffset, 1);
  const diaryIsThisMonth = diaryMonthOffset === 0;
  const diaryCal = useMemo(() => {
    const y = diaryViewYM.getFullYear(), m = diaryViewYM.getMonth();
    const daysInM = new Date(y, m + 1, 0).getDate();
    const firstDow = new Date(y, m, 1).getDay();
    const counts = {};
    diary.forEach(d => {
      const dt = new Date(d.ts);
      if (dt.getFullYear() === y && dt.getMonth() === m) { const day = dt.getDate(); counts[day] = (counts[day]||0) + 1; }
    });
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let day = 1; day <= daysInM; day++) cells.push({ d: day, count: counts[day] || 0 });
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [diary, diaryMonthOffset]);

  const diarySelEntries = useMemo(() => {
    if (diarySelDay == null) return [];
    return diary.filter(d => {
      const dt = new Date(d.ts);
      return dt.getFullYear() === diaryViewYM.getFullYear() && dt.getMonth() === diaryViewYM.getMonth() && dt.getDate() === diarySelDay;
    }).sort((a, b) => new Date(b.ts) - new Date(a.ts));
  }, [diary, diarySelDay, diaryMonthOffset]);

  const submitDiaryForDay = useCallback(async () => {
    if (!diarySheetText.trim() || diarySelDay == null) return;
    const d = new Date(diaryViewYM.getFullYear(), diaryViewYM.getMonth(), diarySelDay, 12, 0, 0);
    setDiary(await addDiary(diarySheetText.trim(), d.toISOString()));
    setDiarySheetText('');
  }, [diarySheetText, diarySelDay, diaryMonthOffset]);

  const openDateEdit = useCallback(() => {
    setDateDraft({ sober: quitDates.sober, smoke: quitDates.smoke }); setDateErr(''); setDateEdit(true);
  }, [quitDates]);

  const saveDateEdit = useCallback(async () => {
    const ok = /^\d{4}-\d{2}-\d{2}$/;
    if (!ok.test(dateDraft.sober) || !ok.test(dateDraft.smoke)
      || isNaN(new Date(dateDraft.sober)) || isNaN(new Date(dateDraft.smoke))) {
      setDateErr('YYYY-MM-DD 형식으로 입력해주세요 (예: 2026-07-13)'); return;
    }
    await saveQuitDates(dateDraft);
    setQuitDates(dateDraft); setDateEdit(false);
  }, [dateDraft]);

  const openQuitEdit = useCallback(() => {
    setQuitDraft({
      soberPerDay: fmtInput(quitSet.soberPerDay), cigsPerDay: String(quitSet.cigsPerDay), packPrice: fmtInput(quitSet.packPrice),
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
    const sav = isSaving(p);
    const cat = inc ? { label: '수입', color: C.green } : sav ? { label: '저축', color: C.gold } : (CAT[p.category] || CAT.etc);
    return (
      <TouchableOpacity key={p.id} style={s.item} activeOpacity={0.6}
        onPress={() => { if (fromDaySheet) setSelDay(null); openEdit(p); }}
        onLongPress={() => { if (fromDaySheet) setSelDay(null); confirmDelete(p); }} delayLongPress={450}>
        <View style={[s.dot, { backgroundColor: cat.color + '26' }]}>
          <View style={[s.dotCore, { backgroundColor: cat.color }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.itemName} numberOfLines={1}>{p.recurringId ? '📌 ' : ''}{p.merchant}</Text>
          <Text style={s.itemSub}>{hhmm(p.ts)} · {srcName(p.app)} · {cat.label}</Text>
          {p.originalAmount != null && (
            <Text style={s.itemSplitHint}>원래 {won(p.originalAmount)}원{p.splitCount ? ` · ${p.splitCount}명이서 나눔` : ''}</Text>
          )}
          {!!p.memo && <Text style={s.itemMemo} numberOfLines={2}>{p.memo}</Text>}
        </View>
        <Text style={[s.itemAmt, (inc || sav) && { color: inc ? C.green : C.gold }]}>{(inc || sav) ? '+' : ''}{won(p.amount)}원</Text>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={s.appSub}>{profile?.display_name || '나'}의 가계부 · {REV}</Text>
            {hasSupabase && (
              <TouchableOpacity onPress={() => setShareOpen(true)} hitSlop={8}>
                <Text style={{ fontSize: 16 }}>⚙️</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {perm !== 'authorized' && (
          <TouchableOpacity style={s.permBanner} activeOpacity={0.85}
            onPress={() => RNAndroidNotificationListener.requestPermission()}>
            <Text style={s.permTitle}>알림 접근 권한이 필요해요</Text>
            <Text style={s.permSub}>탭하면 설정이 열려요 → 목록에서 "클린페이" 켜기</Text>
          </TouchableOpacity>
        )}

        {/* 마일스톤 축하 */}
        {milestoneToday.length > 0 && (
          <TouchableOpacity style={s.celebrate} activeOpacity={0.85} onPress={() => setScreen('save')}>
            <Text style={s.celebrateT}>🏆 {milestoneToday.join(' · ')} 달성!</Text>
            <Text style={s.celebrateSub}>대단해요. 지금까지 {won(savedTotal)}원 아꼈어요 → 탭해서 보기</Text>
          </TouchableOpacity>
        )}

        {/* D-day 카드 (탭 → 아낀 돈 + 일기장) */}
        <View style={s.ddayRow}>
          {QUIT_GOALS.map((g, i) => {
            const start = i === 0 ? quitDates.sober : quitDates.smoke;
            const days = daysSince(start);
            const color = i === 0 ? C.green : C.blueText;
            const [, sm, sd] = start.split('-').map(Number);
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
          {(incomeTotal > 0 || savingTotal > 0) && (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {incomeTotal > 0 && <Text style={s.incomeLine}>수입 +{won(incomeTotal)}원</Text>}
              {savingTotal > 0 && <Text style={[s.incomeLine, { color: C.gold }]}>저축 +{won(savingTotal)}원</Text>}
            </View>
          )}
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

        {/* 주간 인사이트 */}
        {insight && (
          <View style={[s.insightCard, { borderLeftColor: insight.pct > 0 ? C.red : C.green }]}>
            <Text style={s.insightT}>
              {insight.pct > 0
                ? `📊 이번 주 ${CAT[insight.cat].label}가 평소보다 ${insight.pct}% 많아요 (${won(insight.cur)}원)`
                : `👏 이번 주 ${CAT[insight.cat].label}를 평소보다 ${Math.abs(insight.pct)}% 아꼈어요`}
            </Text>
          </View>
        )}

        {/* 고정지출 */}
        <View style={s.dayCard}>
          <View style={s.dayHead}>
            <Text style={s.dayHeadT}>📌 고정지출 {recurList.length > 0 ? `${recurList.length}건` : ''}</Text>
            <TouchableOpacity onPress={openRecurAdd} hitSlop={8}>
              <Text style={s.budgetLink}>+ 추가</Text>
            </TouchableOpacity>
          </View>
          {recurList.length > 0 && (
            <Text style={s.recurTotalLine}>월 환산 합계 <Text style={{ color: C.text, fontWeight: '800' }}>{won(Math.round(recurMonthlyTotal))}원</Text></Text>
          )}
          {recurList.length === 0 && (
            <Text style={[s.statEmpty, { paddingBottom: 10 }]}>넷플릭스, 월세처럼 반복되는 지출을 등록해두면{'\n'}주기마다 자동으로 기록돼요.</Text>
          )}
          {recurList.map(tpl => {
            const cat = CAT[tpl.category] || CAT.etc;
            return (
              <TouchableOpacity key={tpl.id} style={s.item} activeOpacity={0.6} onPress={() => openRecurEdit(tpl)}>
                <View style={[s.dot, { backgroundColor: cat.color + '26' }]}>
                  <View style={[s.dotCore, { backgroundColor: cat.color }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.itemName} numberOfLines={1}>{tpl.merchant}</Text>
                  <Text style={s.itemSub}>{cycleLabel(tpl)} · {nextDueLabel(tpl)}{!tpl.active ? ' · 일시정지' : ''}</Text>
                </View>
                <Text style={s.itemAmt}>{won(tpl.amount)}원</Text>
              </TouchableOpacity>
            );
          })}
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
              <TouchableOpacity style={[s.filterChip, filterCats.length === 0 && s.filterChipOn]} onPress={() => setFilterCats([])}>
                <Text style={[s.filterChipT, filterCats.length === 0 && { color: C.text }]}>전체</Text>
              </TouchableOpacity>
              {CATEGORIES.map(c => {
                const on = filterCats.includes(c.key);
                return (
                  <TouchableOpacity key={c.key} style={[s.filterChip, on && s.filterChipOn]} onPress={() => toggleFilterCat(c.key)}>
                    <View style={[s.checkbox, on && { backgroundColor: c.color, borderColor: c.color }]}>
                      {on && <Text style={s.checkboxMark}>✓</Text>}
                    </View>
                    <Text style={[s.filterChipT, on && { color: C.text }]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {filterSum !== null && (
              <View style={s.filterSumCard}>
                <Text style={s.filterSumLabel}>
                  {filterCats.map(k => CAT[k].label).join(' + ')} 합계
                </Text>
                <Text style={s.filterSumAmt}>{won(filterSum)}원</Text>
                <Text style={s.filterSumPct}>이 달 전체의 {total > 0 ? Math.round(filterSum / total * 100) : 0}%</Text>
              </View>
            )}
            {groups.map(g => {
              const gk = dkey(new Date(g.items[0].ts));
              return (
                <View key={g.label} style={s.dayCard}>
                  <View style={s.dayHead}>
                    <Text style={s.dayHeadT}>{g.label}</Text>
                    <Text style={s.dayHeadT}>{won(g.items.filter(x => !isIncome(x) && !isSaving(x)).reduce((s2,x)=>s2+x.amount,0))}원</Text>
                  </View>
                  {explanations[gk] && (
                    <Text style={s.explainLine}>📋 소명: {explanations[gk]}</Text>
                  )}
                  {g.items.map(p => renderItem(p, false))}
                </View>
              );
            })}
            {listPays.length === 0 && (
              <Text style={s.empty}>{search || filterCats.length > 0 ? '조건에 맞는 기록이 없어요.' : '아직 이 달 기록이 없어요.\n카드 결제 알림이 오면 자동으로 쌓이고,\n현금은 아래 + 버튼으로 직접 추가할 수 있어요.'}</Text>
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
              <Text style={s.statTitle}>{viewYM.getMonth()+1}월 수입 · 지출 · 저축</Text>
              <View style={s.recurRow}><Text style={s.recurName}>수입</Text><Text style={[s.recurAmt, { color: C.green }]}>+{won(incomeTotal)}원</Text></View>
              <View style={s.recurRow}><Text style={s.recurName}>지출</Text><Text style={s.recurAmt}>-{won(total)}원</Text></View>
              <View style={s.recurRow}><Text style={s.recurName}>저축</Text><Text style={[s.recurAmt, { color: C.gold }]}>-{won(savingTotal)}원</Text></View>
              <View style={[s.recurRow, { borderTopWidth: 1, borderTopColor: C.card2, paddingTop: 10, marginTop: 4 }]}>
                <Text style={[s.recurName, { color: C.sub }]}>남은 돈</Text>
                <Text style={[s.recurAmt, { color: incomeTotal - total - savingTotal >= 0 ? C.green : C.red }]}>{won(incomeTotal - total - savingTotal)}원</Text>
              </View>
              <Text style={s.statEmpty}>+ 버튼에서 "수입"·"저축" 탭으로 각각 기록해요</Text>
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
        {nextMs && (
          <Text style={s.savedTeaser}>다음 목표 🎯 {nextMs}일까지 <Text style={{ color: C.blueText, fontWeight: '800' }}>D-{nextMs - Math.min(soberDaysNow, smokeDaysNow)}</Text></Text>
        )}
        <TouchableOpacity activeOpacity={0.7} onPress={openDateEdit} style={{ alignSelf: 'center', marginBottom: 12 }}>
          <Text style={s.budgetLink}>시작일 바꾸기 ›</Text>
        </TouchableOpacity>
        {dateEdit && (
          <View style={[s.statCard, { paddingTop: 16 }]}>
            <Text style={s.budLabel}>금주 시작일 (YYYY-MM-DD)</Text>
            <TextInput style={s.input} placeholder="2026-07-13" placeholderTextColor={C.faint}
              value={dateDraft.sober} onChangeText={v => setDateDraft(d => ({ ...d, sober: v }))} />
            <Text style={s.budLabel}>금연 시작일 (YYYY-MM-DD)</Text>
            <TextInput style={s.input} placeholder="2026-07-13" placeholderTextColor={C.faint}
              value={dateDraft.smoke} onChangeText={v => setDateDraft(d => ({ ...d, smoke: v }))} />
            {!!dateErr && <Text style={s.authErr}>{dateErr}</Text>}
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveDateEdit}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 위기 버튼 */}
        <TouchableOpacity style={s.crisisBtn} activeOpacity={0.85} onPress={openCrisis}>
          <Text style={s.crisisBtnT}>😵 술·담배 땡길 때 누르는 버튼</Text>
        </TouchableOpacity>

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
                value={quitDraft.soberPerDay} onChangeText={v => setQuitDraft(d => ({ ...d, soberPerDay: fmtInput(v) }))} />
              <Text style={s.budLabel}>하루 피우던 담배 (개비)</Text>
              <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                value={quitDraft.cigsPerDay} onChangeText={v => setQuitDraft(d => ({ ...d, cigsPerDay: v }))} />
              <Text style={s.budLabel}>담배 한 갑 가격 (원)</Text>
              <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                value={quitDraft.packPrice} onChangeText={v => setQuitDraft(d => ({ ...d, packPrice: fmtInput(v) }))} />
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

        {/* 건강 회복 타임라인 */}
        {[['🍺 금주하면 몸이 이렇게 좋아져요', HEALTH_SOBER, soberDays], ['🚭 금연하면 몸이 이렇게 좋아져요', HEALTH_SMOKE, smokeDays]].map(([title, list, days]) => (
          <View key={title} style={s.statCard}>
            <Text style={s.statTitle}>{title}</Text>
            {list.map(h => {
              const done = days >= h.d;
              return (
                <View key={h.d} style={s.healthRow}>
                  <Text style={[s.healthCheck, { color: done ? C.green : '#3A3F4A' }]}>{done ? '✓' : '○'}</Text>
                  <Text style={[s.healthDay, done && { color: C.sub }]}>{h.d}일</Text>
                  <Text style={[s.healthText, done && { color: C.text }]}>{h.t}</Text>
                  {!done && <Text style={s.healthDminus}>D-{h.d - days}</Text>}
                </View>
              );
            })}
          </View>
        ))}

      </ScrollView>
      )}

      {/* ── 응원함 탭 ── */}
      {screen === 'cheer' && (
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.sub} />}>
        <View style={s.topRow}>
          <Text style={s.appTitle}>응원함 💌</Text>
          <Text style={s.appSub}>{cheers.length > 0 ? `${cheers.length}개 도착` : ''}</Text>
        </View>
        {cheers.length === 0 ? (
          <Text style={s.empty}>아직 도착한 응원이 없어요.{'\n'}친구들이 조회 페이지 맨 아래에서 남길 수 있어요.{'\n'}남긴 응원은 페이지에는 안 보이고 여기서만 보여요.</Text>
        ) : (
          <View style={s.dayCard}>
            {cheers.map(c => {
              const dt = new Date(c.ts);
              return (
                <TouchableOpacity key={c.id} style={s.diaryRow} activeOpacity={0.7}
                  onLongPress={() => confirmCheerDelete(c)} delayLongPress={450}>
                  <Text style={s.diaryDate}>💌 {c.name || '익명'} · {dt.getMonth()+1}월 {dt.getDate()}일 {hhmm(c.ts)}</Text>
                  <Text style={s.diaryText}>{c.text}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {cheers.length > 0 && <Text style={s.hint}>응원을 길게 누르면 삭제돼요 · 아래로 당기면 새로고침</Text>}
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

        {/* 뷰 전환 탭 */}
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, diaryView === 'list' && s.tabOn]} onPress={() => setDiaryView('list')}>
            <Text style={[s.tabT, diaryView === 'list' && s.tabTOn]}>내역</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, diaryView === 'cal' && s.tabOn]} onPress={() => setDiaryView('cal')}>
            <Text style={[s.tabT, diaryView === 'cal' && s.tabTOn]}>달력</Text>
          </TouchableOpacity>
        </View>

        {diaryView === 'list' && (
          <>
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
          </>
        )}

        {diaryView === 'cal' && (
          <View style={s.calCard}>
            <View style={s.monthHead}>
              <TouchableOpacity onPress={() => { setDiaryMonthOffset(o => o-1); setDiarySelDay(null); }} style={s.navBtn} hitSlop={8}>
                <Text style={s.navT}>‹</Text>
              </TouchableOpacity>
              <Text style={s.monthTitle}>{diaryViewYM.getFullYear()}년 {diaryViewYM.getMonth()+1}월</Text>
              <TouchableOpacity onPress={() => { setDiaryMonthOffset(o => Math.min(0, o+1)); setDiarySelDay(null); }} style={s.navBtn} hitSlop={8}>
                <Text style={[s.navT, diaryIsThisMonth && { opacity: 0.25 }]}>›</Text>
              </TouchableOpacity>
            </View>
            <View style={s.calHead}>
              {DAY_NAMES.map((d, i) => (
                <Text key={d} style={[s.calDow, i === 0 && { color: '#C96A6A' }, i === 6 && { color: '#6A8FC9' }]}>{d}</Text>
              ))}
            </View>
            {Array.from({ length: diaryCal.length / 7 }, (_, r) => (
              <View key={r} style={s.calRow}>
                {diaryCal.slice(r*7, r*7+7).map((cell, i) => {
                  if (!cell) return <View key={i} style={s.calCell} />;
                  const isToday = diaryIsThisMonth && cell.d === todayDate;
                  const isFuture = diaryIsThisMonth && cell.d > todayDate;
                  return (
                    <TouchableOpacity key={i} style={[s.calCell, diarySelDay === cell.d && s.calCellOn]}
                      activeOpacity={0.6} disabled={isFuture}
                      onPress={() => { setDiarySelDay(cell.d); setDiarySheetText(''); }}>
                      <View style={[s.calDayWrap, isToday && s.calToday]}>
                        <Text style={[s.calDay, isToday && { color: '#fff' }, isFuture && { color: '#3A3A42' }]}>{cell.d}</Text>
                      </View>
                      <Text style={[s.calAmt, cell.count > 0 && { color: C.green }]} numberOfLines={1}>
                        {cell.count > 0 ? (cell.count > 1 ? `✎${cell.count}` : '✎') : ' '}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <Text style={s.calHint}>날짜를 누르면 그날 일기를 보거나 쓸 수 있어요</Text>
          </View>
        )}
      </ScrollView>
      )}

      {/* 하단 고정 탭바 */}
      <View style={s.bottomBar}>
        {[['home','🏠','가계부'],['save','💰','아낀돈'],['diary','✍️','일기'],['cheer','💌', cheers.length ? `응원 ${cheers.length}` : '응원']].map(([k, icon, label]) => (
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

      {/* 일기 달력 일자 상세/작성 모달 */}
      <Modal visible={diarySelDay != null} transparent animationType="slide" onRequestClose={() => setDiarySelDay(null)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setDiarySelDay(null)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>{diaryViewYM.getMonth()+1}월 {diarySelDay}일</Text>
            <Text style={s.modalSub}>이날의 일기를 보거나 새로 쓸 수 있어요</Text>
            <TextInput style={[s.input, { minHeight: 64, textAlignVertical: 'top', marginTop: 0 }]} multiline
              placeholder="이날 어땠나요?" placeholderTextColor={C.faint}
              value={diarySheetText} onChangeText={setDiarySheetText} />
            <TouchableOpacity style={[s.bigBtn, { backgroundColor: C.green }]} activeOpacity={0.85} onPress={submitDiaryForDay}>
              <Text style={s.bigBtnT}>기록하기</Text>
            </TouchableOpacity>
            {diarySelEntries.length === 0 ? (
              <Text style={[s.emptySmall, { paddingTop: 18 }]}>이날 쓴 일기가 아직 없어요</Text>
            ) : (
              <ScrollView style={{ maxHeight: 260, marginTop: 14 }}>
                {diarySelEntries.map(d => (
                  <TouchableOpacity key={d.id} style={s.diaryRow} activeOpacity={0.7}
                    onLongPress={() => confirmDiaryDelete(d)} delayLongPress={450}>
                    <Text style={s.diaryDate}>{hhmm(d.ts)}</Text>
                    <Text style={s.diaryText}>{d.text}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 내역 수정 모달 (카테고리 + 메모) */}
      <Modal visible={!!pickTarget} transparent animationType="slide" onRequestClose={() => setPickTarget(null)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickTarget(null)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>{pickTarget?.merchant}</Text>
            <Text style={s.modalSub}>{pickTarget ? won(pickTarget.amount) + '원' : ''}{pickTarget && !isIncome(pickTarget) && !isSaving(pickTarget) ? ' — 카테고리를 바꾸면 이 가맹점은 그걸로 기억해요' : ''}</Text>
            {pickTarget && !isIncome(pickTarget) && !isSaving(pickTarget) && (
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

            {pickTarget && !isIncome(pickTarget) && !isSaving(pickTarget) && (
              <>
                {!splitOpen ? (
                  <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }} onPress={() => setSplitOpen(true)}>
                    <Text style={s.recurConvertT}>🍕 {pickTarget.originalAmount != null ? '나눠 낸 금액 다시 조정하기' : '나눠 냈어요 (엔빵)'}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ marginTop: 16 }}>
                    <Text style={s.budLabel}>원래 결제 금액</Text>
                    <Text style={s.splitBaseAmt}>{won(splitBase)}원</Text>
                    <Text style={s.budLabel}>몇 명이서 나눴나요?</Text>
                    <TextInput style={s.input} keyboardType="number-pad" placeholder="예: 4" placeholderTextColor={C.faint}
                      value={splitPeople} onChangeText={onSplitPeopleChange} />
                    <Text style={s.budLabel}>내가 낼 금액</Text>
                    <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                      value={splitAmount} onChangeText={v => setSplitAmount(fmtInput(v))} />
                    <TouchableOpacity style={[s.bigBtn, { backgroundColor: C.gold }]} activeOpacity={0.85} onPress={saveSplit}>
                      <Text style={s.bigBtnT}>이 금액만 지출로 반영</Text>
                    </TouchableOpacity>
                    {pickTarget.originalAmount != null && (
                      <TouchableOpacity style={{ marginTop: 12, alignItems: 'center' }} onPress={resetSplit}>
                        <Text style={{ color: C.faint, fontWeight: '700', fontSize: 13 }}>분할 해제 (원래 금액으로)</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </>
            )}

            {pickTarget && !isIncome(pickTarget) && !isSaving(pickTarget) && (
              pickTarget.recurringId ? (
                <Text style={s.recurLinkedHint}>📌 이미 고정지출로 등록되어 있어요</Text>
              ) : (
                <TouchableOpacity style={{ marginTop: 14, alignItems: 'center' }} onPress={() => openRecurFromPayment(pickTarget)}>
                  <Text style={s.recurConvertT}>📌 고정지출로 등록하기</Text>
                </TouchableOpacity>
              )
            )}
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
              <TouchableOpacity style={[s.tab, addType === 'saving' && s.tabOn]} onPress={() => setAddType('saving')}>
                <Text style={[s.tabT, addType === 'saving' && { color: C.gold }]}>저축</Text>
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
              placeholder={addType === 'expense' ? '어디서 썼나요? (예: 김밥천국)' : addType === 'income' ? '어디서 들어왔나요? (예: 월급)' : '어떤 적금·저축인가요? (예: 청약저축)'}
              placeholderTextColor={C.faint} value={addName} onChangeText={setAddName} />
            <TextInput style={s.input} placeholder="금액 (원)" placeholderTextColor={C.faint}
              keyboardType="number-pad" value={addAmt} onChangeText={v => setAddAmt(fmtInput(v))} />
            <TouchableOpacity style={[s.bigBtn, addType === 'income' && { backgroundColor: C.green }, addType === 'saving' && { backgroundColor: C.gold }]} activeOpacity={0.85} onPress={addManual}>
              <Text style={s.bigBtnT}>추가하기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 설정 / 공유 링크 모달 */}
      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setShareOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>내 공유 링크 🔗</Text>
            <Text style={s.modalSub}>이 링크를 보내면 상대방이 내 D-day와 지출을 실시간으로 볼 수 있어요.{'\n'}(계좌·카드 정보는 보이지 않아요)</Text>
            <View style={s.shareLinkBox}>
              <TextInput style={s.shareLinkT} value={shareLink || '링크를 만드는 중...'} editable={false} selectTextOnFocus multiline />
            </View>
            <Text style={s.shareLinkHint}>길게 눌러서 직접 복사할 수도 있어요</Text>
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={shareLinkNative} disabled={!shareLink}>
              <Text style={s.bigBtnT}>카톡 등으로 보내기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={confirmSignOut}>
              <Text style={{ color: C.red, fontWeight: '700', fontSize: 14 }}>로그아웃</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 🚨 고액 지출 소명 모달 (소명 전까지 안 닫힘) */}
      <Modal visible={!!lockTarget} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={s.modalBg}>
          <View style={[s.modalCard, { borderTopWidth: 3, borderTopColor: C.red }]}>
            <Text style={[s.modalTitle, { color: C.red }]}>🚨 소명 요청</Text>
            <Text style={s.modalSub}>
              {lockTarget?.label}에 {lockTarget ? won(lockTarget.total) : ''}원 썼어요 (하루 {won(LOCK_LIMIT)}원 초과).{'\n'}뭐에 썼는지 소명하기 전까지 앱이 잠겨요 🔒
            </Text>
            {lockTarget?.items.slice(0, 4).map(p => (
              <View key={p.id} style={s.recurRow}>
                <Text style={s.recurName} numberOfLines={1}>{p.merchant}</Text>
                <Text style={s.recurAmt}>{won(p.amount)}원</Text>
              </View>
            ))}
            {lockTarget && lockTarget.items.length > 4 && (
              <Text style={s.statEmpty}>외 {lockTarget.items.length - 4}건</Text>
            )}
            <TextInput style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]} multiline
              placeholder="소명하세요 (예: 부모님 선물 샀음. 정당한 지출임)"
              placeholderTextColor={C.faint} value={explainText} onChangeText={setExplainText} />
            <TouchableOpacity style={[s.bigBtn, { backgroundColor: C.red }]} activeOpacity={0.85} onPress={submitExplanation}>
              <Text style={s.bigBtnT}>소명 제출</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 위기 버튼 모달 */}
      <Modal visible={crisisOpen} transparent animationType="slide" onRequestClose={() => setCrisisOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setCrisisOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>잠깐만요 ✋</Text>
            <Text style={s.modalSub}>지금 마시거나 피우면, 이걸 전부 리셋하는 거예요:</Text>
            <View style={s.crisisBox}>
              <Text style={s.crisisMoney}>{won(savedTotal)}원</Text>
              <Text style={s.crisisMoneySub}>금주 {soberDays}일 · 금연 {smokeDays}일 동안 아낀 돈</Text>
            </View>
            {crisisEntry ? (
              <View style={s.crisisBox}>
                <Text style={s.diaryDate}>📖 {new Date(crisisEntry.ts).getMonth()+1}월 {new Date(crisisEntry.ts).getDate()}일의 내가 남긴 말</Text>
                <Text style={s.diaryText}>"{crisisEntry.text}"</Text>
              </View>
            ) : (
              <View style={s.crisisBox}>
                <Text style={s.diaryText}>일기를 써두면 위기의 순간에 과거의 내가 나타나서 말려줘요 ✍️</Text>
              </View>
            )}
            <TouchableOpacity style={[s.bigBtn, { backgroundColor: C.green }]} activeOpacity={0.85} onPress={() => setCrisisOpen(false)}>
              <Text style={s.bigBtnT}>참는다 💪</Text>
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
                onChangeText={v => setBudgetDraft(d => ({ ...d, total: fmtInput(v) }))} />
              {CATEGORIES.map(c => (
                <View key={c.key}>
                  <Text style={s.budLabel}>{c.label}</Text>
                  <TextInput style={s.input} placeholder="비워두면 미설정" placeholderTextColor={C.faint}
                    keyboardType="number-pad" value={budgetDraft.cats[c.key] || ''}
                    onChangeText={v => setBudgetDraft(d => ({ ...d, cats: { ...d.cats, [c.key]: fmtInput(v) } }))} />
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveBudgetDraft}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 고정지출 추가/수정 모달 */}
      <Modal visible={recurOpen} transparent animationType="slide" onRequestClose={() => setRecurOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setRecurOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>{recurEditId ? '고정지출 수정' : '고정지출 추가'}</Text>
            <Text style={s.modalSub}>주기가 돌아올 때마다 자동으로 지출이 기록돼요.</Text>
            {recurDraft && (
              <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
                <TextInput style={s.input} placeholder="이름 (예: 넷플릭스, 월세)" placeholderTextColor={C.faint}
                  value={recurDraft.merchant} onChangeText={v => setRecurDraft(d => ({ ...d, merchant: v }))} />
                <TextInput style={s.input} placeholder="금액 (원)" placeholderTextColor={C.faint} keyboardType="number-pad"
                  value={recurDraft.amount} onChangeText={v => setRecurDraft(d => ({ ...d, amount: fmtInput(v) }))} />

                <View style={s.catGrid}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity key={c.key} activeOpacity={0.7}
                      style={[s.catBtn, recurDraft.category === c.key && s.catBtnOn]}
                      onPress={() => setRecurDraft(d => ({ ...d, category: c.key }))}>
                      <View style={[s.catBtnDot, { backgroundColor: c.color }]} />
                      <Text style={[s.catBtnT, recurDraft.category === c.key && { color: C.text }]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={s.budLabel}>주기</Text>
                <View style={s.tabs}>
                  {[['monthly','매월'],['daily','매일'],['custom','사용자 설정']].map(([k, label]) => (
                    <TouchableOpacity key={k} style={[s.tab, recurDraft.cycle === k && s.tabOn]}
                      onPress={() => setRecurDraft(d => ({ ...d, cycle: k }))}>
                      <Text style={[s.tabT, recurDraft.cycle === k && s.tabTOn]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {recurDraft.cycle === 'monthly' && (
                  <>
                    <Text style={s.budLabel}>매월 며칠 (1~31)</Text>
                    <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                      value={recurDraft.dayOfMonth} onChangeText={v => setRecurDraft(d => ({ ...d, dayOfMonth: v.replace(/[^\d]/g,'') }))} />
                  </>
                )}
                {recurDraft.cycle === 'custom' && (
                  <>
                    <Text style={s.budLabel}>며칠마다</Text>
                    <TextInput style={s.input} keyboardType="number-pad" placeholderTextColor={C.faint}
                      value={recurDraft.intervalDays} onChangeText={v => setRecurDraft(d => ({ ...d, intervalDays: v.replace(/[^\d]/g,'') }))} />
                  </>
                )}
                <Text style={s.budLabel}>시작일 (YYYY-MM-DD)</Text>
                <TextInput style={s.input} placeholder="2026-07-15" placeholderTextColor={C.faint}
                  value={recurDraft.startDate} onChangeText={v => setRecurDraft(d => ({ ...d, startDate: v }))} />
                <TextInput style={s.input} placeholder="메모 (선택)" placeholderTextColor={C.faint}
                  value={recurDraft.memo} onChangeText={v => setRecurDraft(d => ({ ...d, memo: v }))} />

                {!!recurErr && <Text style={s.authErr}>{recurErr}</Text>}
              </ScrollView>
            )}
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveRecurDraft}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
            {recurEditId && (
              <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }} onPress={confirmRecurDelete}>
                <Text style={{ color: C.red, fontWeight: '700', fontSize: 14 }}>고정지출 삭제</Text>
              </TouchableOpacity>
            )}
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
  celebrate: { backgroundColor: '#1E2A1B', borderRadius: 20, padding: 18, marginBottom: 12 },
  celebrateT: { color: C.green, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  celebrateSub: { color: '#8FBF9C', fontSize: 13, marginTop: 4 },
  insightCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 12, borderLeftWidth: 3 },
  insightT: { color: C.text, fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  explainLine: { color: C.gold, fontSize: 12.5, lineHeight: 18, marginBottom: 6 },
  crisisBtn: { backgroundColor: '#2A1B1E', borderRadius: 16, padding: 15, alignItems: 'center', marginBottom: 12 },
  crisisBtnT: { color: '#E58B95', fontSize: 14, fontWeight: '800' },
  crisisBox: { backgroundColor: C.card2, borderRadius: 14, padding: 14, marginTop: 10 },
  crisisMoney: { color: C.green, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  crisisMoneySub: { color: C.sub, fontSize: 12.5, marginTop: 3 },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  healthCheck: { fontSize: 14, fontWeight: '800', width: 18, textAlign: 'center' },
  healthDay: { color: C.faint, fontSize: 12.5, fontWeight: '700', width: 42 },
  healthText: { color: C.faint, fontSize: 13.5, flex: 1 },
  healthDminus: { color: C.faint, fontSize: 11.5, fontWeight: '700' },
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
  checkbox: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  checkboxMark: { color: '#0B0D10', fontSize: 10, fontWeight: '900' },
  filterSumCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12, alignItems: 'center' },
  filterSumLabel: { color: C.sub, fontSize: 13, fontWeight: '600' },
  filterSumAmt: { color: C.text, fontSize: 26, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  filterSumPct: { color: C.faint, fontSize: 12, marginTop: 3 },
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
  itemSplitHint: { color: C.faint, fontSize: 11.5, marginTop: 2 },
  splitBaseAmt: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 2, marginBottom: 4, letterSpacing: -0.4 },

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

  authTitle: { color: C.text, fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: -0.6 },
  authSub: { color: C.sub, fontSize: 14, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  authErr: { color: C.red, fontSize: 13, marginTop: 10, textAlign: 'center' },
  recurLinkedHint: { color: C.faint, fontSize: 12.5, marginTop: 14, textAlign: 'center' },
  recurTotalLine: { color: C.faint, fontSize: 12.5, marginBottom: 10 },
  recurConvertT: { color: C.blueText, fontWeight: '700', fontSize: 13.5 },
  authSwitch: { color: C.blueText, fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
  shareLinkBox: { backgroundColor: C.card2, borderRadius: 14, padding: 15, marginTop: 4 },
  shareLinkT: { color: C.blueText, fontSize: 13.5, fontWeight: '600' },
  shareLinkHint: { color: C.faint, fontSize: 11.5, marginTop: 6, textAlign: 'center' },
});
