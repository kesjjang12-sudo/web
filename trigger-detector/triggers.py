"""포장재 B2B 영업 트리거 감지기.

뉴스(가격·공급·수요 변화)와 시즌 캘린더를 확인해서
"오늘 누구에게 무슨 말로 연락할지"를 마크다운으로 만든다.

사용법:
    python3 triggers.py                 # 오늘 기준, 마크다운 출력
    python3 triggers.py --date 2026-11-01
    python3 triggers.py --json          # 원자료(JSON) 출력
"""

import argparse
import datetime as dt
import email.utils
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

KST = dt.timezone(dt.timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

# 카테고리마다 검색어, 관련성 판정 단어, 영업 액션을 둔다.
# 제목에 must 단어(무슨 품목·업계인지)와 need 단어(무슨 일이 생겼는지)가 모두 있어야 통과한다.
# "박스"처럼 짧은 단어는 엑스박스·박스피 같은 기사가 걸려서 쓰지 않는다.
NEWS_TRIGGERS = [
    {
        "key": "price",
        "label": "가격 변화",
        "queries": ["골판지 가격 인상", "원지 가격 인상", "박스 가격 인상", "스티로폼 가격 인상",
                    "EPS 원료 가격", "포장재 가격 인상", "택배비 인상"],
        "must": ["골판지", "원지", "택배박스", "종이박스", "스티로폼", "EPS", "포장재", "택배비", "제지", "펄프", "폴리스티렌"],
        "need": ["가격", "인상", "단가", "원가", "급등", "상승", "올려", "올린"],
        "action": "기존 거래처가 단가 인상 통보를 할 시점이에요. \"저희는 현재 단가 유지 가능합니다\"로 연락하세요.",
    },
    {
        "key": "supply",
        "label": "공급 차질",
        "queries": ["골판지 수급 차질", "아이스팩 품절", "스티로폼 박스 품절", "제지 공장 가동 중단",
                    "포장재 대란", "골판지 공장 화재"],
        "must": ["골판지", "원지", "택배박스", "종이박스", "스티로폼", "아이스팩", "포장재", "제지", "보냉", "펄프"],
        "need": ["품절", "차질", "중단", "화재", "부족", "파업", "가동", "대란", "수급", "재개"],
        "action": "기존 거래처 납기가 밀릴 수 있어요. \"예비 거래처로 재고 확보해 두었습니다\"로 연락하세요.",
    },
    {
        "key": "demand",
        "label": "수요 급증",
        "queries": ["선물세트 택배 물량", "김장 택배", "절임배추 택배", "폭염 신선식품 배송",
                    "밀키트 매출 증가", "새벽배송 물량 증가", "온라인 신선식품 매출"],
        "must": ["택배", "배송", "선물세트", "김장", "절임배추", "신선", "밀키트", "새벽배송", "저온", "콜드체인"],
        "need": ["물량", "급증", "증가", "수요", "성수기", "특수", "폭증", "쏠림", "매출", "역대"],
        "action": "물량이 늘면 소형 거래처는 못 받쳐줘요. \"성수기 물량 분할 납품 가능합니다\"로 연락하세요.",
    },
]

# (월, 일) 고정 시즌. lead_days 전부터 알림을 띄운다.
FIXED_SEASONS = [
    {"name": "여름 보냉 성수기", "month": 7, "day": 1, "lead_days": 30,
     "who": "신선식품·정육·수산·케이크 셀러",
     "pitch": "여름 들어서면 아이스팩·스티로폼이 먼저 동나요. 6월 안에 재고 잡아두시죠."},
    {"name": "김장철 (김치·절임배추 택배)", "month": 11, "day": 10, "lead_days": 30,
     "who": "김치 제조사·농가 직거래·반찬가게",
     "pitch": "김장철엔 스티로폼 박스가 제일 먼저 부족해요. 10월 안에 물량 예약 받고 있습니다."},
    {"name": "연말 택배 성수기", "month": 11, "day": 25, "lead_days": 21,
     "who": "온라인 쇼핑몰·풀필먼트",
     "pitch": "블랙프라이데이부터 연말까지 박스 발주가 몰려요. 분할 납품으로 미리 잡아두시죠."},
    {"name": "어버이날 선물 배송", "month": 5, "day": 8, "lead_days": 21,
     "who": "선물세트·케이크·꽃 판매처",
     "pitch": "5월 초 선물 배송 물량 대비해서 보냉박스·선물박스 재고 확보해 드릴게요."},
]

# 음력 명절은 해마다 날짜가 바뀌어서 직접 적는다.
HOLIDAYS = [
    ("설날", dt.date(2026, 2, 17)),
    ("추석", dt.date(2026, 9, 25)),
    ("설날", dt.date(2027, 2, 6)),
    ("추석", dt.date(2027, 9, 15)),
    ("설날", dt.date(2028, 1, 26)),
    ("추석", dt.date(2028, 10, 3)),
]
HOLIDAY_WINDOWS = [
    (45, 22, "선물세트 준비기",
     "신선·가공식품 선물세트 판매처",
     "{name} 선물세트 포장 준비하실 때죠. 보냉박스·아이스팩 이번 주에 잡아두시면 명절 직전 품절 걱정 없어요."),
    (21, 3, "명절 직전 긴급 물량",
     "선물세트 판매처 중 기존 거래처 납기가 밀린 곳",
     "{name} 앞두고 박스·아이스팩 급하게 필요하시면 바로 출고 가능합니다."),
]


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def google_news(query, days=7):
    q = urllib.parse.quote(f"{query} when:{days}d")
    url = f"https://news.google.com/rss/search?q={q}&hl=ko&gl=KR&ceid=KR:ko"
    root = ET.fromstring(fetch(url))
    items = []
    for it in root.iter("item"):
        raw = html.unescape(it.findtext("title") or "")
        src = it.findtext("source") or ""
        title = raw
        if src and raw.endswith(" - " + src):
            title = raw[: -len(" - " + src)]
        pub = it.findtext("pubDate")
        when = email.utils.parsedate_to_datetime(pub).astimezone(KST) if pub else None
        items.append({"title": title.strip(), "source": src, "link": it.findtext("link") or "",
                      "published": when.isoformat() if when else None})
    return items


def tokens(text):
    return set(w for w in re.findall(r"[가-힣A-Za-z0-9]+", text) if len(w) > 1)


def is_dup(title, seen):
    t = tokens(title)
    for s in seen:
        u = t | s
        if u and len(t & s) / len(u) >= 0.5:
            return True
    return False


def news_triggers(days=7, per_category=5):
    out = []
    for cat in NEWS_TRIGGERS:
        pool, errors = [], []
        for q in cat["queries"]:
            try:
                pool.extend(google_news(q, days))
            except Exception as e:  # 한 검색어가 실패해도 나머지는 계속한다
                errors.append(f"{q}: {e}")
        pool = [n for n in pool
                if any(m in n["title"] for m in cat["must"]) and any(w in n["title"] for w in cat["need"])]
        pool.sort(key=lambda n: n["published"] or "", reverse=True)
        picked, seen = [], []
        for n in pool:
            if is_dup(n["title"], seen):
                continue
            seen.append(tokens(n["title"]))
            picked.append(n)
            if len(picked) >= per_category:
                break
        out.append({"key": cat["key"], "label": cat["label"], "action": cat["action"],
                    "items": picked, "errors": errors})
    return out


def season_triggers(today):
    hits = []
    for s in FIXED_SEASONS:
        for year in (today.year, today.year + 1):
            peak = dt.date(year, s["month"], s["day"])
            left = (peak - today).days
            if 0 <= left <= s["lead_days"]:
                hits.append({"name": s["name"], "days_left": left, "who": s["who"], "pitch": s["pitch"]})
    for name, day in HOLIDAYS:
        left = (day - today).days
        for start, end, stage, who, pitch in HOLIDAY_WINDOWS:
            if end <= left <= start:
                hits.append({"name": f"{name} {stage}", "days_left": left, "who": who,
                             "pitch": pitch.format(name=name)})
    hits.sort(key=lambda h: h["days_left"])
    return hits


def upcoming(today, horizon=120):
    """앞으로 다가올 시즌 목록(알림 창이 열리는 날짜 기준)."""
    rows = []
    for s in FIXED_SEASONS:
        for year in (today.year, today.year + 1):
            peak = dt.date(year, s["month"], s["day"])
            opens = peak - dt.timedelta(days=s["lead_days"])
            if today < opens <= today + dt.timedelta(days=horizon):
                rows.append((opens, s["name"]))
    for name, day in HOLIDAYS:
        opens = day - dt.timedelta(days=HOLIDAY_WINDOWS[0][0])
        if today < opens <= today + dt.timedelta(days=horizon):
            rows.append((opens, f"{name} 선물세트 준비기"))
    return sorted(rows)


def to_markdown(today, seasons, news, soon, days=7):
    wd = "월화수목금토일"[today.weekday()]
    lines = [f"기준일: {today.isoformat()} ({wd})", ""]

    lines.append("## 시즌 트리거")
    if seasons:
        for s in seasons:
            lines.append(f"- **{s['name']}** (D-{s['days_left']})")
            lines.append(f"  - 연락 대상: {s['who']}")
            lines.append(f"  - 멘트: \"{s['pitch']}\"")
    else:
        lines.append("- 오늘은 시즌 알림이 없어요.")
    if soon:
        lines.append("")
        lines.append("다가오는 시즌: " + " · ".join(f"{d.month}/{d.day}부터 {n}" for d, n in soon))
    lines.append("")

    lines.append(f"## 뉴스 트리거 (최근 {days}일)")
    for cat in news:
        lines.append(f"### {cat['label']} ({len(cat['items'])}건)")
        if cat["items"]:
            lines.append(f"영업 액션: {cat['action']}")
            for n in cat["items"]:
                day = n["published"][:10] if n["published"] else ""
                lines.append(f"- [{n['title']}]({n['link']}) · {n['source']} · {day}")
        else:
            lines.append("- 관련 기사 없음")
        if cat["errors"]:
            lines.append(f"- (수집 실패 {len(cat['errors'])}건)")
        lines.append("")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--date", help="기준일 YYYY-MM-DD (기본: 오늘, 한국시간)")
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    today = dt.date.fromisoformat(a.date) if a.date else dt.datetime.now(KST).date()

    seasons = season_triggers(today)
    news = news_triggers(a.days)
    soon = upcoming(today)
    if a.json:
        json.dump({"date": today.isoformat(), "seasons": seasons, "news": news,
                   "upcoming": [(d.isoformat(), n) for d, n in soon]},
                  sys.stdout, ensure_ascii=False, indent=2)
    else:
        print(to_markdown(today, seasons, news, soon, a.days))


if __name__ == "__main__":
    main()
