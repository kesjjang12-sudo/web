// ============================================
// 클린페이 설정 파일 - 여기만 수정하면 됩니다
// ============================================

// 1) 금주/금연 시작일 (D-day 계산 기준. 날짜만 바꾸면 됩니다)
export const QUIT_GOALS = [
  { key: 'sober', label: '금주', start: '2026-07-13' },
  { key: 'smoke', label: '금연', start: '2026-07-13' },
];

// 1-1) 아낀 돈으로 살 수 있는 것들 (재미용 — 시세 변동 적은 것들로, 자유롭게 수정)
export const SHOP_ITEMS = [
  { emoji: '☕', name: '스타벅스 아메리카노', unit: '잔',   price: 4700 },
  { emoji: '🍜', name: '국밥 한 그릇',        unit: '그릇', price: 10000 },
  { emoji: '🎬', name: '영화 티켓',           unit: '장',   price: 15000 },
  { emoji: '🍗', name: '치킨',                unit: '마리', price: 23000 },
  { emoji: '🚄', name: 'SRT 부산행',          unit: '장',   price: 52600 },
  { emoji: '🎮', name: '닌텐도 게임 타이틀',  unit: '개',   price: 64800 },
  { emoji: '🏨', name: '호캉스 1박',          unit: '박',   price: 200000 },
  { emoji: '✈️', name: '일본 왕복 항공권',    unit: '장',   price: 350000 },
];

// 2) 감시할 금융앱 패키지명 (여기 있는 앱의 알림만 분석)
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

// 3) 지출 카테고리 (순서대로 화면에 표시됩니다)
export const CATEGORIES = [
  { key: 'food',    label: '식비',      color: '#F2917A' },
  { key: 'cafe',    label: '카페·간식', color: '#E5B84B' },
  { key: 'transit', label: '교통',      color: '#6FB4F0' },
  { key: 'shop',    label: '쇼핑',      color: '#B79CF5' },
  { key: 'living',  label: '생활·마트', color: '#5BC8C0' },
  { key: 'sub',     label: '구독·통신', color: '#7F8EF2' },
  { key: 'etc',     label: '기타',      color: '#97A1B0' },
];

// 4) 가맹점 이름 → 카테고리 자동 추측 키워드
//    (앱에서 칩을 눌러 바꾸면 그 가맹점은 바꾼 값으로 기억되므로, 여긴 첫 추측용)
export const CATEGORY_RULES = {
  food:    ['김밥', '식당', '분식', '치킨', '피자', '버거', '맥도날드', '롯데리아', 'KFC', '배달의민족', '요기요', '쿠팡이츠', '국밥', '족발', '보쌈', '초밥', '돈까스', '샐러드', '고기', '식탁', '주방', '푸드'],
  cafe:    ['스타벅스', '커피', '카페', '메가', '컴포즈', '빽다방', '이디야', '투썸', '베이커리', '파리바게뜨', '뚜레쥬르', '던킨', '배스킨', '아이스크림', '디저트', '와플', '빙수'],
  transit: ['카카오T', '카카오 T', '택시', '버스', '지하철', '철도', '코레일', 'SRT', 'KTX', '주유', '주차', '하이패스', '티머니', '킥보드', '따릉이'],
  shop:    ['쿠팡', '무신사', '올리브영', '지마켓', 'G마켓', '11번가', '네이버페이', '스마트스토어', '알리', '테무', '나이키', '유니클로', '자라', '백화점', '아울렛'],
  living:  ['GS25', 'CU', '세븐일레븐', '이마트', '홈플러스', '롯데마트', '다이소', '마트', '편의점', '세탁', '약국', '병원', '의원', '미용실', '이발'],
  sub:     ['넷플릭스', '유튜브', '멜론', '스포티파이', '디즈니', '티빙', '웨이브', '왓챠', 'SKT', 'KT', 'LGU', 'LG유플러스', '통신', '요금', '구글', '애플'],
};

// 5) Supabase 연동 (여자친구용 웹페이지 데이터 동기화)
//    supabase.com 에서 프로젝트 만들고 아래 두 값을 채우세요.
//    Settings > API 에서 확인 가능. 비워두면 동기화 없이 폰에서만 동작.
export const SUPABASE_URL = 'https://zzdztiakkfetwzivunyy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_IZqj43JnqNPjuYFsW0yLOQ_3-HjIQL7';
