# CLAUDE.md — 클린페이 프로젝트 컨텍스트

## 프로젝트 개요
개인용(1인 사용) 안드로이드 앱. 카드사/은행 앱의 결제 푸시알림을 NotificationListener로 읽어
가맹점명·금액을 추출하고, 술집/포차 등 위험 키워드를 검사해 "클린/실패"로 분류하는 금주 증명 앱.
여자친구가 외부 웹 링크(Supabase 연동)로 연속 클린 일수와 결제 내역을 조회할 수 있음.

사용자(오너)는 비개발자. 설명은 한국어로, 쉽게. 명령어는 복붙 가능하게 제시할 것.
빌드는 Windows PowerShell + EAS 클라우드 빌드 사용 (Android Studio 없음).

## 기술 스택
- Expo SDK 53 / React Native 0.79 (managed workflow, EAS Build로 APK 생성)
- react-native-android-notification-listener ^5.0.1 — 알림 가로채기 (Android 전용)
- @react-native-async-storage/async-storage — 로컬 저장
- Supabase REST API — 외부 조회용 동기화 (config.js에 URL/KEY 입력 시 활성화)

## 파일 구조
- `index.js` — 진입점. **헤드리스 태스크 등록 (핵심)**. 앱이 꺼져 있어도 알림 수신 시 실행됨.
  RNAndroidNotificationListenerHeadlessJsName으로 등록. UI 코드 import 금지 (백그라운드 태스크 제약).
- `App.js` — UI 전체. 권한 배너, 연속 클린 스트릭, 결제 내역 리스트, 실패 메모 모달, 시뮬레이션 버튼.
- `src/config.js` — 감시 대상 금융앱 패키지 목록(BANK_PACKAGES), 위험 키워드(RISK_KEYWORDS), Supabase 키. 사용자가 직접 수정하는 유일한 파일.
- `src/parser.js` — 알림 텍스트 → {merchant, amount} 추출 + 위험 판별.
  - 금액: /([\d,]{2,})\s*원/ · '취소' 포함 시 무시 · 승인/결제/사용/출금 단어 없으면 무시(광고 필터)
  - 가맹점: 금액/날짜/시간/마스킹이름/상투어 토큰 제거 후 마지막 최대 3토큰
  - 오탐 방지: '바'는 "와인바"는 '대리'는 '대리점' 제외
- `src/store.js` — AsyncStorage CRUD, 10초 내 중복 알림 방지, 스트릭 계산(마지막 실패 기준), Supabase upsert.
- `web/status.html` — 여자친구용 조회 페이지 (정적 파일, Netlify 등에 호스팅). Supabase anon 읽기.
- `README.md` — 오너용 셋업 가이드 (빌드/권한/Supabase 절차).

## 빌드/배포
```powershell
npm install
eas build -p android --profile apk   # eas.json에 apk 프로필 없으면 추가 필요
```
- app.json: package=com.eunsung.cleanpay, versionCode는 업데이트마다 +1
- 알림 리스너 서비스는 라이브러리 autolink가 매니페스트에 자동 병합 (RN>=0.60). 별도 config plugin 불필요.
- Expo Go에서는 동작 안 함 (네이티브 모듈) — 반드시 EAS 빌드된 APK로 테스트.

## Supabase 스키마
```sql
create table payments (id text primary key, ts timestamptz not null, merchant text,
  amount int, status text, memo text, matched_keyword text);
alter table payments enable row level security;
create policy "anon_all" on payments for all to anon using (true) with check (true);
```

## 알려진 제약 / 주의
- 현금 결제는 감지 불가, 카드앱 푸시 꺼져 있으면 감지 불가
- 배터리 최적화 예외 설정 필요 (설정→배터리→제한 없음)
- 갤럭시에서 리스너 죽으면 재부팅으로 복구되는 사례 있음
- 카드사별 알림 포맷 차이로 파싱 오류 가능 → 실제 알림 원문 받아서 parser.js STOPWORDS/정규식 보정
- 헤드리스 태스크는 반드시 Promise 반환, UI 접근 불가

## 다음 작업 후보 (오너가 요청할 수 있는 것)
- 실제 카드 알림 원문 기반 파서 정확도 개선
- '맑은날' 금주·금연 앱과 통합 (별도 프로젝트 geumju-app 존재)
- 주간 리포트 자동 생성, 클린 연속 시 여자친구에게 자동 알림
