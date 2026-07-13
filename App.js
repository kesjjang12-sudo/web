import React, { useEffect, useState, useCallback } from 'react';
import {
  SafeAreaView, View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Modal, TextInput, AppState, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import { getPayments, getStreak, updateMemo, savePayment, syncAll, getQuitStart } from './src/store';
import { parsePayment, classify } from './src/parser';
import { SUPABASE_URL } from './src/config';

const C = { bg:'#0f1115', card:'#1a1e26', line:'#2a3040', text:'#eef1f6', sub:'#8b93a5', green:'#4fc08d', red:'#e2604f', gold:'#e8b84f' };
const fmtWon = n => n.toLocaleString('ko-KR') + '원';
const fmtDT = iso => { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };

export default function App() {
  const [perm, setPerm] = useState('unknown');
  const [payments, setPayments] = useState([]);
  const [streak, setStreak] = useState(0);
  const [memoTarget, setMemoTarget] = useState(null);
  const [memoText, setMemoText] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [p, s, st] = await Promise.all([
      getPayments(), getStreak(), RNAndroidNotificationListener.getPermissionStatus(),
    ]);
    setPayments(p); setStreak(s); setPerm(st);
  }, []);

  useEffect(() => {
    load();
    getQuitStart();
    syncAll();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') load(); });
    const t = setInterval(load, 20000);
    return () => { sub.remove(); clearInterval(t); };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const saveMemo = useCallback(async () => {
    const next = await updateMemo(memoTarget.id, memoText.trim());
    setPayments(next); setMemoTarget(null); setMemoText('');
  }, [memoTarget, memoText]);

  // 테스트: 가짜 결제 알림 흘려보기
  const testNotif = useCallback(async (risky) => {
    const text = risky
      ? '신한카드승인 김*성 45,000원 일시불 07/13 21:30 왕십리민속포차'
      : '신한카드승인 김*성 5,500원 일시불 07/13 12:10 스타벅스강남점';
    const record = classify(parsePayment(text));
    const next = await savePayment({ ...record, id:`test_${Date.now()}`, ts:new Date().toISOString(), app:'test' });
    setPayments(next); load();
  }, [load]);

  const today = new Date().toDateString();
  const todayList = payments.filter(p => new Date(p.ts).toDateString() === today);
  const todayClean = todayList.length > 0 && todayList.every(p => p.status === '클린');
  const fails = payments.filter(p => p.status === '실패').length;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.sub} />}>

        <Text style={s.appTitle}>💳 클린페이</Text>
        <Text style={s.appSub}>결제 내역으로 증명하는 금주</Text>

        {/* 권한 배너 */}
        {perm !== 'authorized' && (
          <TouchableOpacity style={s.permBanner} onPress={() => RNAndroidNotificationListener.requestPermission()}>
            <Text style={s.permTitle}>⚠️ 알림 접근 권한이 필요해요</Text>
            <Text style={s.permSub}>탭하면 설정이 열립니다 → 목록에서 "클린페이" 켜기{'\n'}이 권한이 있어야 카드 결제 알림을 읽을 수 있어요</Text>
          </TouchableOpacity>
        )}

        {/* 스트릭 */}
        <View style={s.streakCard}>
          <Text style={s.streakLabel}>연속 클린</Text>
          <Text style={s.streakDays}>{streak}일</Text>
          <Text style={[s.todayBadge, { color: todayList.length === 0 ? C.sub : todayClean ? C.green : C.red }]}>
            {todayList.length === 0 ? '오늘 결제 없음' : todayClean ? `오늘 ${todayList.length}건 모두 클린 ✓` : '오늘 위험 결제 감지됨'}
          </Text>
        </View>

        <View style={s.statRow}>
          <View style={s.stat}><Text style={s.statL}>전체 기록</Text><Text style={s.statV}>{payments.length}건</Text></View>
          <View style={s.stat}><Text style={s.statL}>실패</Text><Text style={[s.statV, { color: fails ? C.red : C.green }]}>{fails}건</Text></View>
        </View>

        {/* 여자친구 공유 링크 안내 */}
        <View style={s.card}>
          <Text style={s.cardTitle}>💌 여자친구 조회 페이지</Text>
          <Text style={s.cardText}>
            {SUPABASE_URL
              ? 'Supabase 연동됨. status.html을 호스팅한 링크를 여자친구에게 보내주세요.'
              : 'src/config.js에 Supabase 주소를 넣으면 여자친구가 웹 링크로 실시간 조회할 수 있어요. (README 참고)'}
          </Text>
        </View>

        {/* 내역 */}
        <Text style={s.secTitle}>결제 내역</Text>
        {payments.length === 0 && (
          <Text style={s.empty}>아직 감지된 결제가 없어요.{'\n'}권한을 켜고 카드 결제가 발생하면 자동으로 쌓입니다.{'\n'}아래 테스트 버튼으로 미리 볼 수 있어요.</Text>
        )}
        {payments.slice(0, 50).map(p => (
          <TouchableOpacity key={p.id} style={s.payCard}
            onPress={() => { if (p.status === '실패') { setMemoTarget(p); setMemoText(p.memo || ''); } }}>
            <View style={s.payHead}>
              <Text style={s.payMerchant}>{p.merchant}</Text>
              <Text style={[s.payStatus, { color: p.status === '클린' ? C.green : C.red }]}>
                {p.status === '클린' ? '클린 ✓' : `실패 (${p.matchedKeyword})`}
              </Text>
            </View>
            <Text style={s.payMeta}>{fmtDT(p.ts)} · {fmtWon(p.amount)}</Text>
            {p.status === '실패' && (
              <Text style={s.payMemo}>{p.memo ? `📝 ${p.memo}` : '탭해서 메모 남기기 (어떤 상황이었는지)'}</Text>
            )}
          </TouchableOpacity>
        ))}

        {/* 테스트 */}
        <Text style={s.secTitle}>동작 테스트</Text>
        <View style={s.statRow}>
          <TouchableOpacity style={[s.testBtn, { borderColor: '#2f5a42' }]} onPress={() => testNotif(false)}>
            <Text style={{ color: C.green, fontWeight: '700' }}>클린 결제 시뮬</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.testBtn, { borderColor: '#5a3d4a' }]} onPress={() => testNotif(true)}>
            <Text style={{ color: C.red, fontWeight: '700' }}>포차 결제 시뮬</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.hint}>⚙️ 설정 → 배터리 → 클린페이 → "제한 없음"으로 해두면 백그라운드 감지가 안정적입니다</Text>
      </ScrollView>

      {/* 실패 메모 모달 */}
      <Modal visible={!!memoTarget} transparent animationType="slide" onRequestClose={() => setMemoTarget(null)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>실패 메모</Text>
            <Text style={s.cardText}>{memoTarget?.merchant} · {memoTarget ? fmtWon(memoTarget.amount) : ''}</Text>
            <TextInput style={s.input} multiline placeholder="예: 거래처 회식이라 어쩔 수 없었음. 1차만 하고 나옴."
              placeholderTextColor={C.sub} value={memoText} onChangeText={setMemoText} />
            <TouchableOpacity style={s.bigBtn} onPress={saveMemo}><Text style={s.bigBtnT}>저장</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setMemoTarget(null)}><Text style={s.cancel}>닫기</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 60 },
  appTitle: { color: C.text, fontSize: 24, fontWeight: '900', marginTop: 8 },
  appSub: { color: C.sub, fontSize: 13, marginBottom: 16 },
  permBanner: { backgroundColor: '#3a2f1c', borderColor: '#6b5626', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  permTitle: { color: C.gold, fontWeight: '800', fontSize: 15 },
  permSub: { color: '#cdb97e', fontSize: 12, marginTop: 4, lineHeight: 18 },
  streakCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 12 },
  streakLabel: { color: C.sub, fontSize: 14, letterSpacing: 3 },
  streakDays: { color: C.text, fontSize: 56, fontWeight: '900', marginVertical: 2 },
  todayBadge: { fontSize: 14, fontWeight: '700', marginTop: 6 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, alignItems: 'center' },
  statL: { color: C.sub, fontSize: 12 }, statV: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 2 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  cardText: { color: C.sub, fontSize: 12, lineHeight: 18 },
  secTitle: { color: C.text, fontSize: 16, fontWeight: '800', marginVertical: 10 },
  empty: { color: C.sub, fontSize: 13, lineHeight: 20, textAlign: 'center', marginVertical: 20 },
  payCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginBottom: 8 },
  payHead: { flexDirection: 'row', justifyContent: 'space-between' },
  payMerchant: { color: C.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  payStatus: { fontSize: 13, fontWeight: '800' },
  payMeta: { color: C.sub, fontSize: 12, marginTop: 3 },
  payMemo: { color: C.gold, fontSize: 12, marginTop: 6 },
  testBtn: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  hint: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 10, textAlign: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 36 },
  modalTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, color: C.text, padding: 12, height: 90, textAlignVertical: 'top', marginTop: 10, fontSize: 15 },
  bigBtn: { backgroundColor: C.green, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  bigBtnT: { color: C.bg, fontWeight: '800', fontSize: 16 },
  cancel: { color: C.sub, textAlign: 'center', padding: 10 },
});
