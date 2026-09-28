"""이슈 키워드 탐지기.

지금 뜨는 검색어를 모으고, 그중 "사람들이 방법·일정·결과를 찾아볼" 키워드를 골라
블로그 글감 후보로 점수를 매긴다.

수집처 (키 불필요):
  - 구글 트렌드 실시간 RSS (한국) — 검색량 추정치, 시작 시각, 관련 뉴스
  - 시그널(signal.bz) 실시간 이슈 — 네이버 쪽 이슈 흐름
  - 네이버·구글 자동완성 — 키워드 뒤에 붙는 "투표방법", "재방송" 같은 검색어

사용법:
    python3 issues.py                  # 마크다운 리포트
    python3 issues.py --json           # 원자료(JSON)
    python3 issues.py --summary        # 휴대폰 알림용 한 줄(200자 이내)
    python3 issues.py --hours 6        # 시작한 지 6시간 이내 키워드만
"""

import argparse
import datetime as dt
import email.utils
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

KST = dt.timezone(dt.timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
TRENDS_RSS = "https://trends.google.com/trending/rss?geo=KR"
TRENDS_NS = {"ht": "https://trends.google.com/trending/rss"}
SIGNAL_API = "https://api.signal.bz/news/realtime"

# 자동완성에 이 단어가 붙어 나오면 "찾아보고 클릭하는" 검색어로 본다.
# 이슈 블로그가 돈 버는 건 인물 이름이 아니라 이런 꼬리 검색어다.
INTENT_WORDS = [
    "방법", "신청", "투표", "문자투표", "조회", "예매", "티켓팅", "일정", "시간", "재방송", "다시보기",
    "중계", "생중계", "결과", "순위", "명단", "우승자", "지원금", "환급", "마감", "대상", "자격",
    "가격", "할인", "쿠폰", "이벤트", "당첨", "발표", "사전예약", "출시일", "날짜", "위치", "장소",
    "주차", "라인업", "출연진", "정답", "금액", "혜택", "사전투표", "투표소", "편성", "몇부작",
]

# 사건·사고성 키워드는 광고가 안 붙거나 단가가 낮고, 글로 다루기도 조심스럽다.
TRAGEDY_WORDS = ["사망", "숨져", "숨진", "폭발", "사고", "살인", "참사", "추락", "화재", "실종", "피살", "흉기", "성범죄"]


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def parse_traffic(text):
    """'5000+', '2만+', '1M+' 같은 표기를 숫자로."""
    if not text:
        return 0
    t = text.replace(",", "").replace("+", "").strip()
    mult = 1
    for suffix, m in (("만", 10_000), ("천", 1_000), ("K", 1_000), ("M", 1_000_000)):
        if t.endswith(suffix):
            t, mult = t[: -len(suffix)], m
            break
    try:
        return int(float(t) * mult)
    except ValueError:
        return 0


def google_trends():
    root = ET.fromstring(fetch(TRENDS_RSS))
    items = []
    for it in root.iter("item"):
        started = None
        pub = it.findtext("pubDate")
        if pub:
            started = email.utils.parsedate_to_datetime(pub).astimezone(KST)
        news = []
        for n in it.findall("ht:news_item", TRENDS_NS):
            news.append({
                "title": (n.findtext("ht:news_item_title", default="", namespaces=TRENDS_NS) or "").strip(),
                "url": n.findtext("ht:news_item_url", default="", namespaces=TRENDS_NS),
                "source": n.findtext("ht:news_item_source", default="", namespaces=TRENDS_NS),
            })
        items.append({
            "keyword": (it.findtext("title") or "").strip(),
            "traffic": parse_traffic(it.findtext("ht:approx_traffic", default="", namespaces=TRENDS_NS)),
            "started": started,
            "news": news,
        })
    return items


def signal_issues():
    data = json.loads(fetch(SIGNAL_API))
    # state: n=새로 진입, +=상승, s=유지, -=하락
    return [{"keyword": x["keyword"].strip(), "rank": x["rank"], "state": x.get("state", "")}
            for x in data.get("top10", [])]


def naver_suggest(q):
    url = ("https://ac.search.naver.com/nx/ac?st=100&r_format=json&r_enc=UTF-8&q_enc=UTF-8&q="
           + urllib.parse.quote(q))
    data = json.loads(fetch(url))
    return [row[0] for group in data.get("items", []) for row in group if row]


def google_suggest(q):
    url = "https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&q=" + urllib.parse.quote(q)
    data = json.loads(fetch(url).decode("utf-8", "replace"))
    return list(data[1]) if len(data) > 1 else []


def suggestions(keyword):
    """키워드 자체와 '키워드 ' (뒤에 공백) 두 번 물어본다. 공백을 붙여야 꼬리 검색어가 잘 나온다."""
    found, errors = [], []
    for fn in (naver_suggest, google_suggest):
        for q in (keyword, keyword + " "):
            try:
                found.extend(fn(q))
            except Exception as e:  # 자동완성 하나 실패해도 나머지로 판정한다
                errors.append(f"{fn.__name__}: {e}")
            time.sleep(0.15)
    seen, uniq = set(), []
    for s in found:
        s = s.strip()
        if s and s not in seen and s != keyword:
            seen.add(s)
            uniq.append(s)
    return uniq, errors


def intent_hits(suggs):
    return [s for s in suggs if any(w in s for w in INTENT_WORDS)]


def score(item, now):
    s = 0.0
    if item["traffic"]:
        s += math.log10(item["traffic"]) * 10          # 500+ ≈ 27, 5000+ ≈ 37, 5만+ ≈ 47
    if item["started"]:
        hours = (now - item["started"]).total_seconds() / 3600
        s += max(0.0, 20 - hours * 2)                    # 막 시작한 이슈일수록 가산 (10시간 지나면 0)
    if item.get("signal_rank"):
        s += 11 - item["signal_rank"]                    # 시그널 1위 +10 … 10위 +1
        if item.get("signal_state") in ("n", "+"):
            s += 5
    s += min(len(item["intent"]), 5) * 6                 # 돈 되는 꼬리 검색어 개수 (최대 5개 반영)
    if item["tragedy"]:
        s -= 30
    return round(s, 1)


def title_idea(item):
    """글 제목 예시. 가장 앞에 나온 꼬리 검색어를 그대로 제목 앞에 둔다(검색어 일치가 제일 중요)."""
    if not item["intent"]:
        return ""
    top = item["intent"][0]
    today = dt.datetime.now(KST)
    return f"{top} 총정리 ({today.month}월 {today.day}일 기준)"


def collect(hours=None):
    now = dt.datetime.now(KST)
    errors = []
    merged = {}

    try:
        for t in google_trends():
            merged[t["keyword"]] = {**t, "sources": ["구글트렌드"]}
    except Exception as e:
        errors.append(f"구글 트렌드 실패: {e}")

    try:
        for s in signal_issues():
            key = s["keyword"]
            row = merged.setdefault(key, {"keyword": key, "traffic": 0, "started": None, "news": [], "sources": []})
            row["sources"].append("시그널")
            row["signal_rank"] = s["rank"]
            row["signal_state"] = s["state"]
    except Exception as e:
        errors.append(f"시그널 실패: {e}")

    items = []
    for row in merged.values():
        if hours is not None and row["started"] and (now - row["started"]).total_seconds() > hours * 3600:
            continue
        suggs, errs = suggestions(row["keyword"])
        errors.extend(f"{row['keyword']} 자동완성 — {e}" for e in errs[:1])
        text = row["keyword"] + " " + " ".join(n["title"] for n in row["news"])
        row["suggestions"] = suggs
        row["intent"] = intent_hits(suggs)
        row["tragedy"] = any(w in text for w in TRAGEDY_WORDS)
        row["score"] = score(row, now)
        row["title_idea"] = title_idea(row)
        items.append(row)

    items.sort(key=lambda r: r["score"], reverse=True)
    return {"generated_at": now, "items": items, "errors": errors}


def ago(started, now):
    if not started:
        return "-"
    mins = int((now - started).total_seconds() // 60)
    return f"{mins}분 전" if mins < 60 else f"{mins // 60}시간 전"


def to_markdown(result, top=10):
    now = result["generated_at"]
    items = result["items"]
    picks = [r for r in items if r["intent"] and not r["tragedy"]]
    lines = [f"# 이슈 키워드 ({now:%m월 %d일 %H:%M} 기준)", ""]

    lines.append("## 지금 쓸 만한 글감")
    if not picks:
        lines.append("- 지금은 '방법·일정·결과'를 찾는 꼬리 검색어가 붙은 이슈가 없어요. 인물·사건 위주 이슈만 떠 있어요.")
    for i, r in enumerate(picks[:5], 1):
        traffic = f"{r['traffic']:,}+" if r["traffic"] else "-"
        lines.append(f"{i}. **{r['keyword']}** — 점수 {r['score']} · 구글 검색 {traffic} · 시작 {ago(r['started'], now)} · {'/'.join(r['sources'])}")
        lines.append(f"   - 꼬리 검색어: {', '.join(r['intent'][:6])}")
        lines.append(f"   - 제목 예시: {r['title_idea']}")
        if r["news"]:
            n = r["news"][0]
            lines.append(f"   - 관련 뉴스: [{n['title']}]({n['url']}) ({n['source']})")
    lines.append("")

    lines.append(f"## 전체 순위 (상위 {top})")
    lines.append("| 키워드 | 점수 | 구글 검색 | 시작 | 출처 | 꼬리 검색어 | 비고 |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in items[:top]:
        note = "사건·사고(광고 부적합)" if r["tragedy"] else ""
        if r.get("signal_state") == "n":
            note = (note + " 신규 진입").strip()
        traffic = f"{r['traffic']:,}+" if r["traffic"] else "-"
        lines.append(f"| {r['keyword']} | {r['score']} | {traffic} | {ago(r['started'], now)} | "
                     f"{'/'.join(r['sources'])} | {', '.join(r['intent'][:3]) or '-'} | {note} |")
    lines.append("")
    lines.append("> 점수 = 검색량 + 신선도 + 시그널 순위 + 꼬리 검색어 개수 − 사건·사고. "
                 "구글 검색량은 구글이 주는 대략치예요. 네이버 검색량은 포함되지 않아요.")
    if result["errors"]:
        lines.append("")
        lines.append("## 수집 오류")
        lines.extend(f"- {e}" for e in result["errors"][:10])
    return "\n".join(lines)


def to_summary(result):
    picks = [r for r in result["items"] if r["intent"] and not r["tragedy"]][:3]
    if not picks:
        return "이슈 키워드: 지금은 글감으로 쓸 만한 키워드가 없어요."
    parts = [f"{r['keyword']}({r['intent'][0]})" for r in picks]
    return ("글감 " + " · ".join(parts))[:200]


def main():
    ap = argparse.ArgumentParser(description="이슈 키워드 탐지기")
    ap.add_argument("--json", action="store_true", help="원자료 JSON 출력")
    ap.add_argument("--summary", action="store_true", help="알림용 한 줄 요약")
    ap.add_argument("--hours", type=float, help="시작한 지 N시간 이내 구글 트렌드 키워드만")
    ap.add_argument("--top", type=int, default=10, help="전체 순위 표에 넣을 개수")
    args = ap.parse_args()

    result = collect(hours=args.hours)
    if args.json:
        out = {**result, "generated_at": result["generated_at"].isoformat(),
               "items": [{**r, "started": r["started"].isoformat() if r["started"] else None} for r in result["items"]]}
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif args.summary:
        print(to_summary(result))
    else:
        print(to_markdown(result, top=args.top))
    if not result["items"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
