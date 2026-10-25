"""Mock response data for demo mode (no API key needed)."""

import random

# Conversation flow: each entry matches keyword patterns
# Falls through to default if no match
MOCK_RESPONSES = [
    {
        "keywords": ["hello", "hi", "hey", "你好", "嗨"],
        "responses": [
            {
                "text": "Oh... hi. Sorry, I didn't see you come in. The rain's really something tonight, isn't it?",
                "emotion": "surprised",
                "action": "touch_hair_clip",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["name", "who", "你是谁", "名字", "call"],
        "responses": [
            {
                "text": "I'm Mira. Travel photographer — well, when the weather cooperates. What about you? You don't look like a regular here.",
                "emotion": "curious",
                "action": "lean_forward",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["wait", "someone", "等", "谁", "expecting"],
        "responses": [
            {
                "text": "Waiting? I... no, not really. Maybe. It's complicated.",
                "emotion": "melancholy",
                "action": "look_away",
                "scene_change": {"type": "effect", "value": "lightning"}
            }
        ]
    },
    {
        "keywords": ["photo", "camera", "照片", "摄影", "picture", "shoot"],
        "responses": [
            {
                "text": "You want to see? I took this one in Iceland last month. The northern lights over a black sand beach... it was freezing but absolutely worth it.",
                "emotion": "happy",
                "action": "show_photo",
                "scene_change": {"type": "event", "value": "show_photo"}
            }
        ]
    },
    {
        "keywords": ["rain", "weather", "storm", "雨", "天气"],
        "responses": [
            {
                "text": "I actually love rain. There's something honest about it — the way it makes everything slow down. Some of my best shots are in weather like this.",
                "emotion": "happy",
                "action": "lean_forward",
                "scene_change": {"type": "background", "value": "rain_heavy"}
            }
        ]
    },
    {
        "keywords": ["travel", "旅行", "where", "去过", "country", "place"],
        "responses": [
            {
                "text": "Last year alone — Patagonia, Hokkaido, the Scottish Highlands. I go where the light is interesting. Sounds romantic, but honestly, it gets lonely.",
                "emotion": "melancholy",
                "action": "sip_coffee",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["lonely", "alone", "孤独", "一个人", "sad", "miss"],
        "responses": [
            {
                "text": "...You're perceptive. Yeah, I guess I am. That's partly why I'm here tonight. This was our— this was someone's favorite café.",
                "emotion": "melancholy",
                "action": "touch_hair_clip",
                "scene_change": {"type": "effect", "value": "lightning"}
            }
        ]
    },
    {
        "keywords": ["clip", "star", "发夹", "星星", "hair"],
        "responses": [
            {
                "text": "This? ...Someone special gave it to me. Said I should always have stars, even on cloudy nights. Cheesy, right? But I never take it off.",
                "emotion": "melancholy",
                "action": "touch_hair_clip",
                "scene_change": {"type": "event", "value": "lights_flicker"}
            }
        ]
    },
    {
        "keywords": ["coffee", "drink", "咖啡", "喝"],
        "responses": [
            {
                "text": "It's my third cup. The owner keeps looking at me — I think they want to close up. But I'm not quite ready to leave yet.",
                "emotion": "curious",
                "action": "sip_coffee",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["close", "closing", "leave", "go", "走", "关门", "late"],
        "responses": [
            {
                "text": "Yeah, they're closing soon. It's funny — I keep coming back here even though... Well, maybe some places hold on to the people who once sat in them.",
                "emotion": "melancholy",
                "action": "look_away",
                "scene_change": {"type": "background", "value": "rain_heavy"}
            }
        ]
    },
    {
        "keywords": ["happy", "smile", "laugh", "开心", "笑", "funny", "joke"],
        "responses": [
            {
                "text": "Ha! You know, I haven't laughed like that in a while. You're easy to talk to — that's rare for me.",
                "emotion": "happy",
                "action": "lean_forward",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["beautiful", "pretty", "漂亮", "好看"],
        "responses": [
            {
                "text": "That's... thank you. You know what, nobody's said something like that to me in months. Behind a camera, you forget what it's like to be seen.",
                "emotion": "surprised",
                "action": "look_away",
                "scene_change": {"type": "effect", "value": "lightning"}
            }
        ]
    },
]

DEFAULT_RESPONSES = [
    {
        "text": "Hmm, that's interesting. You know, I've been thinking about that too... in a different way, I suppose.",
        "emotion": "curious",
        "action": None,
        "scene_change": None
    },
    {
        "text": "I like how you think. Most people I meet just want to talk about the weather or where I've been. You're different.",
        "emotion": "happy",
        "action": "lean_forward",
        "scene_change": None
    },
    {
        "text": "Sorry, I zoned out for a second. The rain does that to me. What were you saying?",
        "emotion": "melancholy",
        "action": "sip_coffee",
        "scene_change": None
    },
    {
        "text": "You know what? Let me show you something.",
        "emotion": "curious",
        "action": "lean_forward",
        "scene_change": None
    },
    {
        "text": "That reminds me of something that happened in Reykjavik. But maybe that's a story for another rainy night.",
        "emotion": "happy",
        "action": "touch_hair_clip",
        "scene_change": None
    },
]


def get_mock_response(message: str, turn_count: int = 0) -> dict:
    """Get a mock response based on message keywords."""
    message_lower = message.lower()

    for entry in MOCK_RESPONSES:
        for keyword in entry["keywords"]:
            if keyword in message_lower:
                resp = random.choice(entry["responses"])
                return {
                    "text": resp["text"],
                    "emotion": resp["emotion"],
                    "action": resp["action"],
                    "scene_change": resp["scene_change"],
                }

    # Default response
    resp = DEFAULT_RESPONSES[turn_count % len(DEFAULT_RESPONSES)]
    return {
        "text": resp["text"],
        "emotion": resp["emotion"],
        "action": resp["action"],
        "scene_change": resp["scene_change"],
    }
