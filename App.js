import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  SafeAreaView, View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Modal, TextInput, AppState, RefreshControl, Share, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import {
  getPayments, savePayment, updateItem, deletePayment, restorePayment, purgePayment,
  syncAll, getBudgets, saveBudgets,
  getDiary, addDiary, deleteDiary, getQuitSettings, saveQuitSettings,
  getExplanations, saveExplanation, fetchCheers, deleteCheer,
  getQuitDates, saveQuitDates,
  getRecurring, addRecurring, updateRecurring, deleteRecurring, runRecurringGenerator,
  applySplit, clearSplit,
  getGoals, addGoal, updateGoal, deleteGoal,
  getKnownTags, parseTags, setPaymentTags, recategorizeMerchant, countOtherCategory,
  backupNow, restoreFromBackup, getLastBackupAt, fetchBackupInfo, autoRestoreIfEmpty,
  pullFromSupabase, hasLocalData, findDuplicates, removeDuplicates,
  getSeenApps, getWatchApps, toggleWatchApp,
  getBalance, getCardTargets, saveCardTargets, setOwed, toggleOwedSettled,
} from './src/store';
import { cycleLabel, nextDueLabel, addDays as addDaysLocal, toDateOnly as toDateOnlyLocal } from './src/recurring';
import { goalRange, goalPeriodLabel, goalKindLabel, daysLeftLabel, weekRange as weekRangeLocal } from './src/goals';
import { parsePayment } from './src/parser';
import { QUIT_GOALS, CATEGORIES, SHOP_ITEMS, SUPABASE_URL, BANK_PACKAGES } from './src/config';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { CleanpayWidget } from './src/widget/CleanpayWidget';
import { buildSummary } from './src/summary';
import { hasSupabase } from './src/supabase';
import { getSession, onAuthChange, signUp, signIn, signOut, getMyProfile, hasStoredSession } from './src/auth';

const SHARE_BASE_URL = 'https://kesjjang12-sudo.github.io/web/';

// 토스 스타일 다크 팔레트
const C = {
  bg:'#101013', card:'#17171C', card2:'#26262C', press:'#2E2E36',
  text:'#E5E8EB', sub:'#8B95A1', faint:'#6B7684',
  blue:'#3182F6', blueText:'#4E9BFA', green:'#16C47F', red:'#F04452', gold:'#E5B84B',
};
const REV = 'r40'; // OTA 배포마다 +1 (화면 우상단에 표시 — 업데이트 적용 확인용)
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

// 화면이 터졌을 때 하얀 화면 대신 원인을 보여주고 스스로 복구할 수 있게 하는 안전망.
// (이게 없으면 오류가 나도 사용자는 "앱이 안 켜져요" 밖에 알 수 없음)
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { this.info = info; }

  render() {
    if (!this.state.err) return this.props.children;
    const msg = `${this.state.err?.message || this.state.err}\n\n${this.info?.componentStack || ''}`.slice(0, 1500);
    return (
      <SafeAreaView style={[s.root, { padding: 20, justifyContent: 'center' }]}>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>앱에 문제가 생겼어요</Text>
        <Text style={{ color: C.sub, fontSize: 13.5, marginTop: 8, lineHeight: 20 }}>
          데이터는 폰과 서버에 그대로 있어요. 아래 버튼으로 고칠 수 있어요.{'\n'}버전: {REV}
        </Text>
        <ScrollView style={{ maxHeight: 200, marginTop: 16, backgroundColor: C.card, borderRadius: 12, padding: 12 }}>
          <Text style={{ color: C.red, fontSize: 11.5, lineHeight: 17 }}>{msg}</Text>
        </ScrollView>
        <TouchableOpacity style={[s.bigBtn, { marginTop: 16 }]} activeOpacity={0.85}
          onPress={async () => {
            try {
              if (Updates.isEnabled) {
                const r = await Updates.checkForUpdateAsync();
                if (r.isAvailable) { await Updates.fetchUpdateAsync(); }
                await Updates.reloadAsync();
                return;
              }
            } catch (e) { /* 아래 재시도로 폴백 */ }
            this.setState({ err: null });
          }}>
          <Text style={s.bigBtnT}>고친 버전 받아서 다시 시작</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.bigBtn, { marginTop: 10, backgroundColor: C.card2 }]} activeOpacity={0.85}
          onPress={() => this.setState({ err: null })}>
          <Text style={[s.bigBtnT, { color: C.text }]}>그냥 다시 시도</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.bigBtn, { marginTop: 10, backgroundColor: C.card2 }]} activeOpacity={0.85}
          onPress={() => Share.share({ message: `[클린페이 오류 ${REV}]\n${msg}` })}>
          <Text style={[s.bigBtnT, { color: C.text }]}>오류 내용 보내기</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }
}

export default function Root() {
  return <ErrorBoundary><RootInner /></ErrorBoundary>;
}

function RootInner() {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [restored, setRestored] = useState(0);
  const [assumeLoggedIn, setAssumeLoggedIn] = useState(false);

  useEffect(() => {
    if (!hasSupabase) { setChecking(false); return; }

    // 프로필/시작일 동기화는 실패해도 앱 진입을 막지 않음 (네트워크 문제로 영원히 로딩에 갇히는 것 방지)
    const afterLogin = async () => {
      try {
        // 재설치/새 폰: 서버에 있는 결제 내역과 설정을 먼저 되찾아온다
        await autoRestoreIfEmpty();
        await pullFromSupabase();
        setRestored(v => v + 1); // 복구 후 화면 새로고침 트리거
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

    // 마지막 안전장치: 무슨 일이 있어도 20초 뒤에는 로딩을 끝낸다.
    // (여기서 갇히면 사용자에겐 그냥 "안 켜지는 앱"으로 보이기 때문)
    const hardStop = setTimeout(() => { if (!cancelled) setChecking(false); }, 20000);

    (async () => {
      // ── 1단계: 인터넷을 전혀 쓰지 않고 화면부터 띄운다 ──
      // 폰에 저장된 로그인 기록만 보고 판단한다. 이건 인터넷과 무관하게 항상 즉시 끝난다.
      // (예전엔 여기서 서버에 물어보느라, 인터넷이 느리면 앱이 안 켜진 것처럼 보였음)
      let stored = false;
      try { stored = await hasStoredSession(); } catch (e) { stored = false; }
      if (cancelled) return;

      if (stored) setAssumeLoggedIn(true);
      setChecking(false); // 화면 표시. 여기서부터는 절대 로딩에 갇히지 않는다.

      // ── 2단계: 진짜 세션 확인은 뒤에서 조용히 (화면을 막지 않음) ──
      try {
        const s = await withTimeout(getSession(), 15000);
        if (!cancelled && s) { setSession(s); afterLogin(); return; }
      } catch (e) { /* 느린 네트워크 — 아래에서 재시도 */ }

      // 로그인 기록은 있는데 세션 확인이 실패했으면 백그라운드에서 계속 재시도
      if (stored) {
        for (let i = 0; i < 5 && !cancelled; i++) {
          await new Promise(r => setTimeout(r, 3000 * (i + 1)));
          try {
            const s2 = await getSession();
            if (s2 && !cancelled) { setSession(s2); afterLogin(); return; }
          } catch (e) { /* 다음 시도 */ }
        }
      }
    })();

    let sub = null;
    try {
      sub = onAuthChange(async (s, event) => {
        try {
          // 사용자가 직접 로그아웃한 경우에만 세션을 비운다.
          // 토큰 갱신 실패 등으로 일시적으로 null이 와도 로그아웃시키지 않음.
          if (!s) {
            if (event === 'SIGNED_OUT') { setSession(null); setAssumeLoggedIn(false); setProfile(null); }
            return;
          }
          setSession(s);
          setAssumeLoggedIn(false);
          await afterLogin();
        } catch (e) { /* 로그인 상태 변화 처리 실패가 앱을 멈추면 안 됨 */ }
      });
    } catch (e) { /* 인증 구독 실패해도 앱은 떠야 함 */ }

    return () => {
      cancelled = true;
      clearTimeout(hardStop);
      try { sub && sub.unsubscribe(); } catch (e) { /* 이미 해제됨 */ }
    };
  }, []);

  if (!hasSupabase) return <MainApp profile={null} onSignOut={null} />;
  if (checking) {
    return (
      <SafeAreaView style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.blue} />
      </SafeAreaView>
    );
  }
  if (!session && !assumeLoggedIn) return <AuthScreen />;
  // restored가 바뀌면 MainApp을 다시 마운트해 복구된 데이터를 즉시 반영
  return <MainApp key={restored} profile={profile} onSignOut={async () => { await signOut(); }} />;
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
  const [editTags, setEditTags] = useState('');
  const [knownTags, setKnownTags] = useState([]);
  const [filterTag, setFilterTag] = useState(null);
  const [lastBackup, setLastBackup] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [dupPairs, setDupPairs] = useState([]);
  const [seenApps, setSeenApps] = useState({});
  const [watchApps, setWatchApps] = useState([]);
  const [appsOpen, setAppsOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [updBusy, setUpdBusy] = useState(false);
  const [balance, setBalance] = useState(null);
  const [cardTargets, setCardTargets] = useState({});
  const [cardTargetOpen, setCardTargetOpen] = useState(false);
  const [cardDraft, setCardDraft] = useState({});
  const [owedFrom, setOwedFrom] = useState('');
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState('expense'); // 'expense' | 'income'
  const [addName, setAddName] = useState('');
  const [addAmt, setAddAmt] = useState('');
  const [addCat, setAddCat] = useState('food');
  const [addDate, setAddDate] = useState(todayISO());
  const [addErr, setAddErr] = useState('');
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
  const [goals, setGoals] = useState([]);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalEditId, setGoalEditId] = useState(null); // null = 새로 추가
  const [goalDraft, setGoalDraft] = useState(null);
  const [goalErr, setGoalErr] = useState('');
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

  // 업데이트를 직접 받아서 바로 적용 (원래는 앱을 두 번 껐다 켜야 반영됨)
  const checkUpdate = useCallback(async () => {
    if (!Updates.isEnabled) {
      Alert.alert('업데이트를 확인할 수 없어요', '개발용으로 실행 중이거나 업데이트가 꺼진 빌드예요.');
      return;
    }
    setUpdBusy(true);
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) {
        Alert.alert('이미 최신 버전이에요', `지금 버전: ${REV}`);
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert('새 버전을 받았어요', '지금 바로 적용할까요?', [
        { text: '나중에', style: 'cancel' },
        { text: '지금 적용', onPress: () => Updates.reloadAsync() },
      ]);
    } catch (e) {
      Alert.alert('업데이트 확인 실패', `${e?.message || e}\n\n인터넷 연결을 확인하고 다시 눌러주세요.`);
    } finally {
      setUpdBusy(false);
    }
  }, []);

  const confirmSignOut = useCallback(() => {
    Alert.alert('로그아웃 할까요?', '', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => { setShareOpen(false); onSignOut && onSignOut(); } },
    ]);
  }, [onSignOut]);

  const load = useCallback(async () => {
    // 폰 안에 있는 것만 먼저 읽어서 화면을 채운다.
    // 인터넷이 필요한 건(응원 메시지 등) 아래에서 따로 가져오므로,
    // 인터넷이 느려도 가계부는 항상 바로 보인다.
    try { await runRecurringGenerator(); } catch (e) { /* 고정지출 자동기록 실패는 무시 */ }
    const [p, b, d, q, qd, ex, rec, gl, tg, bk, bal, ct, st] = await Promise.all([
      getPayments(), getBudgets(), getDiary(), getQuitSettings(), getQuitDates(),
      getExplanations(), getRecurring(), getGoals(),
      getKnownTags(), getLastBackupAt(), getBalance(), getCardTargets(),
      RNAndroidNotificationListener.getPermissionStatus().catch(() => 'unknown'),
    ]);
    setPayments(p); setBudgets(b); setDiary(d); setQuitSet(q); setQuitDates(qd);
    setExplanations(ex); setRecurList(rec); setGoals(gl);
    setKnownTags(tg); setLastBackup(bk); setBalance(bal); setCardTargets(ct); setPerm(st);

    // 응원 메시지는 서버에서 가져오는 것 — 실패하거나 느려도 화면에 영향 없음
    fetchCheers().then(ch => setCheers(ch)).catch(() => {});

    setDupPairs(await findDuplicates()); // 이미 쌓인 중복 감지
    setSeenApps(await getSeenApps()); setWatchApps(await getWatchApps());

    // 홈 화면 위젯도 최신 값으로 갱신 (위젯을 안 올려놨으면 조용히 무시됨)
    try {
      const data = await buildSummary();
      requestWidgetUpdate({
        widgetName: 'Cleanpay',
        renderWidget: () => <CleanpayWidget data={data} />,
      });
    } catch (e) { /* 위젯 갱신 실패는 앱 동작에 영향 없음 */ }
  }, []);

  useEffect(() => {
    load().catch(() => {});
    syncAll().catch(() => {});
    // 폰에만 있는 데이터(일기/예산/목표 등)를 하루 한 번 자동 백업
    // 단, 폰이 비어 있으면(재설치 직후) 절대 올리지 않는다 — 좋은 백업을 덮어쓰는 사고 방지
    (async () => {
      try {
        if (!(await hasLocalData())) return;
        const last = await getLastBackupAt();
        if (!last || Date.now() - new Date(last).getTime() > 86400000) {
          const res = await backupNow();
          if (res.ok) setLastBackup(new Date().toISOString());
        }
      } catch (e) { /* 백업 실패가 앱을 멈추면 안 됨 */ }
    })();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') load().catch(() => {}); });
    const t = setInterval(() => load().catch(() => {}), 20000);
    return () => { sub.remove(); clearInterval(t); };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } catch (e) { /* 새로고침 실패해도 화면은 그대로 */ }
    setRefreshing(false);
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
  // ---- 알림 리스너 자가진단 ----
  // 안드로이드는 권한이 "켜짐"으로 보여도 재설치·최적화 때문에 서비스가 실제로는 죽어 있을 수 있다.
  // 그래서 권한 상태만 믿지 않고 "실제로 알림이 들어오고 있는지"로 판단한다.
  const listenerHealth = useMemo(() => {
    const entries = Object.entries(seenApps);
    const lastTs = entries.reduce((m, [, v]) => {
      const t = new Date(v.lastTs).getTime();
      return t > m ? t : m;
    }, 0);
    const hours = lastTs ? (Date.now() - lastTs) / 3600000 : Infinity;
    const anyCaptured = entries.some(([, v]) => v.captured);
    // 감시 중인 앱에서 알림은 왔는데 결제로 인식된 적이 한 번도 없는 경우
    const watchedSeen = entries.filter(([app]) => BANK_PACKAGES.includes(app) || watchApps.includes(app));

    if (entries.length === 0) {
      return { level: 'dead', lastTs, hours, anyCaptured, watchedSeen,
        title: '알림이 하나도 안 들어오고 있어요',
        sub: '권한은 켜져 있는데 앱이 알림을 못 받는 상태예요.' };
    }
    if (hours > 24) {
      return { level: 'stale', lastTs, hours, anyCaptured, watchedSeen,
        title: `${Math.floor(hours / 24)}일째 알림이 안 들어와요`,
        sub: '알림 감시 기능이 꺼졌을 수 있어요.' };
    }
    if (watchedSeen.length === 0) {
      return { level: 'unwatched', lastTs, hours, anyCaptured, watchedSeen,
        title: '카드·문자 앱이 감시 목록에 없어요',
        sub: '알림은 들어오는데 감시 대상 앱이 아니에요.' };
    }
    if (!anyCaptured) {
      return { level: 'noparse', lastTs, hours, anyCaptured, watchedSeen,
        title: '알림은 들어오는데 결제로 인식이 안 돼요',
        sub: '알림 문구를 알려주시면 인식 규칙을 고칠 수 있어요.' };
    }
    return { level: 'ok', lastTs, hours, anyCaptured, watchedSeen,
      title: '정상 작동 중', sub: '' };
  }, [seenApps, watchApps]);

  // 진단 내용을 그대로 복사해서 보낼 수 있게 (카톡 등으로 붙여넣기)
  const shareDiagnostics = () => {
    const lines = [
      `[클린페이 진단 ${REV}]`,
      `알림 권한: ${perm}`,
      `상태: ${listenerHealth.level} — ${listenerHealth.title}`,
      `마지막 알림: ${listenerHealth.lastTs ? new Date(listenerHealth.lastTs).toLocaleString('ko-KR') : '없음'}`,
      `기록 개수: ${payments.filter(p => !p.deleted).length}건`,
      '',
      '최근 알림 온 앱:',
      ...Object.entries(seenApps)
        .sort((a, b) => new Date(b[1].lastTs) - new Date(a[1].lastTs))
        .slice(0, 10)
        .map(([app, i]) => `- ${app} (${i.count}회, ${i.captured ? '인식됨' : '인식 안됨'})\n  "${i.lastText || ''}"`),
    ];
    Share.share({ message: lines.join('\n') });
  };

  // 지출 (삭제/수입 제외)
  const monthPays = useMemo(() => payments.filter(p => !p.deleted && !p.refunded && !p.isRefund && !isIncome(p) && !isSaving(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthIncome = useMemo(() => payments.filter(p => !p.deleted && isIncome(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthSaving = useMemo(() => payments.filter(p => !p.deleted && isSaving(p) && inMonth(p, viewYM)), [payments, monthOffset]);
  const monthDeleted = useMemo(() => payments.filter(p => p.deleted && inMonth(p, viewYM)), [payments, monthOffset]);
  // 환불된 결제/짝 없는 환불 기록 — 합계에는 안 들어가지만 목록에는 표시해서 확인할 수 있게 함
  const monthRefunded = useMemo(() => payments.filter(p => !p.deleted && (p.refunded || p.isRefund) && inMonth(p, viewYM)), [payments, monthOffset]);
  const total = monthPays.reduce((s, p) => s + p.amount, 0);
  const incomeTotal = monthIncome.reduce((s, p) => s + p.amount, 0);
  const savingTotal = monthSaving.reduce((s, p) => s + p.amount, 0);

  // 지난달 대비: 이번 달=같은 기간(1일~오늘), 과거 달=전체
  const prevPays = useMemo(() => {
    const prevYM = new Date(viewYM.getFullYear(), viewYM.getMonth() - 1, 1);
    const sameWindow = monthOffset === 0;
    return payments.filter(p => {
      if (p.deleted || p.refunded || p.isRefund || isIncome(p) || isSaving(p) || !inMonth(p, prevYM)) return false;
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
    const all = [...monthPays, ...monthIncome, ...monthSaving, ...monthRefunded].sort((a,b) => new Date(b.ts) - new Date(a.ts));
    return all.filter(p => {
      if (filterCats.length > 0 && (isIncome(p) || isSaving(p) || !filterCats.includes(CAT[p.category] ? p.category : 'etc'))) return false;
      if (filterTag && !(p.tags || []).includes(filterTag)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = (p.merchant + (p.memo || '') + (p.tags || []).join(' ')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [monthPays, monthIncome, monthSaving, monthRefunded, search, filterCats, filterTag]);

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
      const sum = payments.filter(p => !p.deleted && !p.refunded && !p.isRefund && !isIncome(p) && !isSaving(p) && inMonth(p, ym)).reduce((s,p) => s+p.amount, 0);
      out.push({ label: `${ym.getMonth()+1}월`, sum, cur: i === 0 });
    }
    return out;
  }, [payments]);
  const trendMax = Math.max(...trend.map(t => t.sum), 1);

  // 통계: 고정지출 감지 (이번 달 + 지난달 같은 가맹점 & 금액 ±20%)
  const recurring = useMemo(() => {
    const prevYM = new Date(viewYM.getFullYear(), viewYM.getMonth() - 1, 1);
    const cur = {}, prv = {};
    payments.filter(p => !p.deleted && !p.refunded && !p.isRefund && !isIncome(p) && !isSaving(p) && inMonth(p, viewYM)).forEach(p => { cur[p.merchant] = (cur[p.merchant]||0) + p.amount; });
    payments.filter(p => !p.deleted && !p.refunded && !p.isRefund && !isIncome(p) && !isSaving(p) && inMonth(p, prevYM)).forEach(p => { prv[p.merchant] = (prv[p.merchant]||0) + p.amount; });
    return Object.entries(cur)
      .filter(([m, v]) => prv[m] && Math.abs(v - prv[m]) / Math.max(v, prv[m]) <= 0.2)
      .sort((a,b) => b[1]-a[1]);
  }, [payments, monthOffset]);

  // 고정지출 월 환산 합계 (매일/N일마다인 것도 한 달 기준으로 환산해서 더함)
  const recurMonthlyTotal = useMemo(() => {
    return recurList.filter(t => t.active && t.type !== 'income').reduce((sum, t) => {
      if (t.cycle === 'monthly') return sum + t.amount;
      if (t.cycle === 'daily') return sum + t.amount * 30;
      return sum + t.amount * (30 / Math.max(1, t.intervalDays || 1));
    }, 0);
  }, [recurList]);

  // 오늘 쓸 수 있는 돈: (남은 예산 ÷ 이번 달 남은 일수)
  const dailyAllowance = useMemo(() => {
    if (!isThisMonth || !budgets.total) return null;
    const spentBeforeToday = monthPays
      .filter(p => new Date(p.ts).getDate() < todayDate)
      .reduce((s, p) => s + p.amount, 0);
    const spentToday = total - spentBeforeToday;
    const daysLeft = daysInViewMonth - todayDate + 1;
    const perDay = Math.floor(Math.max(0, budgets.total - spentBeforeToday) / Math.max(1, daysLeft));
    return { perDay, spentToday, left: perDay - spentToday, daysLeft };
  }, [budgets.total, monthPays, total, isThisMonth, todayDate, daysInViewMonth]);

  // 카드/출처별 지출
  const bySource = useMemo(() => {
    const sums = {};
    monthPays.forEach(p => { const k = srcName(p.app); sums[k] = (sums[k] || 0) + p.amount; });
    return Object.entries(sums).sort((a, b) => b[1] - a[1]);
  }, [monthPays]);

  // 주간 리포트: 이번 주(월~일) vs 지난주, 요일별 지출, 최다 카테고리
  const weekReport = useMemo(() => {
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const { start: wStart } = weekRangeLocal(todayMid);
    const prevStart = addDaysLocal(wStart, -7);
    const sumRange = (from, toExclusive) => payments.filter(p => {
      if (p.deleted || p.refunded || p.isRefund || isIncome(p) || isSaving(p)) return false;
      const d = new Date(p.ts);
      return d >= from && d < toExclusive;
    });
    const thisWeek = sumRange(wStart, addDaysLocal(wStart, 7));
    const lastWeek = sumRange(prevStart, wStart);
    const tSum = thisWeek.reduce((s, p) => s + p.amount, 0);
    const lSum = lastWeek.reduce((s, p) => s + p.amount, 0);
    // 요일별(월~일)
    const byDay = Array.from({ length: 7 }, () => 0);
    thisWeek.forEach(p => {
      const d = new Date(p.ts);
      const idx = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - wStart) / 86400000);
      if (idx >= 0 && idx < 7) byDay[idx] += p.amount;
    });
    // 카테고리 1위
    const cats = {};
    thisWeek.forEach(p => { const k = CAT[p.category] ? p.category : 'etc'; cats[k] = (cats[k] || 0) + p.amount; });
    const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0] || null;
    const noSpendDays = byDay.filter((v, i) => v === 0 && addDaysLocal(wStart, i) <= todayMid).length;
    return {
      start: wStart, tSum, lSum, byDay, topCat, noSpendDays,
      count: thisWeek.length,
      max: Math.max(...byDay, 1),
      diff: lSum > 0 ? tSum - lSum : null,
    };
  }, [payments]);

  // 받을 돈 (엔빵 정산) — 달과 무관하게 아직 못 받은 것 전체
  const owedList = useMemo(() => payments
    .filter(p => !p.deleted && p.owedAmount > 0 && !p.owedSettled)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts)), [payments]);
  const owedTotal = owedList.reduce((s, p) => s + p.owedAmount, 0);

  // 연간 리포트: 올해 월별 지출 + 카테고리 합계 + 작년 대비
  const yearReport = useMemo(() => {
    const y = viewYM.getFullYear();
    const inYear = (p, yy) => !p.deleted && !p.refunded && !p.isRefund && !isIncome(p) && !isSaving(p)
      && new Date(p.ts).getFullYear() === yy;
    const months = Array.from({ length: 12 }, () => 0);
    const cats = {};
    let yTotal = 0;
    payments.filter(p => inYear(p, y)).forEach(p => {
      const d = new Date(p.ts);
      months[d.getMonth()] += p.amount;
      const k = CAT[p.category] ? p.category : 'etc';
      cats[k] = (cats[k] || 0) + p.amount;
      yTotal += p.amount;
    });
    const prevTotal = payments.filter(p => inYear(p, y - 1)).reduce((s, p) => s + p.amount, 0);
    const activeMonths = months.filter(v => v > 0).length;
    return {
      year: y, months, yTotal, prevTotal, activeMonths,
      avg: activeMonths ? Math.round(yTotal / activeMonths) : 0,
      cats: Object.entries(cats).sort((a, b) => b[1] - a[1]),
      max: Math.max(...months, 1),
    };
  }, [payments, monthOffset]);

  // 소비 습관: 이번 달 3회 이상 반복된 가맹점 (횟수·합계)
  const habits = useMemo(() => {
    const groups = {};
    monthPays.forEach(p => {
      const k = p.merchant;
      if (!groups[k]) groups[k] = { merchant: k, count: 0, sum: 0, cat: CAT[p.category] ? p.category : 'etc' };
      groups[k].count++; groups[k].sum += p.amount;
    });
    return Object.values(groups).filter(g => g.count >= 3).sort((a, b) => b.sum - a.sum).slice(0, 6);
  }, [monthPays]);

  // 이번 달 사용된 태그별 합계
  const tagTotals = useMemo(() => {
    const sums = {};
    monthPays.forEach(p => (p.tags || []).forEach(t => { sums[t] = (sums[t] || 0) + p.amount; }));
    return Object.entries(sums).sort((a, b) => b[1] - a[1]);
  }, [monthPays]);

  // 목표별 진행 현황 (전체 payments 기준 — 주간/월간은 오늘 기준으로 계산되는 기간)
  const goalStatus = useMemo(() => {
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return goals.map(g => {
      const { start, end } = goalRange(g, todayMid);
      const spent = payments.filter(p => {
        if (p.deleted || p.refunded || p.isRefund || isIncome(p) || isSaving(p)) return false;
        const d = new Date(p.ts);
        return d >= start && d < addDaysLocal(end, 1);
      }).reduce((s, p) => s + p.amount, 0);
      return { goal: g, start, end, spent, pct: g.amount > 0 ? Math.round(spent / g.amount * 100) : 0 };
    });
  }, [goals, payments]);

  // ── 고정지출 ──
  const openRecurAdd = useCallback(() => {
    setRecurEditId(null); setRecurErr('');
    setRecurDraft({
      merchant: '', amount: '', category: 'sub', memo: '', type: 'expense',
      cycle: 'monthly', dayOfMonth: String(new Date().getDate()), intervalDays: '7',
      startDate: todayISO(), fromPaymentId: null,
    });
    setRecurOpen(true);
  }, []);

  const openRecurFromPayment = useCallback((p) => {
    const d = new Date(p.ts);
    setRecurEditId(null); setRecurErr('');
    setRecurDraft({
      merchant: p.merchant, amount: fmtInput(p.amount), category: CAT[p.category] ? p.category : 'etc', memo: '', type: 'expense',
      cycle: 'monthly', dayOfMonth: String(d.getDate()), intervalDays: '7',
      startDate: dkey(d), fromPaymentId: p.id,
    });
    setPickTarget(null);
    setRecurOpen(true);
  }, []);

  const openRecurEdit = useCallback((tpl) => {
    setRecurEditId(tpl.id); setRecurErr('');
    setRecurDraft({
      merchant: tpl.merchant, amount: fmtInput(tpl.amount), category: tpl.category, memo: tpl.memo || '', type: tpl.type || 'expense',
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
      ...(d.type === 'income' ? { type: 'income' } : { type: 'expense' }),
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

  // ── 지출 목표 (주간/월간/기간 설정) ──
  const openGoalAdd = useCallback(() => {
    setGoalEditId(null); setGoalErr('');
    setGoalDraft({ label: '', kind: 'weekly', amount: '', startDate: todayISO(), endDate: todayISO() });
    setGoalOpen(true);
  }, []);

  const openGoalEdit = useCallback((g) => {
    setGoalEditId(g.id); setGoalErr('');
    setGoalDraft({
      label: g.label || '', kind: g.kind, amount: fmtInput(g.amount),
      startDate: g.startDate || todayISO(), endDate: g.endDate || todayISO(),
    });
    setGoalOpen(true);
  }, []);

  const saveGoalDraft = useCallback(async () => {
    const d = goalDraft;
    const amount = parseInt(String(d.amount).replace(/[^\d]/g, ''), 10);
    if (!amount) { setGoalErr('금액을 입력해주세요.'); return; }
    if (d.kind === 'custom') {
      const ok = /^\d{4}-\d{2}-\d{2}$/;
      if (!ok.test(d.startDate) || !ok.test(d.endDate) || isNaN(new Date(d.startDate)) || isNaN(new Date(d.endDate))) {
        setGoalErr('날짜 형식을 확인해주세요 (YYYY-MM-DD)'); return;
      }
      if (new Date(d.endDate) < new Date(d.startDate)) { setGoalErr('종료일이 시작일보다 빠를 수 없어요.'); return; }
    }
    const goal = {
      label: d.label.trim(), kind: d.kind, amount,
      ...(d.kind === 'custom' ? { startDate: d.startDate, endDate: d.endDate } : {}),
    };
    const next = goalEditId ? await updateGoal(goalEditId, goal) : await addGoal(goal);
    setGoals([...next]); setGoalOpen(false);
  }, [goalDraft, goalEditId]);

  const confirmGoalDelete = useCallback(() => {
    Alert.alert('지출 목표를 삭제할까요?', '', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { setGoals([...await deleteGoal(goalEditId)]); setGoalOpen(false); } },
    ]);
  }, [goalEditId]);

  // ── 액션 ──
  const openEdit = useCallback((p) => {
    setEditCat(CAT[p.category] ? p.category : 'etc');
    setEditMemo(p.memo || '');
    setEditTags((p.tags || []).map(t => '#' + t).join(' '));
    setSplitOpen(false);
    setSplitPeople(p.splitCount ? String(p.splitCount) : '');
    setSplitAmount(fmtInput(p.amount));
    setOwedFrom(p.owedFrom || '');
    setPickTarget(p);
  }, []);

  const saveEdit = useCallback(async () => {
    const target = pickTarget;
    const catChanged = !isIncome(target) && !isSaving(target) && target.category !== editCat;
    await updateItem(target.id, {
      category: (isIncome(target) || isSaving(target)) ? undefined : editCat, memo: editMemo.trim(),
    });
    const next = await setPaymentTags(target.id, parseTags(editTags));
    setPayments([...next]); setKnownTags(await getKnownTags()); setPickTarget(null);

    // 같은 가맹점의 과거 기록도 함께 바꿀지 물어보기
    if (catChanged) {
      const others = await countOtherCategory(target.merchant, editCat);
      if (others > 0) {
        Alert.alert('과거 기록도 바꿀까요?',
          `"${target.merchant}" 기록 ${others}건이 다른 카테고리예요.\n전부 "${CAT[editCat].label}"(으)로 바꿀까요?`, [
          { text: '아니요', style: 'cancel' },
          { text: `${others}건 모두 변경`, onPress: async () => {
            const res = await recategorizeMerchant(target.merchant, editCat);
            setPayments([...res.list]);
          } },
        ]);
      }
    }
  }, [pickTarget, editCat, editMemo, editTags]);

  const cleanDuplicates = useCallback(() => {
    const preview = dupPairs.slice(0, 4)
      .map(p => `· ${p.remove.merchant} ${won(p.remove.amount)}원`).join('\n');
    Alert.alert('중복 결제 정리',
      `같은 결제가 두 번 기록된 것 ${dupPairs.length}건을 찾았어요.\n\n${preview}` +
      `${dupPairs.length > 4 ? `\n외 ${dupPairs.length - 4}건` : ''}\n\n삭제된 항목으로 옮길까요? (복원 가능)`, [
      { text: '취소', style: 'cancel' },
      { text: `${dupPairs.length}건 정리`, onPress: async () => {
        const res = await removeDuplicates(dupPairs);
        setPayments([...res.list]); setDupPairs(await findDuplicates());
        Alert.alert('정리 완료', `${res.count}건을 삭제된 항목으로 옮겼어요.`);
      } },
    ]);
  }, [dupPairs]);

  // ── 백업 / 복구 ──
  const doBackup = useCallback(async () => {
    setBackupBusy(true);
    const res = await backupNow(true); // 직접 누른 백업은 항상 실행
    setBackupBusy(false);
    if (res.ok) { setLastBackup(new Date().toISOString()); Alert.alert('백업 완료', '일기·예산·목표·고정지출이 안전하게 저장됐어요.'); }
    else Alert.alert('백업 실패', res.reason === 'no-user' ? '로그인이 필요해요.' : '잠시 후 다시 시도해주세요.');
  }, []);

  const doRestore = useCallback(async () => {
    setBackupBusy(true);
    const info = await fetchBackupInfo();
    const pulled = await pullFromSupabase(); // 결제 내역도 함께 되찾기
    setBackupBusy(false);
    if (!info) {
      if (pulled > 0) { await load(); Alert.alert('복구 완료', `결제 내역 ${pulled}건을 되찾았어요.`); }
      else Alert.alert('복구할 백업이 없어요', '먼저 백업을 한 번 해주세요.');
      return;
    }
    const usesPrev = info.prevKeys > info.keys;
    const at = usesPrev ? info.prevUpdatedAt : info.updatedAt;
    Alert.alert('백업에서 복구할까요?',
      `${at ? new Date(at).toLocaleString('ko-KR') : ''} 백업으로 되돌립니다.` +
      (usesPrev ? '\n(더 온전한 이전 백업을 사용해요)' : '') +
      `${pulled > 0 ? `\n결제 내역 ${pulled}건은 이미 되찾았어요.` : ''}`, [
      { text: '취소', style: 'cancel' },
      { text: '복구', onPress: async () => {
        setBackupBusy(true);
        const res = await restoreFromBackup();
        setBackupBusy(false);
        await load();
        if (res.ok) Alert.alert('복구 완료', '백업 시점의 데이터로 되돌렸어요.');
        else Alert.alert('복구 실패', '백업을 불러오지 못했어요.');
      } },
    ]);
  }, [load]);

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
    await applySplit(pickTarget.id, amt, splitPeople ? Number(splitPeople) : null);
    // 내가 전액 결제하고 일부만 내 몫이면, 나머지는 '받을 돈'으로 기록
    const owed = Math.max(0, splitBase - amt);
    const next = await setOwed(pickTarget.id, { owedAmount: owed, owedFrom: owedFrom.trim() });
    setPayments([...next]); setPickTarget(null); setSplitOpen(false); setOwedFrom('');
  }, [pickTarget, splitAmount, splitPeople, splitBase, owedFrom]);

  const settleOwed = useCallback(async (p) => {
    Alert.alert('정산 완료로 표시할까요?', `${p.merchant} · ${won(p.owedAmount)}원${p.owedFrom ? ` (${p.owedFrom})` : ''}`, [
      { text: '취소', style: 'cancel' },
      { text: '받았어요', onPress: async () => setPayments([...await toggleOwedSettled(p.id)]) },
    ]);
  }, []);

  const resetSplit = useCallback(async () => {
    const next = await clearSplit(pickTarget.id);
    setPayments([...next]); setPickTarget(null); setSplitOpen(false);
  }, [pickTarget]);

  const addManual = useCallback(async () => {
    const amount = parseInt(addAmt.replace(/[^\d]/g, ''), 10);
    if (!addName.trim() || !amount) { setAddErr('이름과 금액을 입력해주세요.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(addDate) || isNaN(new Date(addDate))) { setAddErr('날짜 형식을 확인해주세요 (YYYY-MM-DD)'); return; }
    const [y, m, d] = addDate.split('-').map(Number);
    const now2 = new Date();
    const ts = new Date(y, m - 1, d, now2.getHours(), now2.getMinutes(), now2.getSeconds()).toISOString();
    const next = await savePayment({
      id: `m_${Date.now()}`, ts,
      merchant: addName.trim(), amount, app: 'manual',
      ...(addType === 'income' ? { type: 'income', category: 'etc' }
        : addType === 'saving' ? { type: 'saving', category: 'etc' }
        : { category: addCat }),
    });
    setPayments([...next]); setAdding(false); setAddName(''); setAddAmt(''); setAddDate(todayISO()); setAddErr('');
  }, [addName, addAmt, addCat, addType, addDate]);

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
      if (p.deleted || p.refunded || p.isRefund || isIncome(p) || isSaving(p)) return;
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
        if (p.deleted || p.refunded || p.isRefund || isIncome(p) || isSaving(p)) return;
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
    const refunded = !!(p.refunded || p.isRefund);
    const cat = inc ? { label: '수입', color: C.green } : sav ? { label: '저축', color: C.gold } : (CAT[p.category] || CAT.etc);
    return (
      <TouchableOpacity key={p.id} style={[s.item, refunded && { opacity: 0.55 }]} activeOpacity={0.6}
        onPress={() => { if (fromDaySheet) setSelDay(null); openEdit(p); }}
        onLongPress={() => { if (fromDaySheet) setSelDay(null); confirmDelete(p); }} delayLongPress={450}>
        <View style={[s.dot, { backgroundColor: cat.color + '26' }]}>
          <View style={[s.dotCore, { backgroundColor: cat.color }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.itemName, refunded && s.itemNameRefunded]} numberOfLines={1}>
            {p.recurringId ? '📌 ' : ''}{p.merchant}
          </Text>
          <Text style={s.itemSub}>{hhmm(p.ts)} · {srcName(p.app)} · {refunded ? (p.isRefund ? '환불 내역' : '환불됨') : cat.label}</Text>
          {p.originalAmount != null && (
            <Text style={s.itemSplitHint}>원래 {won(p.originalAmount)}원{p.splitCount ? ` · ${p.splitCount}명이서 나눔` : ''}</Text>
          )}
          {!!(p.tags && p.tags.length) && (
            <Text style={s.itemTags} numberOfLines={1}>{p.tags.map(t => '#' + t).join(' ')}</Text>
          )}
          {!!p.memo && <Text style={s.itemMemo} numberOfLines={2}>{p.memo}</Text>}
        </View>
        <Text style={[s.itemAmt, (inc || sav) && { color: inc ? C.green : C.gold }, refunded && s.itemAmtRefunded]}>
          {(inc || sav) ? '+' : ''}{won(p.amount)}원
        </Text>
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

        {/* 알림이 안 잡힐 때 스스로 원인을 찾을 수 있는 진단 카드 */}
        {perm === 'authorized' && listenerHealth.level !== 'ok' && (
          <TouchableOpacity style={s.permBanner} activeOpacity={0.85} onPress={() => setDiagOpen(true)}>
            <Text style={s.permTitle}>🩺 {listenerHealth.title}</Text>
            <Text style={s.permSub}>{listenerHealth.sub}{'\n'}탭하면 원인과 해결 방법을 보여줘요</Text>
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
              <TouchableOpacity key={g.key} style={s.dday} activeOpacity={0.7}
                onPress={() => setScreen('save')}
                onLongPress={openDateEdit} delayLongPress={450}>
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
          {balance && isThisMonth && (
            <Text style={s.balanceLine}>
              통장 잔액 <Text style={{ color: C.text, fontWeight: '800' }}>{won(balance.amount)}원</Text>
              <Text style={{ color: C.faint }}>  ({new Date(balance.ts).getMonth()+1}/{new Date(balance.ts).getDate()} 기준)</Text>
            </Text>
          )}
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

          {/* 오늘 쓸 수 있는 돈 */}
          {dailyAllowance && (
            <View style={s.todayBox}>
              <Text style={s.todayLabel}>오늘 쓸 수 있는 돈</Text>
              <Text style={[s.todayAmt, { color: dailyAllowance.left < 0 ? C.red : C.blueText }]}>
                {won(Math.max(0, dailyAllowance.left))}원
              </Text>
              <Text style={s.todaySub}>
                하루 {won(dailyAllowance.perDay)}원 기준 · 오늘 {won(dailyAllowance.spentToday)}원 씀
                {dailyAllowance.left < 0 ? ` · ${won(-dailyAllowance.left)}원 초과` : ''} · {dailyAllowance.daysLeft}일 남음
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

        {/* 중복 결제 알림 */}
        {dupPairs.length > 0 && (
          <TouchableOpacity style={[s.insightCard, { borderLeftColor: C.gold }]} activeOpacity={0.8} onPress={cleanDuplicates}>
            <Text style={s.insightT}>
              🔁 같은 결제가 두 번 기록된 것 {dupPairs.length}건이 있어요 · 탭해서 정리
            </Text>
          </TouchableOpacity>
        )}

        {/* 받을 돈 (엔빵 정산) */}
        {owedList.length > 0 && (
          <View style={s.dayCard}>
            <View style={s.dayHead}>
              <Text style={s.dayHeadT}>💸 받을 돈 {owedList.length}건</Text>
              <Text style={[s.dayHeadT, { color: C.gold, fontWeight: '800' }]}>{won(owedTotal)}원</Text>
            </View>
            {owedList.slice(0, 5).map(p => (
              <TouchableOpacity key={p.id} style={s.item} activeOpacity={0.6} onPress={() => settleOwed(p)}>
                <View style={[s.dot, { backgroundColor: C.gold + '26' }]}>
                  <View style={[s.dotCore, { backgroundColor: C.gold }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.itemName} numberOfLines={1}>{p.owedFrom || p.merchant}</Text>
                  <Text style={s.itemSub}>
                    {new Date(p.ts).getMonth()+1}/{new Date(p.ts).getDate()} · {p.merchant}
                    {p.splitCount ? ` · ${p.splitCount}명` : ''} · 탭하면 정산 완료
                  </Text>
                </View>
                <Text style={[s.itemAmt, { color: C.gold }]}>{won(p.owedAmount)}원</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 지출 목표 (주간/월간/기간 설정) */}
        <View style={s.dayCard}>
          <View style={s.dayHead}>
            <Text style={s.dayHeadT}>🎯 지출 목표 {goals.length > 0 ? `${goals.length}건` : ''}</Text>
            <TouchableOpacity onPress={openGoalAdd} hitSlop={8}>
              <Text style={s.budgetLink}>+ 추가</Text>
            </TouchableOpacity>
          </View>
          {goals.length === 0 && (
            <Text style={[s.statEmpty, { paddingBottom: 10 }]}>"이번 주 10만원까지" "여행 기간 30만원" 처럼{'\n'}기간과 금액을 정해두면 현황을 보여줘요.</Text>
          )}
          {goalStatus.map(({ goal: g, end, spent, pct }) => {
            const over = pct >= 100;
            const color = over ? C.red : pct >= 80 ? C.gold : C.blueText;
            return (
              <TouchableOpacity key={g.id} style={{ paddingVertical: 10 }} activeOpacity={0.7} onPress={() => openGoalEdit(g)}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={s.itemName} numberOfLines={1}>
                    {g.label ? g.label : goalKindLabel(g.kind)} · {goalPeriodLabel(g, new Date(now.getFullYear(), now.getMonth(), now.getDate()))}
                  </Text>
                  <Text style={[s.itemAmt, { color }]}>{won(spent)} / {won(g.amount)}원</Text>
                </View>
                <View style={s.budBarBg}>
                  <View style={[s.budBarFill, { width: `${Math.min(100, pct)}%`, backgroundColor: color }]} />
                </View>
                <Text style={s.budText}>
                  {pct}% 사용 · {over ? `${won(spent - g.amount)}원 초과` : `${won(g.amount - spent)}원 남음`} · {daysLeftLabel(end, new Date(now.getFullYear(), now.getMonth(), now.getDate()))}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

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
            const isInc = tpl.type === 'income';
            const cat = isInc ? { label: '수입', color: C.green } : (CAT[tpl.category] || CAT.etc);
            return (
              <TouchableOpacity key={tpl.id} style={s.item} activeOpacity={0.6} onPress={() => openRecurEdit(tpl)}>
                <View style={[s.dot, { backgroundColor: cat.color + '26' }]}>
                  <View style={[s.dotCore, { backgroundColor: cat.color }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.itemName} numberOfLines={1}>{tpl.merchant}</Text>
                  <Text style={s.itemSub}>{cycleLabel(tpl)} · {nextDueLabel(tpl)}{!tpl.active ? ' · 일시정지' : ''}</Text>
                </View>
                <Text style={[s.itemAmt, isInc && { color: C.green }]}>{isInc ? '+' : ''}{won(tpl.amount)}원</Text>
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

            {/* 태그 필터 */}
            {tagTotals.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} keyboardShouldPersistTaps="handled">
                {tagTotals.map(([t, v]) => (
                  <TouchableOpacity key={t} style={[s.filterChip, filterTag === t && s.filterChipOn]}
                    onPress={() => setFilterTag(filterTag === t ? null : t)}>
                    <Text style={[s.filterChipT, filterTag === t && { color: C.text }]}>#{t} {won(v)}원</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {groups.map(g => {
              const gk = dkey(new Date(g.items[0].ts));
              return (
                <View key={g.label} style={s.dayCard}>
                  <View style={s.dayHead}>
                    <Text style={s.dayHeadT}>{g.label}</Text>
                    <Text style={s.dayHeadT}>{won(g.items.filter(x => !isIncome(x) && !isSaving(x) && !x.refunded && !x.isRefund).reduce((s2,x)=>s2+x.amount,0))}원</Text>
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
            {/* 주간 리포트 */}
            <View style={s.statCard}>
              <Text style={s.statTitle}>
                이번 주 리포트 📊 ({weekReport.start.getMonth()+1}/{weekReport.start.getDate()}~{addDaysLocal(weekReport.start,6).getMonth()+1}/{addDaysLocal(weekReport.start,6).getDate()})
              </Text>
              <Text style={[s.total, { fontSize: 28 }]}>{won(weekReport.tSum)}원</Text>
              {weekReport.diff !== null ? (
                <View style={s.deltaPill}>
                  <Text style={[s.deltaT, { color: weekReport.diff <= 0 ? C.blueText : C.red }]}>
                    지난주보다 {won(Math.abs(weekReport.diff))}원 {weekReport.diff <= 0 ? '덜 썼어요' : '더 썼어요'}
                  </Text>
                </View>
              ) : (
                <Text style={s.projLine}>지난주 기록이 쌓이면 비교해서 보여드려요</Text>
              )}
              <View style={[s.trendRow, { marginTop: 16, height: 110 }]}>
                {weekReport.byDay.map((v, i) => {
                  const d = addDaysLocal(weekReport.start, i);
                  const isToday = d.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                  return (
                    <View key={i} style={s.trendCol}>
                      <Text style={s.trendAmt}>{v ? fmtShort(v) : ''}</Text>
                      <View style={[s.trendBar, {
                        width: 20,
                        height: Math.max(3, v / weekReport.max * 68),
                        backgroundColor: isToday ? C.blue : v ? C.card2 : '#1E1E24',
                      }]} />
                      <Text style={[s.trendLabel, isToday && { color: C.text, fontWeight: '700' }]}>
                        {['월','화','수','목','금','토','일'][i]}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <View style={{ marginTop: 12, gap: 7 }}>
                <View style={s.recurRow}>
                  <Text style={s.recurName}>결제 건수</Text>
                  <Text style={s.recurAmt}>{weekReport.count}건</Text>
                </View>
                {weekReport.topCat && (
                  <View style={s.recurRow}>
                    <Text style={s.recurName}>가장 많이 쓴 곳</Text>
                    <Text style={[s.recurAmt, { color: CAT[weekReport.topCat[0]].color }]}>
                      {CAT[weekReport.topCat[0]].label} {won(weekReport.topCat[1])}원
                    </Text>
                  </View>
                )}
                <View style={s.recurRow}>
                  <Text style={s.recurName}>무지출</Text>
                  <Text style={[s.recurAmt, { color: weekReport.noSpendDays > 0 ? C.green : C.sub }]}>
                    {weekReport.noSpendDays}일
                  </Text>
                </View>
              </View>
            </View>

            {/* 소비 습관 */}
            {habits.length > 0 && (
              <View style={s.statCard}>
                <Text style={s.statTitle}>{viewYM.getMonth()+1}월 자주 간 곳 ☕</Text>
                {habits.map(h => (
                  <View key={h.merchant} style={s.recurRow}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={s.recurName} numberOfLines={1}>{h.merchant}</Text>
                      <Text style={s.itemSub}>{h.count}번 · 평균 {won(Math.round(h.sum / h.count))}원</Text>
                    </View>
                    <Text style={[s.recurAmt, { color: CAT[h.cat].color }]}>{won(h.sum)}원</Text>
                  </View>
                ))}
                <Text style={s.statEmpty}>이번 달 3번 이상 결제한 곳이에요</Text>
              </View>
            )}

            {/* 카드·출처별 지출 + 실적 목표 */}
            {bySource.length > 0 && (
              <View style={s.statCard}>
                <View style={s.totalRow}>
                  <Text style={s.statTitle}>{viewYM.getMonth()+1}월 결제수단별</Text>
                  <TouchableOpacity onPress={() => {
                    setCardDraft(Object.fromEntries(bySource.map(([k]) => [k, cardTargets[k] ? fmtInput(cardTargets[k]) : ''])));
                    setCardTargetOpen(true);
                  }} hitSlop={8}>
                    <Text style={s.budgetLink}>실적 목표 ›</Text>
                  </TouchableOpacity>
                </View>
                {bySource.map(([k, v]) => {
                  const target = cardTargets[k];
                  const pct = target ? Math.round(v / target * 100) : null;
                  const done = pct != null && pct >= 100;
                  return (
                    <View key={k} style={{ paddingVertical: 7 }}>
                      <View style={s.recurRow}>
                        <Text style={s.recurName}>{k}</Text>
                        <Text style={s.recurAmt}>{won(v)}원 <Text style={{ color: C.faint, fontWeight: '600', fontSize: 12 }}>
                          {total > 0 ? Math.round(v / total * 100) : 0}%</Text></Text>
                      </View>
                      {target > 0 && (
                        <>
                          <View style={[s.budBarBg, { marginTop: 6 }]}>
                            <View style={[s.budBarFill, { width: `${Math.min(100, pct)}%`, backgroundColor: done ? C.green : C.blueText }]} />
                          </View>
                          <Text style={s.budText}>
                            실적 {won(target)}원 중 {pct}% ·{' '}
                            <Text style={{ color: done ? C.green : C.blueText, fontWeight: '700' }}>
                              {done ? '달성! 🎉' : `${won(target - v)}원 남음`}
                            </Text>
                          </Text>
                        </>
                      )}
                    </View>
                  );
                })}
                <Text style={s.statEmpty}>카드 혜택 조건(전월 실적)을 넣어두면 진행률을 보여줘요</Text>
              </View>
            )}

            {/* 연간 리포트 */}
            <View style={s.statCard}>
              <Text style={s.statTitle}>{yearReport.year}년 리포트 📅</Text>
              <Text style={[s.total, { fontSize: 28 }]}>{won(yearReport.yTotal)}원</Text>
              <Text style={s.projLine}>
                월 평균 {won(yearReport.avg)}원
                {yearReport.prevTotal > 0 && (
                  yearReport.yTotal >= yearReport.prevTotal
                    ? ` · 작년보다 ${won(yearReport.yTotal - yearReport.prevTotal)}원 더 씀`
                    : ` · 작년보다 ${won(yearReport.prevTotal - yearReport.yTotal)}원 아낌`
                )}
              </Text>
              <View style={[s.trendRow, { marginTop: 14, height: 110 }]}>
                {yearReport.months.map((v, i) => (
                  <View key={i} style={s.trendCol}>
                    <View style={[s.trendBar, {
                      width: 14,
                      height: Math.max(3, v / yearReport.max * 76),
                      backgroundColor: i === now.getMonth() && yearReport.year === now.getFullYear() ? C.blue : C.card2,
                    }]} />
                    <Text style={[s.trendLabel, { fontSize: 9.5 }]}>{i + 1}</Text>
                  </View>
                ))}
              </View>
              {yearReport.cats.length > 0 && (
                <View style={{ marginTop: 14, gap: 8 }}>
                  {yearReport.cats.slice(0, 5).map(([k, v]) => (
                    <View key={k} style={s.recurRow}>
                      <Text style={s.recurName}>{CAT[k].label}</Text>
                      <Text style={[s.recurAmt, { color: CAT[k].color }]}>{won(v)}원</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

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
        <TouchableOpacity style={s.dateEditBtn} activeOpacity={0.8} onPress={openDateEdit}>
          <Text style={s.dateEditBtnT}>📅 금주 · 금연 시작일 설정</Text>
        </TouchableOpacity>

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
        <TouchableOpacity style={s.fab} activeOpacity={0.8} onPress={() => { setAddType('expense'); setAddCat('food'); setAddDate(todayISO()); setAddErr(''); setAdding(true); }}>
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
            <TextInput style={s.input} placeholder="태그 (예: #제주도여행 #회사경비)" placeholderTextColor={C.faint}
              autoCapitalize="none" value={editTags} onChangeText={setEditTags} />
            {knownTags.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, flexGrow: 0 }} keyboardShouldPersistTaps="handled">
                {knownTags.slice(0, 12).map(t => (
                  <TouchableOpacity key={t} style={s.tagSuggest}
                    onPress={() => setEditTags(prev => parseTags(prev).includes(t) ? prev : (prev.trim() + ' #' + t).trim())}>
                    <Text style={s.tagSuggestT}>#{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
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
                    {(() => {
                      const myAmt = parseInt(String(splitAmount).replace(/[^\d]/g, ''), 10) || 0;
                      const owed = Math.max(0, splitBase - myAmt);
                      return owed > 0 ? (
                        <>
                          <Text style={s.budLabel}>받을 돈 {won(owed)}원 · 누구한테?</Text>
                          <TextInput style={s.input} placeholder="예: 민수, 지현 (선택)" placeholderTextColor={C.faint}
                            value={owedFrom} onChangeText={setOwedFrom} />
                        </>
                      ) : null;
                    })()}
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
            <Text style={s.budLabel}>날짜</Text>
            <TextInput style={s.input} placeholder="2026-07-15" placeholderTextColor={C.faint}
              value={addDate} onChangeText={setAddDate} />
            {!!addErr && <Text style={s.authErr}>{addErr}</Text>}
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
            <View style={[s.backupBox, { marginTop: 16 }]}>
              <Text style={s.backupTitle}>⬇️ 앱 업데이트</Text>
              <Text style={s.backupSub}>
                지금 버전: {REV}{'\n'}
                새 기능이 안 보이면 여기를 눌러서 바로 받아오세요.
              </Text>
              <TouchableOpacity style={[s.bigBtn, { marginTop: 12 }]} activeOpacity={0.85}
                onPress={checkUpdate} disabled={updBusy}>
                {updBusy ? <ActivityIndicator color="#fff" />
                  : <Text style={s.bigBtnT}>업데이트 확인하고 바로 적용</Text>}
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[s.backupBox, { marginTop: 12 }]} activeOpacity={0.8}
              onPress={() => { setShareOpen(false); setDiagOpen(true); }}>
              <Text style={s.backupTitle}>🩺 알림 자가진단</Text>
              <Text style={s.backupSub}>
                결제가 안 잡힐 때 여기서 원인을 바로 확인할 수 있어요.{'\n'}
                지금 상태: {perm !== 'authorized' ? '권한 꺼짐 ✗'
                  : listenerHealth.level === 'ok' ? '정상 ✓' : listenerHealth.title}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.backupBox, { marginTop: 12 }]} activeOpacity={0.8}
              onPress={() => { setShareOpen(false); setAppsOpen(true); }}>
              <Text style={s.backupTitle}>📲 감시할 앱 설정</Text>
              <Text style={s.backupSub}>
                카드 알림이 안 잡히면 여기서 그 앱을 켜주세요.{'\n'}
                감시 중 {BANK_PACKAGES.length + watchApps.length}개 · 최근 알림 온 앱 {Object.keys(seenApps).length}개
              </Text>
            </TouchableOpacity>

            <View style={s.backupBox}>
              <Text style={s.backupTitle}>백업 · 복구</Text>
              <Text style={s.backupSub}>
                일기·예산·목표·고정지출은 폰에만 저장돼요. 백업해두면 폰을 바꿔도 복구할 수 있어요.{'\n'}
                {lastBackup ? `마지막 백업: ${new Date(lastBackup).toLocaleString('ko-KR')}` : '아직 백업한 적 없어요'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[s.bigBtn, { flex: 1, marginTop: 0 }]} activeOpacity={0.85}
                  onPress={doBackup} disabled={backupBusy}>
                  {backupBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.bigBtnT}>지금 백업</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.bigBtn, { flex: 1, marginTop: 0, backgroundColor: C.card2 }]} activeOpacity={0.85}
                  onPress={doRestore} disabled={backupBusy}>
                  <Text style={[s.bigBtnT, { color: C.text }]}>복구하기</Text>
                </TouchableOpacity>
              </View>
            </View>

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

      {/* 금주·금연 시작일 설정 모달 */}
      <Modal visible={dateEdit} transparent animationType="slide" onRequestClose={() => setDateEdit(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setDateEdit(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>금주 · 금연 시작일</Text>
            <Text style={s.modalSub}>언제부터 시작했는지 정하면 D-day와 아낀 돈이 다시 계산돼요.</Text>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {[['sober', '금주', C.green], ['smoke', '금연', C.blueText]].map(([key, label, color]) => (
                <View key={key} style={{ marginBottom: 18 }}>
                  <View style={s.totalRow}>
                    <Text style={[s.budLabel, { marginTop: 0 }]}>{label} 시작일</Text>
                    <Text style={{ color, fontWeight: '800', fontSize: 13 }}>
                      {/^\d{4}-\d{2}-\d{2}$/.test(dateDraft[key]) ? `${daysSince(dateDraft[key])}일째` : ''}
                    </Text>
                  </View>
                  <TextInput style={s.input} placeholder="2026-07-13" placeholderTextColor={C.faint}
                    value={dateDraft[key]} onChangeText={v => setDateDraft(d => ({ ...d, [key]: v }))} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
                    {[['오늘', 0], ['어제', 1], ['3일 전', 3], ['1주 전', 7], ['1달 전', 30]].map(([lbl, back]) => (
                      <TouchableOpacity key={lbl} style={s.quickDate}
                        onPress={() => setDateDraft(d => ({ ...d, [key]: dkey(addDaysLocal(new Date(), -back)) }))}>
                        <Text style={s.quickDateT}>{lbl}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={s.quickDate}
                      onPress={() => setDateDraft(d => ({
                        ...d, [key]: /^\d{4}-\d{2}-\d{2}$/.test(d[key]) ? dkey(addDaysLocal(toDateOnlyLocal(d[key]), -1)) : d[key],
                      }))}>
                      <Text style={s.quickDateT}>◀ 하루</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.quickDate}
                      onPress={() => setDateDraft(d => ({
                        ...d, [key]: /^\d{4}-\d{2}-\d{2}$/.test(d[key]) ? dkey(addDaysLocal(toDateOnlyLocal(d[key]), 1)) : d[key],
                      }))}>
                      <Text style={s.quickDateT}>하루 ▶</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {!!dateErr && <Text style={s.authErr}>{dateErr}</Text>}
            </ScrollView>
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveDateEdit}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 알림 자가진단 모달 */}
      <Modal visible={diagOpen} transparent animationType="slide" onRequestClose={() => setDiagOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setDiagOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>🩺 알림 자가진단</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              <View style={s.diagRow}>
                <Text style={s.diagLabel}>알림 접근 권한</Text>
                <Text style={[s.diagVal, { color: perm === 'authorized' ? C.green : C.red }]}>
                  {perm === 'authorized' ? '켜짐 ✓' : '꺼짐 ✗'}
                </Text>
              </View>
              <View style={s.diagRow}>
                <Text style={s.diagLabel}>마지막으로 받은 알림</Text>
                <Text style={[s.diagVal, { color: listenerHealth.hours > 24 ? C.red : C.text }]}>
                  {listenerHealth.lastTs
                    ? new Date(listenerHealth.lastTs).toLocaleString('ko-KR')
                    : '없음'}
                </Text>
              </View>
              <View style={s.diagRow}>
                <Text style={s.diagLabel}>감시 중인 앱에서 온 알림</Text>
                <Text style={s.diagVal}>{listenerHealth.watchedSeen.length}개 앱</Text>
              </View>
              <View style={s.diagRow}>
                <Text style={s.diagLabel}>결제로 인식된 적</Text>
                <Text style={[s.diagVal, { color: listenerHealth.anyCaptured ? C.green : C.red }]}>
                  {listenerHealth.anyCaptured ? '있음 ✓' : '없음 ✗'}
                </Text>
              </View>

              <View style={s.backupBox}>
                <Text style={s.backupTitle}>
                  {listenerHealth.level === 'ok' ? '✅ 정상이에요' : `⚠️ ${listenerHealth.title}`}
                </Text>
                <Text style={s.backupSub}>
                  {perm !== 'authorized'
                    ? '① 아래 "권한 설정 열기"를 눌러 목록에서 "클린페이"를 켜주세요.'
                    : listenerHealth.level === 'dead' || listenerHealth.level === 'stale'
                    ? '안드로이드는 앱을 다시 설치하면 권한이 "켜짐"으로 보여도 실제로는 알림을 안 넘겨주는 경우가 많아요.\n\n① "권한 설정 열기"를 누르세요\n② 목록에서 클린페이를 껐다가\n③ 다시 켜주세요\n④ 그리고 폰 설정 → 배터리 → 클린페이 → "제한 없음"으로 바꿔주세요'
                    : listenerHealth.level === 'unwatched'
                    ? '알림은 잘 들어오고 있어요. 다만 그 앱이 감시 대상이 아니에요.\n아래 "감시할 앱 설정"에서 카드·문자 앱을 켜주세요.'
                    : listenerHealth.level === 'noparse'
                    ? '알림은 들어오는데 금액·가맹점을 못 읽고 있어요.\n아래 "진단 내용 보내기"로 알림 문구를 보내주시면 인식 규칙을 고쳐드릴게요.'
                    : '알림도 잘 들어오고 결제도 잘 인식되고 있어요.'}
                </Text>
              </View>

              <Text style={[s.modalSub, { marginTop: 14 }]}>최근 알림이 온 앱 (최신순)</Text>
              {Object.keys(seenApps).length === 0 && (
                <Text style={s.statEmpty}>기록된 알림이 없어요.</Text>
              )}
              {Object.entries(seenApps)
                .sort((a, b) => new Date(b[1].lastTs) - new Date(a[1].lastTs))
                .slice(0, 10)
                .map(([app, info]) => (
                  <View key={app} style={s.appRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.appRowName} numberOfLines={1}>{app}</Text>
                      <Text style={s.appRowSub} numberOfLines={1}>
                        {new Date(info.lastTs).toLocaleString('ko-KR')} · {info.count}회
                        {info.captured ? ' · 인식됨 ✓' : ''}
                      </Text>
                      {!!info.lastText && (
                        <Text style={s.appRowText} numberOfLines={2}>{info.lastText}</Text>
                      )}
                    </View>
                  </View>
                ))}
            </ScrollView>

            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85}
              onPress={() => RNAndroidNotificationListener.requestPermission()}>
              <Text style={s.bigBtnT}>권한 설정 열기 (껐다 켜기)</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={[s.bigBtn, { flex: 1, marginTop: 0, backgroundColor: C.card2 }]}
                activeOpacity={0.85} onPress={() => { setDiagOpen(false); setAppsOpen(true); }}>
                <Text style={[s.bigBtnT, { color: C.text }]}>감시할 앱 설정</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.bigBtn, { flex: 1, marginTop: 0, backgroundColor: C.card2 }]}
                activeOpacity={0.85} onPress={shareDiagnostics}>
                <Text style={[s.bigBtnT, { color: C.text }]}>진단 내용 보내기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 감시할 앱 설정 모달 */}
      <Modal visible={appsOpen} transparent animationType="slide" onRequestClose={() => setAppsOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setAppsOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>감시할 앱 설정</Text>
            <Text style={s.modalSub}>
              최근 알림이 온 앱 목록이에요. 카드·은행 앱이 안 잡히면 여기서 켜주세요.{'\n'}
              (앱 이름이 영문 코드로 보이는 건 정상이에요)
            </Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {Object.keys(seenApps).length === 0 && (
                <Text style={s.statEmpty}>
                  아직 기록된 알림이 없어요.{'\n'}
                  알림 접근 권한을 켜고, 카드 결제 알림이 한 번 온 뒤에 다시 열어보세요.
                </Text>
              )}
              {Object.entries(seenApps)
                .sort((a, b) => new Date(b[1].lastTs) - new Date(a[1].lastTs))
                .map(([app, info]) => {
                  const isDefault = BANK_PACKAGES.includes(app);
                  const on = isDefault || watchApps.includes(app);
                  return (
                    <TouchableOpacity key={app} style={s.appRow} activeOpacity={0.7}
                      disabled={isDefault}
                      onPress={async () => setWatchApps(await toggleWatchApp(app))}>
                      <View style={[s.checkbox, on && { backgroundColor: C.blue, borderColor: C.blue }]}>
                        {on && <Text style={s.checkboxMark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.appRowName} numberOfLines={1}>{app}</Text>
                        <Text style={s.appRowSub} numberOfLines={1}>
                          {isDefault ? '기본 감시 중' : on ? '감시 중' : '꺼짐'} · 알림 {info.count}회
                          {info.captured ? ' · 결제 인식됨 ✓' : ''}
                        </Text>
                        {!!info.lastText && (
                          <Text style={s.appRowText} numberOfLines={1}>{info.lastText}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={async () => { setAppsOpen(false); await load(); }}>
              <Text style={s.bigBtnT}>완료</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 카드 실적 목표 모달 */}
      <Modal visible={cardTargetOpen} transparent animationType="slide" onRequestClose={() => setCardTargetOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setCardTargetOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>카드 실적 목표</Text>
            <Text style={s.modalSub}>카드 혜택 조건(예: 전월 30만원 이상)을 넣어두면 이번 달 진행률을 보여줘요. 비워두면 표시 안 해요.</Text>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {bySource.map(([k]) => (
                <View key={k}>
                  <Text style={s.budLabel}>{k}</Text>
                  <TextInput style={s.input} placeholder="예: 300,000" placeholderTextColor={C.faint}
                    keyboardType="number-pad" value={cardDraft[k] || ''}
                    onChangeText={v => setCardDraft(d => ({ ...d, [k]: fmtInput(v) }))} />
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={async () => {
              const next = {};
              Object.entries(cardDraft).forEach(([k, v]) => {
                const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
                if (n > 0) next[k] = n;
              });
              await saveCardTargets(next);
              setCardTargets(next); setCardTargetOpen(false);
            }}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 지출 목표 추가/수정 모달 */}
      <Modal visible={goalOpen} transparent animationType="slide" onRequestClose={() => setGoalOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setGoalOpen(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>{goalEditId ? '지출 목표 수정' : '지출 목표 추가'}</Text>
            <Text style={s.modalSub}>기간 동안 얼마나 썼는지 진행률로 보여줘요.</Text>
            {goalDraft && (
              <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
                <TextInput style={s.input} placeholder="이름 (선택, 예: 여행 경비)" placeholderTextColor={C.faint}
                  value={goalDraft.label} onChangeText={v => setGoalDraft(d => ({ ...d, label: v }))} />
                <TextInput style={s.input} placeholder="목표 금액 (원)" placeholderTextColor={C.faint} keyboardType="number-pad"
                  value={goalDraft.amount} onChangeText={v => setGoalDraft(d => ({ ...d, amount: fmtInput(v) }))} />

                <Text style={s.budLabel}>기간</Text>
                <View style={s.tabs}>
                  {[['weekly','주간'],['monthly','월간'],['custom','기간 설정']].map(([k, label]) => (
                    <TouchableOpacity key={k} style={[s.tab, goalDraft.kind === k && s.tabOn]}
                      onPress={() => setGoalDraft(d => ({ ...d, kind: k }))}>
                      <Text style={[s.tabT, goalDraft.kind === k && s.tabTOn]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {goalDraft.kind === 'weekly' && <Text style={s.statEmpty}>이번 주 월요일~일요일 기준으로, 매주 자동으로 넘어가요.</Text>}
                {goalDraft.kind === 'monthly' && <Text style={s.statEmpty}>이번 달 기준으로, 매달 자동으로 넘어가요.</Text>}
                {goalDraft.kind === 'custom' && (
                  <>
                    <Text style={s.budLabel}>시작일 (YYYY-MM-DD)</Text>
                    <TextInput style={s.input} placeholder="2026-07-15" placeholderTextColor={C.faint}
                      value={goalDraft.startDate} onChangeText={v => setGoalDraft(d => ({ ...d, startDate: v }))} />
                    <Text style={s.budLabel}>종료일 (YYYY-MM-DD)</Text>
                    <TextInput style={s.input} placeholder="2026-07-20" placeholderTextColor={C.faint}
                      value={goalDraft.endDate} onChangeText={v => setGoalDraft(d => ({ ...d, endDate: v }))} />
                  </>
                )}
                {!!goalErr && <Text style={s.authErr}>{goalErr}</Text>}
              </ScrollView>
            )}
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={saveGoalDraft}>
              <Text style={s.bigBtnT}>저장</Text>
            </TouchableOpacity>
            {goalEditId && (
              <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }} onPress={confirmGoalDelete}>
                <Text style={{ color: C.red, fontWeight: '700', fontSize: 14 }}>목표 삭제</Text>
              </TouchableOpacity>
            )}
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
                <View style={s.tabs}>
                  <TouchableOpacity style={[s.tab, recurDraft.type !== 'income' && s.tabOn]}
                    onPress={() => setRecurDraft(d => ({ ...d, type: 'expense' }))}>
                    <Text style={[s.tabT, recurDraft.type !== 'income' && s.tabTOn]}>정기 지출</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.tab, recurDraft.type === 'income' && s.tabOn]}
                    onPress={() => setRecurDraft(d => ({ ...d, type: 'income' }))}>
                    <Text style={[s.tabT, recurDraft.type === 'income' && { color: C.green }]}>정기 수입</Text>
                  </TouchableOpacity>
                </View>
                <TextInput style={s.input}
                  placeholder={recurDraft.type === 'income' ? '이름 (예: 월급, 용돈)' : '이름 (예: 넷플릭스, 월세)'}
                  placeholderTextColor={C.faint}
                  value={recurDraft.merchant} onChangeText={v => setRecurDraft(d => ({ ...d, merchant: v }))} />
                <TextInput style={s.input} placeholder="금액 (원)" placeholderTextColor={C.faint} keyboardType="number-pad"
                  value={recurDraft.amount} onChangeText={v => setRecurDraft(d => ({ ...d, amount: fmtInput(v) }))} />

                {recurDraft.type !== 'income' && (
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
                )}

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
  diagRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.card2, gap: 12 },
  diagLabel: { color: C.sub, fontSize: 13.5 },
  diagVal: { color: C.text, fontSize: 13.5, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  permBanner: { backgroundColor: '#2A2417', borderRadius: 18, padding: 18, marginBottom: 14 },
  permTitle: { color: C.gold, fontWeight: '800', fontSize: 15 },
  permSub: { color: '#B5A268', fontSize: 13, marginTop: 4, lineHeight: 19 },

  ddayRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  dday: { flex: 1, borderRadius: 20, backgroundColor: C.card, padding: 18 },
  ddayTag: { color: C.sub, fontSize: 13, fontWeight: '600' },
  ddayNum: { fontSize: 26, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  ddaySince: { color: C.faint, fontSize: 12, marginTop: 3 },
  savedTeaser: { color: C.sub, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 12, marginTop: -2 },
  dateEditBtn: { backgroundColor: C.card, borderRadius: 14, padding: 13, alignItems: 'center', marginBottom: 12 },
  dateEditBtnT: { color: C.sub, fontSize: 13.5, fontWeight: '700' },
  quickDate: { backgroundColor: C.card2, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  quickDateT: { color: C.text, fontSize: 12.5, fontWeight: '700' },
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
  balanceLine: { color: C.sub, fontSize: 13, marginTop: 6 },
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
  itemTags: { color: C.blueText, fontSize: 11.5, marginTop: 3, fontWeight: '600' },
  itemNameRefunded: { textDecorationLine: 'line-through', color: C.sub },
  itemAmtRefunded: { textDecorationLine: 'line-through', color: C.sub },
  todayBox: { backgroundColor: C.card2, borderRadius: 14, padding: 14, marginTop: 12 },
  todayLabel: { color: C.sub, fontSize: 12.5, fontWeight: '600' },
  todayAmt: { fontSize: 24, fontWeight: '800', marginTop: 2, letterSpacing: -0.5 },
  todaySub: { color: C.faint, fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  tagSuggest: { backgroundColor: C.card2, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 6, marginRight: 7 },
  tagSuggestT: { color: C.blueText, fontSize: 12, fontWeight: '700' },
  backupBox: { backgroundColor: C.card2, borderRadius: 16, padding: 16, marginTop: 20 },
  backupTitle: { color: C.text, fontSize: 14.5, fontWeight: '800' },
  appRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.card2 },
  appRowName: { color: C.text, fontSize: 13.5, fontWeight: '700' },
  appRowSub: { color: C.faint, fontSize: 11.5, marginTop: 2 },
  appRowText: { color: C.sub, fontSize: 11, marginTop: 3 },
  backupSub: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: 5 },
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
