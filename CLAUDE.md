# CLAUDE.md — 클린페이 프로젝트 컨텍스트

## 프로젝트 개요
개인용(1인 사용) 안드로이드 앱. 카드사/은행 앱의 결제 푸시알림을 NotificationListener로 읽어
가맹점명·금액을 추출하고 카테고리를 자동 분류하는 **가계부 앱**. 금주·금연 D-day 표시.
여자친구가 외부 웹 링크(Supabase 연동)로 D-day와 지출 내역을 조회할 수 있음.
(v1은 술집 결제 감지 "클린/실패" 금주 증명 앱이었으나 v2에서 실패 개념 제거, 가계부로 전환됨)

사용자(오너)는 비개발자. 설명은 한국어로, 쉽게. 명령어는 복붙 가능하게 제시할 것.
빌드는 EAS 클라우드 빌드 사용 (Android Studio 없음). EAS 계정: kesjjang4545s-team / 프로젝트 cleanpay.

## 기술 스택
- Expo SDK 53 / React Native 0.79 (managed workflow, EAS Build로 APK 생성)
- react-native-android-notification-listener ^5.0.1 — 알림 가로채기 (Android 전용)
- @react-native-async-storage/async-storage — 로컬 저장
- expo-updates — OTA 업데이트 (채널: apk). JS 수정은 `eas update --channel apk`로 빌드 없이 배포
- Supabase REST API — 외부 조회용 동기화 (config.js에 URL/KEY 입력 시 활성화)

## 파일 구조
- `index.js` — 진입점. **헤드리스 태스크 등록 (핵심)**. 앱이 꺼져 있어도 알림 수신 시 실행됨.
  RNAndroidNotificationListenerHeadlessJsName으로 등록. UI 코드 import 금지 (백그라운드 태스크 제약).
- `App.js` — UI 전체. 권한 배너, 금주/금연 D-day 카드, 월 지출 요약(◀▶ 이동), 카테고리 막대,
  날짜별 내역(탭=카테고리 변경, 길게=삭제), + 직접 추가(현금), 동작 테스트 버튼.
- `src/config.js` — QUIT_GOALS(금주/금연 시작일), BANK_PACKAGES(감시 금융앱), CATEGORIES(7종),
  CATEGORY_RULES(자동 분류 키워드), Supabase 키. 사용자가 직접 수정하는 유일한 파일.
- `src/parser.js` — 알림 텍스트 → {merchant, amount} 추출 + guessCategory(가맹점→카테고리 추측).
  - 금액: /([\d,]{2,})\s*원/ · '취소' 포함 시 무시 · 승인/결제/사용/출금 단어 없으면 무시(광고 필터)
  - 가맹점: 금액/날짜/시간/마스킹이름/상투어 토큰 제거 후 마지막 최대 3토큰
  - 카테고리: 기억된 가맹점(부분일치 포함) 우선 → CATEGORY_RULES 키워드 → 'etc'
- `src/store.js` — AsyncStorage CRUD, 10초 내 중복 알림 방지, 카테고리 변경 시 가맹점 기억(merchant_categories_v1),
  v1 기록 마이그레이션(category 없으면 추측), 삭제, Supabase upsert/delete.
- `web/status.html` — 여자친구용 조회 페이지 (정적 파일, Netlify 등에 호스팅). Supabase anon 읽기.
  D-day는 파일 안 QUIT 상수로 계산 (config.js와 별도로 수동 동기화 필요).
- `README.md` — 오너용 셋업 가이드 (빌드/OTA/권한/Supabase 절차).

## 빌드/배포
```powershell
npm install
eas build -p android --profile apk        # 네이티브 변경 시에만 (versionCode +1 필수)
eas update --channel apk --message "..."  # JS만 수정 시 (빌드 불필요, 앱 재시작 2번이면 적용)
```
- app.json: package=com.eunsung.cleanpay, versionCode 현재 2, runtimeVersion policy=appVersion(1.0.0),
  android.allowBackup=false (알림 리스너 라이브러리와 매니페스트 충돌 방지 — 제거하면 빌드 실패!)
- .npmrc의 legacy-peer-deps=true 필수 (notification-listener가 react 18 피어 요구, 실제로는 19에서 동작)
- 알림 리스너 서비스는 라이브러리 autolink가 매니페스트에 자동 병합. 별도 config plugin 불필요.
- Expo Go에서는 동작 안 함 (네이티브 모듈) — 반드시 EAS 빌드된 APK로 테스트.
- version(1.0.0)을 바꾸면 runtimeVersion이 바뀌어 기존 APK가 OTA를 못 받음 — 새 APK 배포할 때만 변경.

## Supabase 스키마
```sql
create table payments (id text primary key, ts timestamptz not null, merchant text,
  amount int, category text, memo text);
alter table payments enable row level security;
create policy "anon_all" on payments for all to anon using (true) with check (true);
```
(구버전에서 넘어온 경우: alter table payments add column if not exists category text;)

## 알려진 제약 / 주의
- 현금 결제는 감지 불가(+ 버튼으로 수동 추가), 카드앱 푸시 꺼져 있으면 감지 불가
- 배터리 최적화 예외 설정 필요 (설정→배터리→제한 없음)
- 갤럭시에서 리스너 죽으면 재부팅으로 복구되는 사례 있음
- Play 프로텍트가 APK 설치를 차단함 → 검사 잠깐 끄고 설치 (README 참고)
- 카드사별 알림 포맷 차이로 파싱 오류 가능 → 실제 알림 원문 받아서 parser.js STOPWORDS/정규식 보정
- 헤드리스 태스크는 반드시 Promise 반환, UI 접근 불가

## 다음 작업 후보 (오너가 요청할 수 있는 것)
- 실제 카드 알림 원문 기반 파서 정확도 개선
- 월 예산 설정 + 초과 경고
- 주간/월간 리포트 자동 생성
- '맑은날' 금주·금연 앱과 통합 (별도 프로젝트 geumju-app 존재)
