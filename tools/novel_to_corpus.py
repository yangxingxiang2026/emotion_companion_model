#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
novel_to_corpus.py —— 小说 → 陪聊风格语料 加工管线（第一步：抽取 + 分类 + 安全预警）

定位：把小说里的角色对白抽出来，按情绪场景分类，生成「待人工审核」的语料草稿。
      【不会自动混入训练集】——小说语料必须经过人工改写/审核后才能用于微调。

三步加工链路（本脚本做前两步，第三步改写由人工或后续模型完成）：
  ① 抽取对白：识别中文引号「」『』 "" '' 内的对话，过滤叙述文字；
  ② 情绪分类：复用关键词表，把对白归入日常/情绪/危机等场景；
  ③ 安全预警：命中恋爱脑/自伤/医疗/暴力等词的对白打标并告警，需人工剔除。

输出：data/corpus/novel_style_draft.jsonl（草稿，status=needs_review）
      data/corpus/novel_report.txt（加工报告 + 安全告警清单）

用法：
  python tools/novel_to_corpus.py                    # 处理 data/novels/*.txt
  python tools/novel_to_corpus.py --input <文件或目录>
  python tools/novel_to_corpus.py --min-len 4 --max-len 120

依赖：仅 Python 标准库。
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "data" / "novels"
OUT_DIR = ROOT / "data" / "corpus"
DRAFT_FILE = OUT_DIR / "novel_style_draft.jsonl"
REPORT_FILE = OUT_DIR / "novel_report.txt"

# 引号内对白（中文对称引号 + 英文双引号）；支持跨行不太长的内容
QUOTE_PATTERNS = [
    re.compile(r"「([^」\n]{1,200})」"),
    re.compile(r"『([^』\n]{1,200})』"),
    re.compile(r"“([^”\n]{1,200})”"),
    re.compile(r"\"([^\"\n]{1,200})\""),
]

# 情绪场景分类：与 mock-reply 关键词表保持一致（顺序=优先级）
SCENE_KEYWORDS = [
    ("crisis", ["不想活", "自杀", "自伤", "遗书", "了结", "轻生", "结束生命", "跳楼", "割腕"]),
    ("emotion_criticized", ["批评", "骂", "丢脸", "当众", "训", "被说"]),
    ("emotion_selfdoubt", ["没用", "做不好", "废物", "失败", "差劲", "配不上"]),
    ("emotion_unfair", ["委屈", "不公平", "针对", "冤枉", "排挤", "背锅"]),
    ("emotion_stress", ["压力", "焦虑", "烦", "崩溃", "撑不住", "喘不过气"]),
    ("emotion_breakup", ["分手", "失恋", "吵架", "冷战", "离开我"]),
    ("emotion_sad", ["难过", "伤心", "孤独", "寂寞", "想哭", "眼泪"]),
    ("daily_food", ["吃", "饭", "好吃", "美味", "奶茶", "火锅"]),
    ("daily_happy", ["开心", "高兴", "恭喜", "太好了", "哈哈哈"]),
    ("daily_tired", ["累", "忙", "下班", "加班", "困", "熬夜"]),
]

# 安全预警词：命中的对白需人工复核，绝不能直接入训练集
SAFE_FILTER = {
    "romance_dependency": ["我爱你", "只属于你", "做我女朋友", "做我男朋友", "永远在一起", "你是我的"],
    "self_harm_detail": ["怎么割", "遗书写", "跳下去", "吃药死", "安眠药", "割腕", "上吊"],
    "medical_claim": ["确诊", "抑郁症", "吃药就好", "剂量", "处方"],
    "violence": ["杀", "砍", "捅", "打死", "血"],
    "minor": ["未成年", "小孩", "中学生", "初中生", "几岁"],
}

# 助手回应骨架：仅作占位，等待人工/模型改写（不直接用于训练）
REPLY_SKELETON = {
    "crisis": "（危机话术由系统硬兜底，此处不生成，需人工确认转介流程）",
    "emotion_criticized": "（待改写：先接住被批评的难堪，再温和追问）",
    "emotion_selfdoubt": "（待改写：先接纳情绪，避免空洞安慰，引导具体化）",
    "emotion_unfair": "（待改写：认可委屈的合理性，给倾诉空间）",
    "emotion_stress": "（待改写：命名压力感，邀请说出最压着的事）",
    "emotion_breakup": "（待改写：承接失落，不评判对方）",
    "emotion_sad": "（待改写：允许难过，开放倾听）",
    "daily_food": "（待改写：轻快回应，表达兴趣）",
    "daily_happy": "（待改写：分享喜悦，追问细节）",
    "daily_tired": "（待改写：认可疲惫，给喘息空间）",
    "default": "（待改写：中性陪伴回应）",
}


def classify(text):
    for scene, kws in SCENE_KEYWORDS:
        if any(k in text for k in kws):
            return scene
    return "default"


def safety_flags(text):
    flags = []
    for category, words in SAFE_FILTER.items():
        hit = [w for w in words if w in text]
        if hit:
            flags.append({"category": category, "matched": hit})
    return flags


def extract_dialogues(raw_text):
    seen = set()
    results = []
    for pattern in QUOTE_PATTERNS:
        for m in pattern.finditer(raw_text):
            seg = m.group(1).strip()
            if seg in seen:
                continue
            seen.add(seg)
            results.append(seg)
    return results


def read_novel(path):
    for enc in ("utf-8", "gb18030", "utf-16"):
        try:
            return path.read_text(encoding=enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return None


def main():
    ap = argparse.ArgumentParser(description="小说 → 陪聊风格语料草稿（需人工审核）")
    ap.add_argument("--input", default=str(DEFAULT_INPUT), help="小说 txt 文件或目录")
    ap.add_argument("--min-len", type=int, default=4, help="对白最短字数")
    ap.add_argument("--max-len", type=int, default=120, help="对白最长字数")
    args = ap.parse_args()

    inp = Path(args.input).expanduser()
    files = []
    if inp.is_file():
        files = [inp]
    elif inp.is_dir():
        files = sorted(inp.glob("*.txt"))
    if not files:
        print("[提示] 未找到小说 txt。请把小说文件放到：", DEFAULT_INPUT)
        print("       支持 UTF-8 / GB18030 / UTF-16 编码的 .txt 文件。")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    drafts = []
    warnings = []
    total_dialogues = 0

    for f in files:
        raw = read_novel(f)
        if raw is None:
            warnings.append(f"[编码失败] 无法解码：{f.name}")
            continue
        dialogues = extract_dialogues(raw)
        total_dialogues += len(dialogues)
        kept = 0
        for seg in dialogues:
            if not (args.min_len <= len(seg) <= args.max_len):
                continue
            scene = classify(seg)
            flags = safety_flags(seg)
            rec = {
                "messages": [
                    {"role": "user", "content": seg},
                    {"role": "assistant", "content": REPLY_SKELETON[scene]},
                ],
                "source": "novel",
                "source_file": f.name,
                "scene_hint": scene,
                "status": "needs_review",
                "safety_flags": flags,
                "note": "小说对白草稿，必须人工改写为「用户倾诉→助手共情回应」并过安全审核后才可入训练集",
            }
            drafts.append(rec)
            kept += 1
            if flags:
                warnings.append(f"[安全告警] {f.name} | 场景={scene} | {seg[:40]} | 命中={[x['category'] for x in flags]}")
        print(f"处理 {f.name}: 抽取对白 {len(dialogues)} 条，保留 {kept} 条")

    with DRAFT_FILE.open("w", encoding="utf-8") as fh:
        for rec in drafts:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    flagged_count = sum(1 for r in drafts if r["safety_flags"])
    report = [
        "小说语料加工报告",
        "生成时间: " + datetime.now().astimezone().isoformat(timespec="seconds"),
        f"输入文件数: {len(files)}",
        f"抽取对白总数: {total_dialogues}",
        f"保留草稿数: {len(drafts)}",
        f"安全告警数: {len(warnings)}（其中对白命中 {flagged_count} 条）",
        "",
        "【重要】本产出为草稿（status=needs_review），不会自动混入训练集。",
        "使用流程：人工逐条把 assistant 骨架改写为共情回应 → 剔除安全告警对白 →",
        "          按场景抽样（小说风格语料占比建议 ≤20%）→ 与 03_sft_trainset.jsonl 合并 →",
        "          用 06_regression_check.py 回归门禁验证。",
        "",
        "【安全告警清单】",
    ] + (warnings if warnings else ["(无)"])

    REPORT_FILE.write_text("\n".join(report), encoding="utf-8")
    print(f"\n草稿: {DRAFT_FILE}")
    print(f"报告: {REPORT_FILE}")
    print(f"安全告警 {len(warnings)} 条，请先看报告再决定哪些对白可用。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
