import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  SafeAreaView, View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Modal, TextInput, AppState, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import { getPayments, savePayment, updateCategory, deletePayment, syncAll } from './src/store';
import { parsePayment } from './src/parser';
import { QUIT_GOALS, CATEGORIES, SUPABASE_URL } from './src/config';

// 토스 스타일 다크 팔레트
const C = {
  bg:'#101013', card:'#17171C', card2:'#26262C', press:'#2E2E36',
  text:'#E5E8EB', sub:'#8B95A1', faint:'#6B7684',
  blue:'#3182F6', blueText:'#4E9BFA', green:'#16C47F', gold:'#E5B84B',
};
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
const won = n => n.toLocaleString('ko-KR');
const DAY_NAMES = ['일','월','화','수','목','금','토'];

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
const srcName = app => !app || app === 'manual' ? '직접 입력' : app === 'test' ? '테스트'
  : /messaging/.test(app) ? '문자' : '카드 알림';

export default function App() {
  const [perm, setPerm] = useState('unknown');
  const [payments, setPayments] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0); // 0=이번달, -1=지난달 ...
  const [pickTarget, setPickTarget] = useState(null); // 카테고리 바꿀 결제
  const [adding, setAdding] = useState(false);        // 직접 추가 모달
  const [addName, setAddName] = useState('');
  const [addAmt, setAddAmt] = useState('');
  const [addCat, setAddCat] = useState('food');

  const load = useCallback(async () => {
    const [p, st] = await Promise.all([
      getPayments(), RNAndroidNotificationListener.getPermissionStatus(),
    ]);
    setPayments(p); setPerm(st);
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

  // ── 이번 달 데이터 ──
  const now = new Date();
  const viewYM = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthPays = useMemo(() => payments.filter(p => {
    const d = new Date(p.ts);
    return d.getFullYear() === viewYM.getFullYear() && d.getMonth() === viewYM.getMonth();
  }), [payments, monthOffset]);
  const total = monthPays.reduce((s, p) => s + p.amount, 0);

  // 지난달 같은 기간(1일~오늘 일자) 대비
  const delta = useMemo(() => {
    if (monthOffset !== 0) return null;
    const prevYM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevSame = payments.filter(p => {
      const d = new Date(p.ts);
      return d.getFullYear() === prevYM.getFullYear() && d.getMonth() === prevYM.getMonth()
        && d.getDate() <= now.getDate();
    }).reduce((s, p) => s + p.amount, 0);
    if (prevSame === 0) return null;
    return total - prevSame;
  }, [payments, monthOffset, total]);

  // 카테고리별 합계 (금액 큰 순)
  const catRows = useMemo(() => {
    const sums = {};
    monthPays.forEach(p => { const k = CAT[p.category] ? p.category : 'etc'; sums[k] = (sums[k]||0) + p.amount; });
    return Object.entries(sums).sort((a,b) => b[1]-a[1]);
  }, [monthPays]);
  const maxCat = catRows.length ? catRows[0][1] : 1;

  // 날짜별 그룹
  const groups = useMemo(() => {
    const g = [];
    monthPays.forEach(p => {
      const label = dayLabel(new Date(p.ts));
      let grp = g.find(x => x.label === label);
      if (!grp) { grp = { label, items: [] }; g.push(grp); }
      grp.items.push(p);
    });
    return g;
  }, [monthPays]);

  // ── 액션 ──
  const pickCategory = useCallback(async (catKey) => {
    const next = await updateCategory(pickTarget.id, catKey);
    setPayments([...next]); setPickTarget(null);
  }, [pickTarget]);

  const addManual = useCallback(async () => {
    const amount = parseInt(addAmt.replace(/[^\d]/g, ''), 10);
    if (!addName.trim() || !amount) { Alert.alert('입력 확인', '이름과 금액을 입력해주세요.'); return; }
    const next = await savePayment({
      id: `m_${Date.now()}`, ts: new Date().toISOString(),
      merchant: addName.trim(), amount, category: addCat, app: 'manual',
    });
    setPayments(next); setAdding(false); setAddName(''); setAddAmt('');
  }, [addName, addAmt, addCat]);

  const confirmDelete = useCallback((p) => {
    Alert.alert('삭제할까요?', `${p.merchant} · ${won(p.amount)}원`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => setPayments(await deletePayment(p.id)) },
    ]);
  }, []);

  // 테스트: 가짜 결제 알림 흘려보기
  const testNotif = useCallback(async () => {
    const samples = [
      '신한카드승인 김*성 5,500원 일시불 07/13 12:10 스타벅스강남점',
      'KB국민카드 승인 김*성 9,500원 일시불 김밥천국역삼점',
      '신한카드승인 김*성 13,200원 일시불 카카오T',
    ];
    const parsed = parsePayment(samples[Math.floor(Math.random()*samples.length)]);
    const next = await savePayment({ ...parsed, id:`test_${Date.now()}`, ts:new Date().toISOString(), app:'test' });
    setPayments(next);
  }, []);

  const monthTitle = `${viewYM.getFullYear()}년 ${viewYM.getMonth()+1}월`;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.sub} />}>

        <View style={s.topRow}>
          <Text style={s.appTitle}>클린페이</Text>
          <Text style={s.appSub}>은성의 가계부</Text>
        </View>

        {/* 권한 배너 */}
        {perm !== 'authorized' && (
          <TouchableOpacity style={s.permBanner} activeOpacity={0.85}
            onPress={() => RNAndroidNotificationListener.requestPermission()}>
            <Text style={s.permTitle}>알림 접근 권한이 필요해요</Text>
            <Text style={s.permSub}>탭하면 설정이 열려요 → 목록에서 "클린페이" 켜기</Text>
          </TouchableOpacity>
        )}

        {/* D-day 카드 */}
        <View style={s.ddayRow}>
          {QUIT_GOALS.map((g, i) => {
            const days = Math.floor((Date.now() - new Date(g.start).getTime()) / 86400000);
            const color = i === 0 ? C.green : C.blueText;
            const st = new Date(g.start);
            return (
              <View key={g.key} style={s.dday}>
                <Text style={s.ddayTag}>{g.label}</Text>
                <Text style={[s.ddayNum, { color }]}>{days}일째</Text>
                <Text style={s.ddaySince}>{st.getMonth()+1}월 {st.getDate()}일부터</Text>
              </View>
            );
          })}
        </View>

        {/* 월 요약 */}
        <View style={s.month}>
          <View style={s.monthHead}>
            <TouchableOpacity onPress={() => setMonthOffset(o => o-1)} style={s.navBtn} hitSlop={8}>
              <Text style={s.navT}>‹</Text>
            </TouchableOpacity>
            <Text style={s.monthTitle}>{monthTitle}</Text>
            <TouchableOpacity onPress={() => setMonthOffset(o => Math.min(0, o+1))} style={s.navBtn} hitSlop={8}>
              <Text style={[s.navT, monthOffset === 0 && { opacity: 0.25 }]}>›</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.totalLabel}>{monthOffset === 0 ? '이번 달 쓴 돈' : '이 달에 쓴 돈'}</Text>
          <Text style={s.total}>{won(total)}원</Text>
          {delta !== null && (
            <View style={s.deltaPill}>
              <Text style={[s.deltaT, { color: delta <= 0 ? C.blueText : '#F04452' }]}>
                지난달보다 {won(Math.abs(delta))}원 {delta <= 0 ? '아끼는 중' : '더 쓰는 중'}
              </Text>
            </View>
          )}

          {/* 카테고리 바 */}
          {catRows.length > 0 && (
            <View style={{ marginTop: 18, gap: 11 }}>
              {catRows.map(([k, v]) => (
                <View key={k} style={s.catRow}>
                  <Text style={s.catName}>{CAT[k].label}</Text>
                  <View style={s.catBar}>
                    <View style={[s.catFill, { width: `${Math.max(5, v/maxCat*100)}%`, backgroundColor: CAT[k].color }]} />
                  </View>
                  <Text style={s.catAmt}>{won(v)}원</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 내역: 날짜별 묶음 카드 */}
        {groups.map(g => (
          <View key={g.label} style={s.dayCard}>
            <View style={s.dayHead}>
              <Text style={s.dayHeadT}>{g.label}</Text>
              <Text style={s.dayHeadAmt}>{won(g.items.reduce((s2,x)=>s2+x.amount,0))}원</Text>
            </View>
            {g.items.map(p => {
              const cat = CAT[p.category] || CAT.etc;
              return (
                <TouchableOpacity key={p.id} style={s.item} activeOpacity={0.6}
                  onPress={() => setPickTarget(p)} onLongPress={() => confirmDelete(p)} delayLongPress={450}>
                  <View style={[s.dot, { backgroundColor: cat.color + '26' }]}>
                    <View style={[s.dotCore, { backgroundColor: cat.color }]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.itemName} numberOfLines={1}>{p.merchant}</Text>
                    <Text style={s.itemSub}>{hhmm(p.ts)} · {srcName(p.app)} · {cat.label}</Text>
                  </View>
                  <Text style={s.itemAmt}>{won(p.amount)}원</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
        {monthPays.length === 0 && (
          <Text style={s.empty}>아직 이 달 기록이 없어요.{'\n'}카드 결제 알림이 오면 자동으로 쌓이고,{'\n'}현금은 아래 + 버튼으로 직접 추가할 수 있어요.</Text>
        )}

        {/* 도움말/테스트 */}
        <View style={{ marginTop: 20 }}>
          <TouchableOpacity style={s.testBtn} onPress={testNotif} activeOpacity={0.7}>
            <Text style={s.testBtnT}>동작 테스트 (가짜 결제 1건 추가)</Text>
          </TouchableOpacity>
          <Text style={s.hint}>내역을 누르면 카테고리 변경 · 길게 누르면 삭제{'\n'}설정 → 배터리 → 클린페이 → "제한 없음" 권장</Text>
          {!SUPABASE_URL && (
            <Text style={s.hint}>src/config.js에 Supabase 주소를 넣으면 여자친구가 웹으로 조회할 수 있어요</Text>
          )}
        </View>
      </ScrollView>

      {/* + 직접 추가 버튼 */}
      <TouchableOpacity style={s.fab} activeOpacity={0.8} onPress={() => { setAddCat('food'); setAdding(true); }}>
        <Text style={s.fabT}>＋</Text>
      </TouchableOpacity>

      {/* 카테고리 선택 모달 */}
      <Modal visible={!!pickTarget} transparent animationType="slide" onRequestClose={() => setPickTarget(null)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickTarget(null)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>카테고리 선택</Text>
            <Text style={s.modalSub}>"{pickTarget?.merchant}" — 앞으로 이 가맹점은 선택한 카테고리로 기억해요</Text>
            <View style={s.catGrid}>
              {CATEGORIES.map(c => (
                <TouchableOpacity key={c.key} activeOpacity={0.7}
                  style={[s.catBtn, pickTarget?.category === c.key && s.catBtnOn]}
                  onPress={() => pickCategory(c.key)}>
                  <View style={[s.catBtnDot, { backgroundColor: c.color }]} />
                  <Text style={[s.catBtnT, pickTarget?.category === c.key && { color: C.text }]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 직접 추가 모달 */}
      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setAdding(false)}>
          <View style={s.modalCard} onStartShouldSetResponder={() => true}>
            <View style={s.grabber} />
            <Text style={s.modalTitle}>지출 직접 추가</Text>
            <Text style={s.modalSub}>현금이나 계좌이체로 쓴 돈을 기록해요</Text>
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
            <TextInput style={s.input} placeholder="어디서 썼나요? (예: 김밥천국)" placeholderTextColor={C.faint}
              value={addName} onChangeText={setAddName} />
            <TextInput style={s.input} placeholder="금액 (원)" placeholderTextColor={C.faint}
              keyboardType="number-pad" value={addAmt} onChangeText={setAddAmt} />
            <TouchableOpacity style={s.bigBtn} activeOpacity={0.85} onPress={addManual}>
              <Text style={s.bigBtnT}>추가하기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingBottom: 110 },
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

  month: { backgroundColor: C.card, borderRadius: 20, padding: 20, marginBottom: 12 },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navBtn: { paddingHorizontal: 6 },
  navT: { color: C.faint, fontSize: 22, fontWeight: '600', marginTop: -3 },
  monthTitle: { color: C.sub, fontWeight: '600', fontSize: 14 },
  totalLabel: { color: C.sub, fontSize: 14 },
  total: { color: C.text, fontSize: 34, fontWeight: '800', marginTop: 2, letterSpacing: -1 },
  deltaPill: { alignSelf: 'flex-start', backgroundColor: C.card2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginTop: 10 },
  deltaT: { fontSize: 13, fontWeight: '700' },

  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  catName: { color: C.sub, fontSize: 14, width: 66 },
  catBar: { flex: 1, height: 7, borderRadius: 4, backgroundColor: C.card2, overflow: 'hidden' },
  catFill: { height: '100%', borderRadius: 4 },
  catAmt: { color: C.text, fontSize: 14, fontWeight: '600', width: 86, textAlign: 'right', letterSpacing: -0.3 },

  dayCard: { backgroundColor: C.card, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, marginBottom: 12 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  dayHeadT: { color: C.faint, fontSize: 13, fontWeight: '600' },
  dayHeadAmt: { color: C.faint, fontSize: 13, fontWeight: '600' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 },
  dot: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  dotCore: { width: 14, height: 14, borderRadius: 7 },
  itemName: { color: C.text, fontWeight: '700', fontSize: 15.5, letterSpacing: -0.3 },
  itemSub: { color: C.faint, fontSize: 12.5, marginTop: 2 },
  itemAmt: { color: C.text, fontWeight: '700', fontSize: 15.5, letterSpacing: -0.3 },

  empty: { color: C.sub, fontSize: 14, lineHeight: 22, textAlign: 'center', marginVertical: 28 },
  testBtn: { backgroundColor: C.card, borderRadius: 14, padding: 14, alignItems: 'center' },
  testBtnT: { color: C.sub, fontWeight: '700', fontSize: 13 },
  hint: { color: C.faint, fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },

  fab: { position: 'absolute', right: 20, bottom: 26, width: 56, height: 56, borderRadius: 28, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: C.blue, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
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
