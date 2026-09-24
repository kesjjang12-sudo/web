"""새로 허가받은 식품 업체 찾기 (식품안전나라 I2500 인허가 업소 정보).

식품 제조·가공 업체는 문을 열자마자 박스·보냉박스·아이스팩 거래처를 정한다.
아직 거래처가 없는 시기라서 "지금 쓰는 데 있어요"라는 답이 나오지 않는다.

키: 식품안전나라(foodsafetykorea.go.kr) > 데이터활용서비스 > 인증키 신청 (무료).
    환경변수 FOODSAFETY_API_KEY 로 넣는다. 없으면 샘플 키로 5건만 받는다.

사용법:
    python3 new_businesses.py                       # 최근 7일 안에 허가받은 업체
    python3 new_businesses.py --region 서울,경기,인천  # 지역 거르기
    python3 new_businesses.py --days 3 --json
"""

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request

KST = dt.timezone(dt.timedelta(hours=9))
BASE = "http://openapi.foodsafetykorea.go.kr/api/{key}/I2500/json/{start}/{end}/{query}"
PAGE = 1000
MAX_PAGES = 10
MAX_CHANGE_DAYS = 7  # API가 CHNG_DT를 호출일 기준 7일 전까지만 허용한다

# 택배로 식품을 보내서 박스·보냉재가 필요한 업종
INDUSTRIES = [
    "식품제조가공업",
    "즉석판매제조가공업",
    "식육포장처리업",
    "식육즉석판매가공업",
    "축산물가공업",
    "식품소분업",
]


def fetch_page(key, industry, since, start, end):
    query = urllib.parse.urlencode({"INDUTY_CD_NM": industry, "CHNG_DT": since.strftime("%Y%m%d")},
                                   quote_via=urllib.parse.quote)
    url = BASE.format(key=key, start=start, end=end, query=query)
    with urllib.request.urlopen(url, timeout=30) as r:
        body = r.read().decode("utf-8")
    if not body.lstrip().startswith("{"):
        raise RuntimeError(body.strip()[:200])
    data = json.loads(body)["I2500"]
    code = data.get("RESULT", {}).get("CODE", "")
    if code == "INFO-200":  # 해당하는 데이터가 없음
        return 0, []
    if code != "INFO-000":
        raise RuntimeError(f"{code} {data.get('RESULT', {}).get('MSG', '')}")
    return int(data.get("total_count") or 0), data.get("row", [])


def collect(key, industry, since):
    """since 이후에 정보가 바뀐 업체를 모두 받는다 (신규 허가 포함)."""
    rows, start = [], 1
    for _ in range(MAX_PAGES):
        end = start + (5 if key == "sample" else PAGE) - 1
        total, page = fetch_page(key, industry, since, start, end)
        rows.extend(page)
        if key == "sample" or not page or end >= total:
            break
        start = end + 1
    return rows


def find_new(key, days, regions, industries=INDUSTRIES):
    today = dt.datetime.now(KST).date()
    since = today - dt.timedelta(days=days)
    changed_since = today - dt.timedelta(days=min(days, MAX_CHANGE_DAYS))
    found, errors, seen = [], [], set()
    for ind in industries:
        try:
            rows = collect(key, ind, changed_since)
        except Exception as e:  # 한 업종이 실패해도 나머지는 계속한다
            errors.append(f"{ind}: {e}")
            continue
        for r in rows:
            prms = r.get("PRMS_DT") or ""
            if len(prms) != 8 or prms < since.strftime("%Y%m%d"):
                continue  # 정보만 바뀐 오래된 업체는 뺀다
            addr = r.get("ADDR") or ""
            if regions and not any(addr.startswith(g) for g in regions):
                continue
            if r.get("LCNS_NO") in seen:
                continue
            seen.add(r.get("LCNS_NO"))
            found.append({
                "name": r.get("BSSH_NM", "").strip(),
                "industry": r.get("INDUTY_CD_NM", ""),
                "licensed": f"{prms[:4]}-{prms[4:6]}-{prms[6:]}",
                "address": addr,
                "phone": r.get("TELNO", ""),
                "license_no": r.get("LCNS_NO", ""),
            })
    found.sort(key=lambda x: x["licensed"], reverse=True)
    return {"since": since.isoformat(), "today": today.isoformat(), "items": found, "errors": errors}


def to_markdown(res):
    lines = [f"## 신규 허가 식품 업체 ({res['since']} 이후, {len(res['items'])}곳)"]
    if not res["items"]:
        lines.append("- 조건에 맞는 신규 업체가 없어요.")
    for x in res["items"]:
        lines.append(f"- **{x['name']}** · {x['industry']} · {x['address']} · 허가 {x['licensed']}")
    if res["errors"]:
        lines.append(f"- (조회 실패 {len(res['errors'])}건: {'; '.join(res['errors'])[:300]})")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=7, help="최근 며칠 안에 허가받은 업체 (기본 7, API 한도 7)")
    p.add_argument("--region", default=os.environ.get("TARGET_REGIONS", ""),
                   help="쉼표로 구분한 시도 이름 앞부분. 예: 서울,경기,인천")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    key = os.environ.get("FOODSAFETY_API_KEY", "").strip() or "sample"
    regions = [g.strip() for g in a.region.split(",") if g.strip()]
    res = find_new(key, a.days, regions)
    res["key"] = "sample" if key == "sample" else "set"
    if a.json:
        json.dump(res, sys.stdout, ensure_ascii=False, indent=2)
    else:
        if key == "sample":
            print("(샘플 키라 업종마다 5건만 받았어요. FOODSAFETY_API_KEY를 넣으면 전체가 나와요.)\n")
        print(to_markdown(res))


if __name__ == "__main__":
    main()
