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
  'KRW', '원', '님', '고객님', '회원님', '카드', '에서', '사용', '법인', 'ZERO', '체크', '신용',
  '신한', '현대', '삼성', '국민', 'KB', '우리', '하나', 'NH', '농협', '롯데', '토스', '카카오뱅크', '카카오페이',
];

export function parsePayment(rawText) {
  if (!rawText) return null;
  // 눈에 안 보이는 방향제어/폭없는 문자 제거 (문자 발신번호에 섞여 들어와 필터를 피해감)
  let text = rawText.replace(/[\u2066-\u2069\u200b-\u200f\u202a-\u202e\ufeff\u00ad]/g, '')
    .replace(/\n/g, ' ').trim();

  // 누적/잔액/한도 금액은 결제 금액이 아니므로 먼저 제거
  // (예: "네이버파이낸셜 승인 120원 누적1,093,380원" → 누적 부분 삭제)
  text = text.replace(/(누적|잔액|한도)\s*:?\s*[\d,]+\s*원?/g, ' ');

  // 결제 알림이 아닌 것 거르기 (광고, 이벤트 등)
  const amountMatch = text.match(AMOUNT_RE);
  if (!amountMatch) return null;
  const isPayment = /승인|결제|사용|출금/.test(text);
  if (!isPayment) return null;
  if (/취소/.test(text)) return null; // 결제취소 알림 제외
  // 카드값/요금이 통장에서 빠져나가는 알림은 제외 (개별 카드 결제가 이미 기록돼서 이중집계됨)
  if (/카드대금|카드값/.test(text)) return null;
  if (/출금되었습니다/.test(text)) return null; // "○○월 출금되었습니다", "회원님 ... 출금되었습니다" 등 청구서형 문자
  // 아직 안 일어난 일을 미리 알리는 안내문자는 실제 결제가 아니므로 제외
  // (예: "이자 000원이 07/20 출금 예정입니다", "납부 예정 안내")
  if (/예정|납부일|납부하세요|납부바랍니다|청구서|연체/.test(text)) return null;

  const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
  if (!amount || amount < 100) return null;

  // 가맹점명 추출: 금액/날짜/시간/상투어/마스킹이름(김*성) 제거 후 남는 토큰
  let cleaned = text
    .replace(/([\d,]{2,})\s*원/g, ' ')         // 모든 금액 제거 (첫 번째만이 아니라 전부)
    .replace(DATE_RE, ' ')
    .replace(TIME_RE, ' ')
    .replace(/[가-힣]\*+[가-힣]님?/g, ' ')     // 김*성, 김*성님 (이름 마스킹 — 뒤에 글자가 있을 때만)
    .replace(/\S*\d\*+\S*/g, ' ')              // 롯데0*5* 같은 카드번호 마스킹
    .replace(/\[.*?\]|\(.*?\)/g, ' ')          // [Web발신], (1건) 등
    .replace(/[|·,]/g, ' ');
  let tokens = cleaned.split(/\s+/)
    .map(t => t.replace(/(에서|됐어요|되었습니다)$/,'').replace(/^[-*]+|[-*]+$/g, '')) // "한국복합물*" → 한국복합물, "법인-" → 법인
    .filter(t => {
      if (!t || t.length < 2) return false;
      if (STOPWORDS.some(sw => t === sw || t === sw + '님')) return false;
      if (/카드|승인|결제|뱅크|페이$|Web발신/i.test(t)) return false; // 카드사/승인 토큰 제거
      if (/^[\d,./:-]+$/.test(t)) return false;
      if (/^[\d-]{6,}$/.test(t)) return false;   // 1588-9955 같은 발신번호
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
