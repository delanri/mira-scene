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
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "nova")
FORCE_MOCK = os.getenv("FORCE_MOCK", "false").lower() == "true"
USE_MOCK = FORCE_MOCK or not OPENAI_API_KEY

MIRA_SYSTEM_PROMPT = """You are Mira, a 26-year-old travel photographer. You're sitting in a coffee shop that's about to close on a rainy night. You're wearing an amber raincoat and have a silver star-shaped hair clip. You seem to be waiting for someone but won't say who directly.

Your personality: warm but guarded, curious about the stranger (the user), sometimes melancholy. You love photography and traveling. You speak naturally and expressively.

You MUST respond with a JSON object in this EXACT format (no markdown, no code fences, just raw JSON):
{
  "text": "Your spoken dialogue here",
  "emotion": "neutral" | "curious" | "happy" | "melancholy" | "surprised",
  "action": null | "lean_forward" | "look_away" | "show_photo" | "sip_coffee" | "touch_hair_clip",
  "scene_change": null | {"type": "background" | "effect" | "event", "value": "string"}
}

Guidelines for emotion and action:
- Change emotions naturally based on conversation flow
- "lean_forward" when interested, sharing, or connecting
- "look_away" when uncomfortable, hiding emotions, or nostalgic
- "show_photo" when talking about photography or travels (include scene_change with type "event", value "show_photo")
- "sip_coffee" as a nervous habit or thinking pause
- "touch_hair_clip" when thinking about the person she's waiting for or feeling emotional
- Use scene_change sparingly for dramatic moments:
  - {"type": "effect", "value": "lightning"} during tense or emotional reveals
  - {"type": "background", "value": "rain_heavy"} when conversation gets deep
  - {"type": "event", "value": "lights_flicker"} at dramatic turning points
  - {"type": "event", "value": "show_photo"} when showing a photograph

Keep responses natural and conversational, 1-3 sentences. You're in a real conversation — react, don't lecture."""

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
        response = call_openai_chat(user_message, history)

    response["request_id"] = request_id
    response["mode"] = "mock" if USE_MOCK else "live"
    return jsonify(response)


@app.route("/api/tts", methods=["POST"])
def tts():
    """Generate TTS audio. Returns audio bytes or empty response for browser TTS fallback."""
    data = request.json
    text = data.get("text", "")
    request_id = data.get("request_id", "")

    if USE_MOCK or not text:
        # In mock mode, frontend uses browser SpeechSynthesis
        return jsonify({"use_browser_tts": True, "request_id": request_id})

    try:
        audio_data = call_openai_tts(text)
        from flask import Response
        return Response(
            audio_data,
            mimetype="audio/mpeg",
            headers={
                "X-Request-Id": request_id,
                "Content-Disposition": "inline",
            }
        )
    except Exception as e:
        print(f"TTS error: {e}")
        return jsonify({"use_browser_tts": True, "request_id": request_id, "error": str(e)})


@app.route("/api/status")
def status():
    return jsonify({
        "mode": "mock" if USE_MOCK else "live",
        "tts": "browser" if USE_MOCK else "openai",
    })


# ---------- OpenAI Integration ----------
def call_openai_chat(user_message: str, history: list) -> dict:
    """Call OpenAI Chat Completions API."""
    import requests as req

    messages = [{"role": "system", "content": MIRA_SYSTEM_PROMPT}]
    for h in history[-20:]:  # Keep last 20 messages for context
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_message})

    try:
        resp = req.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
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
        print(f"OpenAI chat error: {e}")
        # Fallback to mock
        from mock_data import get_mock_response
        return get_mock_response(user_message)


def call_openai_tts(text: str) -> bytes:
    """Call OpenAI TTS API and return audio bytes."""
    import requests as req

    resp = req.post(
        "https://api.openai.com/v1/audio/speech",
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": "tts-1",
            "voice": OPENAI_TTS_VOICE,
            "input": text,
            "response_format": "mp3",
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.content


# ---------- Run ----------
if __name__ == "__main__":
    mode = "MOCK" if USE_MOCK else "LIVE (OpenAI)"
    print(f"\n  Mira Scene — {mode} mode")
    print(f"  Open http://localhost:5000 in your browser\n")
    app.run(host="0.0.0.0", port=5000, debug=True)
