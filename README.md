# 💸 클린페이 - 결제알림 자동 가계부

카드 결제 푸시알림을 자동으로 읽어서 카테고리별로 분류해주는 개인용 가계부 앱.
금주/금연 D-day도 함께 표시. 여자친구는 웹 링크로 실시간 조회 가능.

## 동작 원리
1. 안드로이드 "알림 접근" 권한으로 카드사/은행 앱의 결제 알림을 읽음 (금융 API 승인 불필요)
2. 알림 텍스트에서 정규식으로 가맹점명 + 금액 추출
3. 가맹점 이름으로 카테고리 자동 추측 (식비/카페·간식/교통/쇼핑/생활·마트/구독·통신/기타)
4. 앱에서 칩을 눌러 카테고리를 바꾸면 그 가맹점은 바꾼 값으로 기억됨
5. 현금/계좌이체는 + 버튼으로 직접 추가
6. 폰에 저장 + (선택) Supabase로 동기화 → 여자친구용 웹페이지에서 조회

## 금주/금연 시작일 바꾸기
`src/config.js` 맨 위 `QUIT_GOALS`의 날짜만 수정하면 됩니다. (현재 둘 다 2026-07-13)

## 1단계. APK 빌드
```bash
npm install
eas build -p android --profile apk
```
빌드 링크로 폰에 설치. (Play 프로텍트가 막으면: Play스토어 → 프로필 → Play 프로텍트 → 설정 → 검사 끄고 설치 후 다시 켜기)

### 앱 수정 후 배포 (OTA — 빌드 불필요!)
자바스크립트만 고친 경우(파서, 키워드, 화면 등 거의 모든 수정):
```bash
eas update --channel apk --message "수정 내용"
```
폰에서 앱을 완전히 껐다가 두 번 켜면 새 버전이 적용됩니다. APK 재설치 불필요.
새 네이티브 모듈/권한을 추가했을 때만 APK 재빌드(versionCode +1)가 필요합니다.

## 2단계. 폰에서 설정 (중요!)
1. 앱 실행 → 노란 배너 탭 → 설정에서 "클린페이" 알림 접근 허용
2. 폰 설정 → 배터리 → 클린페이 → **제한 없음** (백그라운드 감지 안정화)
3. 카드앱(신한플레이 등)의 결제 푸시알림이 켜져 있는지 확인
4. 앱 안의 "동작 테스트" 버튼으로 확인

## 3단계. (선택) 여자친구 조회 페이지 — Supabase
1. supabase.com → New Project
2. SQL Editor에서 실행:
```sql
create table payments (
  id text primary key,
  ts timestamptz not null,
  merchant text,
  amount int,
  category text,
  memo text
);
alter table payments enable row level security;
create policy "anon_all" on payments for all to anon using (true) with check (true);
```
(예전 스키마로 이미 만들었다면: `alter table payments add column if not exists category text;` 만 실행)
3. Settings → API에서 URL과 anon key 복사
4. `src/config.js`와 `web/status.html` 두 파일에 붙여넣기 (status.html에는 금주/금연 시작일도)
5. `eas update --channel apk` 로 앱에 반영
6. `web/status.html` 호스팅: **netlify.com → 로그인 → "Deploy manually"에 파일 드래그** → 나온 링크를 여자친구에게 전송. 끝.

## 카테고리 수정
- 카테고리 종류/색: `src/config.js`의 CATEGORIES
- 자동 분류 키워드: `src/config.js`의 CATEGORY_RULES (예: '교촌' → food에 추가)
- 앱에서 칩으로 바꾼 가맹점 기억이 키워드 규칙보다 우선함

## 알아둘 한계
- **현금 결제는 자동 감지 불가** → + 버튼으로 직접 추가
- 카드앱 푸시를 꺼두면 감지 불가 → 켜두세요
- 문자(SMS)로만 결제알림 오는 카드는 메시지 앱 패키지가 config에 포함되어 있어야 함 (기본 포함됨)
- 가맹점명 파싱은 카드사마다 형식이 달라 가끔 부정확할 수 있음 → 잘못 파싱되면 알림 원문을 Claude에게 보여주면 보정해드림
- 갤럭시는 가끔 리스너가 멈추면 재부팅하면 살아남
