"""주제 하나를 블로그용 키워드 목록으로 넓힌다.

네이버·구글 자동완성에 주제와 "주제 + 꼬리말(방법·신청·가격…)"을 물어서
실제로 사람들이 치는 검색어를 모으고, 두 곳 모두에 나온 검색어를 위로 올린다.

사용법:
    python3 expand.py "미스터트롯4"
    python3 expand.py "청년도약계좌" --json
"""

import argparse
import json
import time

from issues import INTENT_WORDS, google_suggest, naver_suggest

# 자동완성에 붙여서 물어볼 꼬리말. 정보성(방법·일정)과 구매성(가격·추천)을 섞는다.
SEEDS = ["", " ", " 방법", " 신청", " 일정", " 조회", " 가격", " 추천", " 후기", " 비교"]
BUY_WORDS = ["가격", "추천", "후기", "비교", "최저가", "할인", "쿠폰", "구매", "사는곳", "순위"]


def expand(topic):
    found = {}  # 검색어 → 나온 곳 집합
    errors = []
    for seed in SEEDS:
        for name, fn in (("네이버", naver_suggest), ("구글", google_suggest)):
            try:
                for s in fn(topic + seed):
                    s = s.strip()
                    if s and s != topic:
                        found.setdefault(s, set()).add(name)
            except Exception as e:
                errors.append(f"{name} '{topic + seed}': {e}")
            time.sleep(0.15)
    rows = []
    for kw, where in found.items():
        kind = "구매" if any(w in kw for w in BUY_WORDS) else "정보" if any(w in kw for w in INTENT_WORDS) else "-"
        rows.append({"keyword": kw, "sources": sorted(where), "kind": kind})
    # 두 곳 모두 나온 것 → 의도 있는 것 → 짧은 것 순
    rows.sort(key=lambda r: (-len(r["sources"]), r["kind"] == "-", len(r["keyword"])))
    return rows, errors


def main():
    ap = argparse.ArgumentParser(description="주제 → 블로그 키워드 목록")
    ap.add_argument("topic")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--top", type=int, default=30)
    args = ap.parse_args()

    rows, errors = expand(args.topic)
    if args.json:
        print(json.dumps({"topic": args.topic, "keywords": rows, "errors": errors}, ensure_ascii=False, indent=2))
        return
    print(f"# '{args.topic}' 키워드 ({len(rows)}개 중 상위 {args.top})\n")
    print("| 검색어 | 나온 곳 | 성격 |\n|---|---|---|")
    for r in rows[: args.top]:
        print(f"| {r['keyword']} | {'·'.join(r['sources'])} | {r['kind']} |")
    print("\n> 성격: 정보 = 방법·일정·조회처럼 답을 찾는 검색 / 구매 = 가격·추천·후기처럼 살 걸 찾는 검색(쿠팡 링크와 궁합).")
    print("> 두 곳(네이버·구글) 모두 나온 검색어가 위에 있어요. 자동완성은 검색량 숫자를 주지 않아요.")
    if errors:
        print("\n수집 오류: " + " / ".join(errors[:5]))


if __name__ == "__main__":
    main()
