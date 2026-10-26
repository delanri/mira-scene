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

对用户的态度变化：
- 一开始：不好奇用户是谁，只是想找人说话
- 聊久了：开始注意到"这个人问的东西有点不一样"，慢慢好奇起来

你必须用以下 JSON 格式回复（不要 markdown，不要代码块，只要原始 JSON）：
{
  "text": "你的对话内容",
  "emotion": "neutral" | "curious" | "happy" | "melancholy" | "surprised",
  "action": null | "lean_forward" | "look_away" | "show_photo" | "sip_coffee" | "touch_hair_clip",
  "scene_change": null | {"type": "background" | "effect" | "event", "value": "string"}
}

情绪和动作指引：
- 情绪跟着对话自然变化
- "lean_forward"：感兴趣、想分享、想靠近的时候
- "look_away"：不自在、藏情绪、怀念什么的时候
- "show_photo"：聊到摄影或旅行的时候（同时加 scene_change，type 为 "event"，value 为 "show_photo"）
- "sip_coffee"：紧张习惯、思考停顿的时候
- "touch_hair_clip"：想到私人的事、情绪涌上来的时候
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

    if USE_MOCK:
        from mock_data import get_mock_response
        # Small delay to simulate network latency
        time.sleep(0.5)
        response = get_mock_response(user_message, turn_count)
    else:
        response = call_deepseek_chat(user_message, history)

    response["request_id"] = request_id
    response["mode"] = "mock" if USE_MOCK else "live"
    return jsonify(response)


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
def call_deepseek_chat(user_message: str, history: list) -> dict:
    """Call DeepSeek Chat Completions API (OpenAI-compatible)."""
    import requests as req

    messages = [{"role": "system", "content": MIRA_SYSTEM_PROMPT}]
    for h in history[-20:]:  # Keep last 20 messages for context
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_message})

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
            timeout=15,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as e:
        print(f"DeepSeek chat error: {e}")
        # Fallback to mock
        from mock_data import get_mock_response
        return get_mock_response(user_message)



# ---------- Run ----------
if __name__ == "__main__":
    mode = "MOCK" if USE_MOCK else "LIVE (DeepSeek)"
    print(f"\n  Mira Scene — {mode} mode")
    print(f"  Open http://localhost:5000 in your browser\n")
    app.run(host="0.0.0.0", port=5000, debug=True)