"""Mira Scene — Interactive character experience server."""

import json
import os
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

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

    fell_back = False
    if USE_MOCK:
        from mock_data import get_mock_response
        # Small delay to simulate network latency
        time.sleep(0.5)
        response = get_mock_response(user_message, turn_count, affinity)
    else:
        response, fell_back = call_deepseek_chat(user_message, history, current_round, affinity)

    bind_photo_action(response)

    response["request_id"] = request_id
    response["affinity"] = affinity
    # fallback = 在线模式但 DeepSeek 失败了，这一轮用的是演示回复（前端要让用户看得见）
    response["mode"] = "mock" if USE_MOCK else ("fallback" if fell_back else "live")
    return jsonify(response)


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
    })


# ---------- DeepSeek Integration ----------
def call_deepseek_chat(user_message: str, history: list, current_round: int, affinity: int) -> tuple:
    """Call DeepSeek Chat Completions API (OpenAI-compatible).

    返回 (response, fell_back)。fell_back=True 表示 DeepSeek 出错/超时/返回坏 JSON，
    这一轮换成了演示回复。
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
    for attempt in (1, 2):
        remaining = deadline - time.monotonic()
        if remaining < 2:
            last_error = last_error or TimeoutError("没有时间再试了")
            break
        content = None
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
            return parse_reply(content), False
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
    return get_mock_response(user_message, current_round - 1, affinity), True


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
    print(f"\n  Mira Scene — {mode} mode")
    print(f"  Open http://localhost:5000 in your browser\n")
    app.run(host="0.0.0.0", port=5000, debug=True)