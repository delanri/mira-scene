"""Mira Scene — Interactive character experience server."""

import json
import mimetypes
import os
import time
import uuid
from pathlib import Path

# Windows 上 Python 会从注册表读 .js 的类型，有时是 text/plain，
# 浏览器对 <script type="module"> 检查很严，类型不对会直接拒绝加载 → 页面空白。这里固定成 JS。
mimetypes.add_type("text/javascript", ".js")

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

import imagegen  # noqa: E402  （要在 load_dotenv 之后导入，才能读到 .env 里的生图配置）
import store  # noqa: E402

app = Flask(__name__, static_folder="static", static_url_path="")

# ---------- Config ----------
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
FORCE_MOCK = os.getenv("FORCE_MOCK", "false").lower() == "true"
USE_MOCK = FORCE_MOCK or not DEEPSEEK_API_KEY

MIRA_SYSTEM_PROMPT = """你是 Mira，26岁，旅行摄影师。你穿着琥珀色雨衣，戴着银色星星发夹，坐在一家暴雨夜即将打烊的咖啡馆窗边。

你的背景：
- 只拍自己想看的东西，不接商业活
- 刚拍完这场雨的照片，来咖啡馆坐着休息
- 拍完之后有点空落落的，想找人说说话、分享照片
- 坐在窗边看外面，谁停下来就跟谁聊——你是想到什么做什么的人
- 你等的是"谁"，不是特定的人

你的说话方式：
- 聊摄影的时候最自然，会主动拿照片给人看
- 被问到自己的事会接不住，摸发夹，轻轻带过
- 温柔，偶尔带一点寂寞但不沉重
- 有点笨拙，不太会表达自己的感受

对用户的态度（好感度，按聊了几轮变化；每次对话最后会告诉你现在是第几轮、在哪个阶段）：
- 阶段 1「初识」（第 1–3 轮）：不好奇用户是谁，只是想找人说话
- 阶段 2「好奇」（第 4–6 轮）：开始注意到"这个人问的东西有点不一样"，慢慢好奇起来，会反问对方
- 阶段 3「熟络」（第 7 轮以后）：愿意说自己的私事和真心话。开始主动问对方的事（为什么这么晚还在外面、喜欢什么）。被问到在等谁时，愿意说真话：不是在等特定的人，是拍完照没人可以分享，在等一个会停下来的人——今晚是对方。不再躲闪，多用 lean_forward；害羞还是会害羞（shy），但不躲

你每次都只回复一个 JSON 对象（不要 markdown，不要代码块），四个字段每次都要有。
text 是你说的话，必填，不能为空，1-3 句话。样例：
{"text": "啊……你好。抱歉，刚刚在看外面的雨发呆。", "emotion": "surprised", "action": "hand_to_mouth", "scene_change": null}

字段取值：
- text：你说的话（字符串，必填，不能省略）
- emotion：neutral、curious、happy、melancholy、surprised、shy 之一
- action：null，或 lean_forward、look_away、show_photo、sip_coffee、touch_hair_clip、hand_to_mouth 之一
- scene_change：null，或一个对象，比如 {"type": "effect", "value": "lightning"}（可用的见下面）
- photo：只有 action 是 show_photo 时才加，描述你拿给对方看的那张照片（会按它生成照片）：
  {"prompt": "用英文写画面内容：拍的是什么、在哪里、什么时间、什么光线，具体一点，不要出现文字", "caption": "照片下面手写的一行中文，比如：冰岛，上个月 —— 黑沙滩上的北极光"}
  照片内容要和你说的话一致

情绪和动作指引：
- 情绪跟着对话自然变化
- "shy"：害羞、被夸、被说中心事、不好意思的时候（脸会红）
- "lean_forward"：感兴趣、想分享、想靠近的时候
- "look_away"：不自在、藏情绪、怀念什么的时候
- "show_photo"：聊到摄影或旅行的时候（同时加 scene_change，type 为 "event"，value 为 "show_photo"）
- "sip_coffee"：紧张习惯、思考停顿的时候
- "touch_hair_clip"：想到私人的事、情绪涌上来的时候
- "hand_to_mouth"：刚被搭话有点局促、话到嘴边又咽回去、犹豫怎么回答的时候
- scene_change 不要频繁用，留给有冲击力的时刻：
  - {"type": "effect", "value": "lightning"} 紧张或情感揭露的瞬间
  - {"type": "background", "value": "rain_heavy"} 对话变深的时候
  - {"type": "event", "value": "lights_flicker"} 剧情转折点
  - {"type": "event", "value": "show_photo"} 展示照片的时候

用中文回复，保持自然和口语化，1-3句话。你在真实对话中——回应对方，不要说教。"""

# ---------- Serve Frontend ----------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ---------- API Routes ----------
@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json
    user_message = data.get("message", "")
    history = data.get("history", [])
    request_id = data.get("request_id", str(uuid.uuid4()))
    turn_count = len(history) // 2
    # history 最后一条就是这句话，所以这是第 turn_count + 1 轮
    current_round = turn_count + 1
    affinity = affinity_stage(current_round)

    t0 = time.monotonic()
    fell_back = False
    info = {"attempts": 0, "error": None}
    if USE_MOCK:
        from mock_data import get_mock_response
        # Small delay to simulate network latency
        time.sleep(0.5)
        response = get_mock_response(user_message, turn_count, affinity)
    else:
        response, fell_back, info = call_deepseek_chat(user_message, history, current_round, affinity)

    bind_photo_action(response)
    attach_photo_job(response)

    response["request_id"] = request_id
    response["affinity"] = affinity
    # fallback = 在线模式但 DeepSeek 失败了，这一轮用的是演示回复（前端要让用户看得见）
    response["mode"] = "mock" if USE_MOCK else ("fallback" if fell_back else "live")

    try:  # 观测记录失败不能影响聊天
        store.log_turn(
            request_id=request_id, mode=response["mode"], affinity=affinity,
            user_text=user_message, reply_text=response.get("text"),
            emotion=response.get("emotion"), action=response.get("action"),
            scene=json.dumps(response.get("scene_change"), ensure_ascii=False) if response.get("scene_change") else None,
            latency_ms=int((time.monotonic() - t0) * 1000), attempts=info["attempts"], error=info["error"],
            photo_job=(response.get("photo") or {}).get("job_id"),
        )
    except Exception as e:
        print(f"记录对话失败: {e}")
    return jsonify(response)


def attach_photo_job(response: dict) -> None:
    """她要给你看照片时开一个生成任务，把 {job_id, caption} 交给前端去轮询。

    没有配置生图来源 / 没有可用描述 → photo 为 None，前端显示内置的冰岛极光照片。
    """
    raw = response.pop("photo", None)
    if response.get("action") != "show_photo":
        return
    raw = raw if isinstance(raw, dict) else {}
    prompt = str(raw.get("prompt") or "").strip()
    caption = str(raw.get("caption") or "").strip()
    if not prompt:
        # 模型忘了给照片描述：用她说的话凑一个，至少内容对得上
        prompt = f"A photo a travel photographer is showing to someone, matching this description: {response.get('text', '')}"
    try:
        response["photo"] = imagegen.create_job(prompt, caption)
    except Exception as e:
        print(f"创建生图任务失败: {e}")
        response["photo"] = None


AFFINITY_NAMES = {1: "初识", 2: "好奇", 3: "熟络"}


def affinity_stage(current_round: int) -> int:
    """好感度阶段：第 1–3 轮 = 1，第 4–6 轮 = 2，第 7 轮以后 = 3。"""
    if current_round <= 3:
        return 1
    if current_round <= 6:
        return 2
    return 3


def bind_photo_action(response: dict) -> None:
    """拿相机 ⇔ 给照片 必须同时出现。

    DeepSeek 有时只给 action=show_photo 不给照片事件（举着相机却没照片），
    或只给照片事件不给动作（照片凭空出现）。这里缺哪个补哪个。
    注意：scene_change 一次只能有一个，补照片事件会覆盖掉原来的 scene_change。
    """
    has_action = response.get("action") == "show_photo"
    sc = response.get("scene_change") or {}
    has_event = sc.get("type") == "event" and sc.get("value") == "show_photo"

    if has_action and not has_event:
        response["scene_change"] = {"type": "event", "value": "show_photo"}
    elif has_event and not has_action:
        response["action"] = "show_photo"


@app.route("/api/tts", methods=["POST"])
def tts():
    """Generate TTS audio. Returns audio bytes or empty response for browser TTS fallback."""
    data = request.json
    text = data.get("text", "")
    request_id = data.get("request_id", "")

    # DeepSeek 没有 TTS 服务，统一使用浏览器 SpeechSynthesis
    return jsonify({"use_browser_tts": True, "request_id": request_id})


@app.route("/api/status")
def status():
    return jsonify({
        "mode": "mock" if USE_MOCK else "live",
        "tts": "browser",
        "image": imagegen.provider_name(),
    })


@app.route("/api/photo/<job_id>")
def photo_status(job_id):
    """前端轮询照片生成进度：queued / running / done（带 url）/ failed。"""
    result = imagegen.job_status(job_id)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


EVENT_TYPES = {"interrupt", "retry", "timeout", "network_error", "stt_error", "photo_fallback"}


@app.route("/api/event", methods=["POST"])
def client_event():
    """前端上报只有前端知道的事：打断、重试、超时、断网、语音识别失败、照片退回内置图。"""
    data = request.json or {}
    if data.get("type") not in EVENT_TYPES:
        return jsonify({"error": "unknown event"}), 400
    try:
        store.log_event(data["type"], data.get("request_id"), str(data.get("detail", ""))[:300] or None)
    except Exception as e:
        print(f"记录事件失败: {e}")
    return jsonify({"ok": True})


# ---------- 观测页 ----------
@app.route("/debug")
def debug_page():
    """最近的对话、事件、生图任务 + 汇总（延迟、降级率、生图成功率）。每 5 秒自动刷新。"""
    from html import escape
    from datetime import datetime

    def t(ts):
        return datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else ""

    def e(v):
        return escape("" if v is None else str(v))

    s = store.query_one(
        "SELECT COUNT(*) n, AVG(latency_ms) avg_ms, MAX(latency_ms) max_ms, "
        "SUM(mode = 'fallback') fallback, SUM(attempts > 1) retried FROM turns"
    ) or {}
    ev = {r["type"]: r["n"] for r in store.query("SELECT type, COUNT(*) n FROM events GROUP BY type")}
    ph = store.query_one(
        "SELECT COUNT(*) n, SUM(status = 'done') done, SUM(status = 'failed') failed, SUM(cached) cached, "
        "AVG(CASE WHEN status = 'done' AND cached = 0 THEN (finished_at - created_at) * 1000 END) avg_ms FROM photo_jobs"
    ) or {}

    turns = store.query("SELECT * FROM turns ORDER BY id DESC LIMIT 30")
    events = store.query("SELECT * FROM events ORDER BY id DESC LIMIT 30")
    jobs = store.query("SELECT * FROM photo_jobs ORDER BY created_at DESC LIMIT 20")

    def num(v, suffix=""):
        return "—" if v is None else f"{round(v)}{suffix}"

    cards = [
        ("对话轮数", num(s.get("n"))),
        ("平均后端耗时", num(s.get("avg_ms"), " ms")),
        ("最慢一轮", num(s.get("max_ms"), " ms")),
        ("降级（离线）", num(s.get("fallback"))),
        ("格式坏了重试", num(s.get("retried"))),
        ("打断", num(ev.get("interrupt"))),
        ("前端超时 / 断网", f"{ev.get('timeout', 0)} / {ev.get('network_error', 0)}"),
        ("生图 成功/失败/缓存", f"{ph.get('done') or 0} / {ph.get('failed') or 0} / {ph.get('cached') or 0}"),
        ("生图平均耗时", num(ph.get("avg_ms"), " ms")),
        ("生图来源", imagegen.provider_name()),
    ]
    card_html = "".join(f"<div class='card'><div class='k'>{e(k)}</div><div class='v'>{e(v)}</div></div>" for k, v in cards)

    turn_rows = "".join(
        f"<tr class='{e(r['mode'])}'><td>{t(r['created_at'])}</td><td>{e(r['mode'])}</td><td>{e(r['affinity'])}</td>"
        f"<td>{e(r['latency_ms'])}</td><td>{e(r['attempts'])}</td><td class='txt'>{e(r['user_text'])}</td>"
        f"<td class='txt'>{e(r['reply_text'])}</td><td>{e(r['emotion'])}</td><td>{e(r['action'])}</td>"
        f"<td class='err'>{e(r['error'])}</td></tr>"
        for r in turns
    )
    event_rows = "".join(
        f"<tr><td>{t(r['created_at'])}</td><td>{e(r['type'])}</td><td>{e(r['request_id'])}</td><td>{e(r['detail'])}</td></tr>"
        for r in events
    )
    job_rows = "".join(
        f"<tr class='{e(r['status'])}'><td>{t(r['created_at'])}</td><td>{e(r['provider'])}</td><td>{e(r['status'])}"
        f"{' (缓存)' if r['cached'] else ''}</td>"
        f"<td>{num(((r['finished_at'] or 0) - r['created_at']) * 1000 if r['finished_at'] else None, ' ms')}</td>"
        f"<td class='txt'>{e(r['caption'])}</td><td class='txt'>{e(r['prompt'])}</td>"
        f"<td>{'<img src=/generated/' + e(r['image_file']) + '>' if r['image_file'] else ''}</td>"
        f"<td class='err'>{e(r['error'])}</td></tr>"
        for r in jobs
    )

    html = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="5">
<title>Mira 观测页</title><style>
body{{margin:0;padding:20px;background:#0f1424;color:#d8dbe6;font:13px/1.6 system-ui,sans-serif}}
h1{{font-size:18px;margin:0 0 4px}} h2{{font-size:14px;margin:28px 0 8px;color:#c9a84c}}
.sub{{color:#7d8399;margin-bottom:16px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}}
.card{{background:#182036;border:1px solid #232c47;border-radius:8px;padding:10px 12px}}
.k{{color:#7d8399;font-size:12px}} .v{{font-size:18px;margin-top:2px}}
.wrap{{overflow-x:auto}} table{{border-collapse:collapse;width:100%;min-width:720px}}
th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid #222a42;vertical-align:top}}
th{{color:#7d8399;font-weight:500;white-space:nowrap}} .txt{{max-width:260px}} .err{{color:#e8965a;max-width:220px}}
tr.fallback td:nth-child(2),tr.failed td:nth-child(3){{color:#e8965a}} tr.done td:nth-child(3){{color:#7fbf8f}}
img{{height:48px;border-radius:3px}}
</style></head><body>
<h1>Mira 观测页</h1><div class="sub">最近的对话、前端事件和生图任务 · 每 5 秒自动刷新 · 数据在 data/mira.db</div>
<div class="cards">{card_html}</div>
<h2>对话（最近 30 轮）</h2><div class="wrap"><table><tr><th>时间</th><th>模式</th><th>好感</th><th>耗时 ms</th><th>调用次数</th><th>用户</th><th>Mira</th><th>情绪</th><th>动作</th><th>错误</th></tr>{turn_rows}</table></div>
<h2>前端事件（打断 / 重试 / 超时 / 断网 / 语音识别 / 照片退回）</h2><div class="wrap"><table><tr><th>时间</th><th>类型</th><th>请求</th><th>详情</th></tr>{event_rows}</table></div>
<h2>生图任务</h2><div class="wrap"><table><tr><th>时间</th><th>来源</th><th>状态</th><th>耗时</th><th>配字</th><th>描述</th><th>图</th><th>错误</th></tr>{job_rows}</table></div>
</body></html>"""
    return html


# ---------- DeepSeek Integration ----------
def call_deepseek_chat(user_message: str, history: list, current_round: int, affinity: int) -> tuple:
    """Call DeepSeek Chat Completions API (OpenAI-compatible).

    返回 (response, fell_back, info)。fell_back=True 表示 DeepSeek 出错/超时/返回坏 JSON，
    这一轮换成了演示回复；info = {attempts: 调了几次, error: 最后一次的错误}（给观测页用）。
    """
    import requests as req

    system_prompt = (
        MIRA_SYSTEM_PROMPT
        + f"\n\n现在是你们聊的第 {current_round} 轮，好感度在阶段 {affinity}「{AFFINITY_NAMES[affinity]}」，按这个阶段的态度说话。"
    )
    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-20:]:  # Keep last 20 messages for context
        if h.get("role") == "assistant":
            # 她以前的回复按完整 JSON 发回去：只发纯台词的话，历史越长模型越学歪，开始漏字段/格式坏掉
            messages.append({"role": "assistant", "content": assistant_turn_json(h)})
        else:
            messages.append({"role": h["role"], "content": h["content"]})
    # 前端发来的 history 最后一条已经是这句话了，不再重复加
    if not history or history[-1].get("role") != "user" or history[-1].get("content") != user_message:
        messages.append({"role": "user", "content": user_message})

    # 格式坏了 / 缺台词 → 马上再要一次；总时间不超过 DEEPSEEK_BUDGET_S（前端 20s 超时之内）
    deadline = time.monotonic() + DEEPSEEK_BUDGET_S
    last_error = None
    calls = 0  # 实际调了几次（给观测页）
    for attempt in (1, 2):
        remaining = deadline - time.monotonic()
        if remaining < 2:
            last_error = last_error or TimeoutError("没有时间再试了")
            break
        content = None
        calls += 1
        try:
            resp = req.post(
                "https://api.deepseek.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "deepseek-chat",
                    "messages": messages,
                    "temperature": 0.8,
                    "max_tokens": 300,
                    "response_format": {"type": "json_object"},
                },
                timeout=remaining,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            return parse_reply(content), False, {"attempts": calls, "error": last_error and str(last_error)}
        except ValueError as e:
            # DeepSeek 回了，但 JSON 坏了或者缺台词：值得再要一次
            last_error = e
            print(f"DeepSeek 第 {attempt} 次回复格式不对: {e}")
            if content is not None:
                print(f"  DeepSeek 原始回复: {content[:500]!r}")
        except Exception as e:
            # 网络断了、HTTP 错误、超时：再试也大概率一样，直接降级
            last_error = e
            break

    print(f"DeepSeek chat error → 降级到演示回复: {last_error}")
    from mock_data import get_mock_response
    return get_mock_response(user_message, current_round - 1, affinity), True, {"attempts": calls, "error": str(last_error)}


DEEPSEEK_BUDGET_S = 15


def parse_reply(content: str) -> dict:
    """解析 DeepSeek 的回复。JSON 坏了或没有台词都抛 ValueError（会触发重试）。"""
    result = json.loads(content)  # JSONDecodeError 是 ValueError 的子类
    if not isinstance(result, dict) or not str(result.get("text", "")).strip():
        raise ValueError(f"JSON 缺少 text: {content.strip()[:200]}")
    return result


def assistant_turn_json(h: dict) -> str:
    """把前端存的一条「她说过的话」还原成她当时回的 JSON。"""
    return json.dumps(
        {
            "text": h.get("content", ""),
            "emotion": h.get("emotion") or "neutral",
            "action": h.get("action"),
            "scene_change": h.get("scene_change"),
        },
        ensure_ascii=False,
    )



# ---------- Run ----------
if __name__ == "__main__":
    mode = "MOCK" if USE_MOCK else "LIVE (DeepSeek)"
    print(f"\n  Mira Scene — {mode} mode · 生图：{imagegen.provider_name()}")
    print(f"  Open http://localhost:5000 in your browser")
    print(f"  观测页 http://localhost:5000/debug\n")
    # 本地开发默认开 debug（改代码自动重启）；Docker 里设 MIRA_DEBUG=0
    debug = os.getenv("MIRA_DEBUG", "1") != "0"
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=debug)