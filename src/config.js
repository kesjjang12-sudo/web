// ============================================
// 클린페이 설정 파일 - 여기만 수정하면 됩니다
// ============================================

// 1) 감시할 금융앱 패키지명 (여기 있는 앱의 알림만 분석)
export const BANK_PACKAGES = [
  'com.shcard.smartpay',        // 신한플레이(신한카드)
  'com.shinhan.sbanking',       // 신한 SOL뱅크
  'com.hyundaicard.appcard',    // 현대카드
  'kr.co.samsungcard.mpocket',  // 삼성카드
  'viva.republica.toss',        // 토스
  'com.kbcard.cxh.appcard',     // KB Pay(국민카드)
  'com.kbstar.kbbank',          // KB스타뱅킹
  'com.kakaobank.channel',      // 카카오뱅크
  'com.kakaopay.app',           // 카카오페이
  'com.wooricard.smartapp',     // 우리카드
  'com.hanaskcard.paycla',      // 하나카드
  'nh.smart.nhallonepay',       // NH페이
  'com.lcacApp',                // 롯데카드
  'com.samsung.android.messaging', // 문자로 결제알림 오는 경우 (삼성 메시지)
  'com.google.android.apps.messaging', // 구글 메시지
];

// 2) 위험 키워드 (결제처 이름에 포함되면 '실패' 처리)
export const RISK_KEYWORDS = [
  '포차', '술집', '주점', '호프', '단란', '노래타운',
  '이자카야', '포장마차', '와인바', '펍', 'pub', 'bar',
  '맥주', '소주', '비어', '주류',
  '대리운전', '대리 운전',
];
// '바'와 '대리'는 "와인바"는 잡고 "바나나"는 안 잡게, '대리'는 "대리점" 제외하도록 별도 처리되어 있음 (parser.js).

// 3) Supabase 연동 (여자친구용 웹페이지 데이터 동기화)
//    supabase.com 에서 프룬젝트 만들��� 아뗘 톴 값을 채우세요.
//    Settings > API 에서 확인 가능. 비워두면 동기화 없이 폰에윜드 동작.
export const SUPABASE_URL = '';        // 예: 'https://abcdefg.supabase.co'
export const SUPABASE_ANON_KEY = '';   // 예: 'eyJhbGciOi...'
