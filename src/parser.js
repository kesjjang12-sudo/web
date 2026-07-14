import { CATEGORY_RULES } from './config';

// ---------------------------------------------
// 결제 알림 텍스트에서 금액과 가맹점명을 추출
// 예시 알림들:
//  "신한카드승인 김*성 12,000원 일시불 07/13 20:11 김밥천국"
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
  let text = rawText.replace(/\n/g, ' ').trim();

  // 누적/잔액/한도 금액은 결제 금액이 아니므로 먼저 제거
  // (예: "네이버파이낸셜 승인 120원 누적1,093,380원" → 누적 부분 삭제)
  text = text.replace(/(누적|잔액|한도)\s*:?\s*[\d,]+\s*원?/g, ' ');

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
    .replace(/([\d,]{2,})\s*원/g, ' ')         // 모든 금액 제거 (첫 번째만이 아니라 전부)
    .replace(DATE_RE, ' ')
    .replace(TIME_RE, ' ')
    .replace(/\S*\*+\S*/g, ' ')                // 김*성, 롯데0*5* 같은 마스킹 토큰
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
// 가맹점 이름 → 카테고리 추측
// memory: 사용자가 직접 지정해서 기억된 { 가맹점명: 카테고리키 } 맵 (store.js가 관리)
// ---------------------------------------------
export function guessCategory(merchant, memory = {}) {
  if (!merchant) return 'etc';
  // 1) 기억된 가맹점이면 그대로 (부분 일치 포함: "스타벅스 강남점"도 "스타벅스" 기억을 따름)
  if (memory[merchant]) return memory[merchant];
  for (const [name, cat] of Object.entries(memory)) {
    if (merchant.includes(name) || name.includes(merchant)) return cat;
  }
  // 2) 키워드 규칙
  const lower = merchant.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_RULES)) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) return cat;
  }
  return 'etc';
}
