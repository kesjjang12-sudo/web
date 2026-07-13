# 💳 클린페이 - 결제알림으로 증명하는 금주

카드 결제 푸시알림을 자동으로 읽어서 술집/포차 등 위험 결제가 없음을 증명하는 개인용 앱.
여자친구는 웹 링크로 실시간 조회 가능.

## 동작 원리
1. 안드로이드 "알림 접근" 권한으로 카드사/은행 앱의 결제 알림을 읽음 (금융 API 승인 불필요)
2. 알림 텍스트에서 정규식으로 가맹점명 + 금액 추출
3. 위험 키워드(포차, 주점, 호프...) 검사 → 클린/실패 분류
4. 폰에 저장 + (선택) Supabase로 동기화 → 여자친구용 웹페이지에서 조회

## 1단계. APK 빌드 (전에 하던 것과 동일)
```bash
cd cleanpay
npm install
eas build -p android --profile apk    # eas.json 없다고 하면: eas build:configure 후 재시도
```
빌드 링크로 폰에 설치.

## 2단계. 폰에서 설정 (중요!)
1. 앱 실행 → 노란 배너 탭 → 설정에서 "클린페이" 알림 접근 허용
2. 폰 설정 → 배터리 → 클린페이 → **제한 없음** (백그라운드 감지 안정화)
3. 카드앱(신한플레이 등)의 결제 푸시알림이 켜져 있는지 확인
4. 앱 안의 "포차 결제 시뮬" 버튼으로 동작 테스트

## 3단계. (선택) 여자친구 조회 페이지 — Supabase
LOCAL PICK 때 썼던 Supabase 그대로 씁니다. Firebase보다 이게 익숙하실 거예요.

1. supabase.com → New Project
2. SQL Editor에서 실행:
```sql
create table payments (
  id text primary key,
  ts timestamptz not null,
  merchant text,
  amount int,
  status text,
  memo text,
  matched_keyword text
);
alter table payments enable row level security;
create policy "anon_all" on payments for all to anon using (true) with check (true);
```
3. Settings → API에서 URL과 anon key 복사
4. `src/config.js`와 `web/status.html` 두 파일에 붙여넣기
5. APK 재빌드 (versionCode 1→2 올리고 `eas build`)
6. `web/status.html` 호스팅: **netlify.com → 로그인 → "Deploy manually"에 파일 드래그** → 나온 링크를 여자친구에게 전송. 끝.

## 위험 키워드 수정
`src/config.js`의 RISK_KEYWORDS 배열에 추가/삭제하면 됩니다.
'바'는 "와인바"는 잡고 "바나나"는 안 잡게, '대리'는 "대리점" 제외하도록 별도 처리되어 있음 (parser.js).

## 알아둘 한계
- **현금 결제는 감지 불가** (알림이 없으니까)
- 카드앱 푸시를 꺼두면 감지 불가 → 켜두세요
- 문자(SMS)로만 결제알림 오는 카드는 메시지 앱 패키지가 config에 포함되어 있어야 함 (기본 포함됨)
- 가맹점명 파싱은 카드사마다 형식이 달라 가끔 부정확할 수 있음 → 실제 알림이 잘못 파싱되면 알림 원문(raw)을 Claude에게 보여주면 정규식 보정해드림
- 갤럭시는 가끔 리스너가 멈추면 재부팅하면 살아남

## 실패 메모
실패 기록을 탭하면 메모를 남길 수 있어요 ("거래처 회식, 1차만 참석").
메모는 여자친구 페이지에도 표시되어 소명(?)이 가능합니다 😄
