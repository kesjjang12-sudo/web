import { RISK_KEYWORDS } from './config';

// ---------------------------------------------
// 결제 알림 텍스트에서 금액과 가맹점명을 추출
// 예시 알림들:
//  "신한카드승인 김*성 12,000원 일시불 07/13 20:11 OO포차"
//  "김은성님 07/13 20:11 현대카드 승인 45,000원 일시불 스타벅스강남점"
//  "토스 | 스타벅스에서 5,500원 결제됐어요"
// ---------------------------------------------

const AMOUNT_RE = /([\d,]{2,})\s*원/;
const DATE_RE = /\d{1,2}\/\d{1,2}/g;
const TIME_RE = /\d{1,2}:\d{2}/g;
// 파싱에서 걸러낼 상투어
const STOPWORDS = [
  '승인', '취소', '일시불', '할부', '체크', '신용', '해외', '국내',
  '누적', '잔액', '출금', '입금', '결제', '됐어요', '되었습니다', '완료',
  'KRW', '원', '님', '고객님', '카드', '에서', '사용',
  '신한', '현대', '삼성', '국민', 'KB', '우리', '하나', 'NH', '농협', '롯데', '토스', '카카오뱅크', '카카오페이',
];

export function parsePayment(rawText) {
  if (!rawText) return null;
  const text = rawText.replace(/\n/g, ' ').trim();

  // 결제 알림이 아닌 것 거르기 (광고, 이벤트 등)
  const amountMatch = text.match(AMOUNT_RE);
  if (!amountMatch) return null;
  const isPayment = /승인|결제|사용|출금/.test(text);
  if (!isPayment) return null;
  if (/취소/.test(text)) return null; // 결제취소 알림 제외

  const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
  if (!amount || amount < 100) return null;

  // 가맹점명 추출: 금액/날짜/시간/상투어/마스킹이름(김*성) 제거 후 남는 토큰
  let cleaned = text
    .replace(AMOUNT_RE, ' ')
    .replace(DATE_RE, ' ')
    .replace(TIME_RE, ' ')
    .replace(/[가-힣]\*+[가-힣]?/g, ' ')     // 김*성 같은 마스킹 이름
    .replace(/\[.*?\]|\(.*?\)/g, ' ')          // [Web발신] 등
    .replace(/[|·]/g, ' ');
  let tokens = cleaned.split(/\s+/).map(t => t.replace(/(에서|됐어요|되었습니다)$/,'')).filter(t => {
    if (!t || t.length < 2) return false;
    if (STOPWORDS.some(sw => t === sw || t === sw + '님')) return false;
    if (/카드|승인|결제|뱅크|페이$|Web발신/i.test(t)) return false; // 카드사/승인 토큰 제거
    if (/^[\d,./:-]+$/.test(t)) return false;
    return true;
  });
  // 남은 토큰 중 가장 뒤쪽(카드알림은 보통 가맹점이 마지막) 최대 3개를 가맹점명으로
  const merchant = tokens.slice(-3).join(' ').trim() || '알수없음';

  return { merchant, amount, raw: text };
}

// ---------------------------------------------
// 위험 키워드 판별
// ---------------------------------------------
export function isRisky(merchant) {
  const m = merchant.toLowerCase();

  // 일반 키워드
  for (const kw of RISK_KEYWORDS) {
    if (m.includes(kw.toLowerCase())) return kw;
  }
  // '바' - 단어 끝에 올 때만 (스시바, 와인바 O / 바나나, 바른치킨 X)
  if (/(?:^|\s)\S*바$/.test(merchant) && !/바나나|바른|바다|바비큐|바게트/.test(merchant)) {
    return '바';
  }
  // '대리' - '대리점'은 제외
  if (merchant.includes('대리') && !merchant.includes('대리점')) {
    return '대리';
  }
  return null;
}

export function classify(payment) {
  const hit = isRisky(payment.merchant);
  return {
    ...payment,
    status: hit ? '실패' : '클린',
    matchedKeyword: hit,
  };
}
