"""Mock response data for demo mode (no API key needed)."""

import random

# Conversation flow: each entry matches keyword patterns
# Falls through to default if no match
MOCK_RESPONSES = [
    {
        "keywords": ["hello", "hi", "hey", "你好", "嗨", "在吗", "晚上好"],
        "responses": [
            {
                "text": "啊……你好。抱歉，刚刚在看外面的雨发呆。今晚的雨好大，对吧？",
                "emotion": "surprised",
                "action": "touch_hair_clip",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["name", "who", "你是谁", "名字", "call", "叫什么", "怎么称呼"],
        "responses": [
            {
                "text": "我叫 Mira，旅行摄影师——嗯，就是到处跑到处拍那种。你呢？看你不像是这家店的常客。",
                "emotion": "curious",
                "action": "lean_forward",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["wait", "someone", "等", "谁", "expecting", "等人", "一个人"],
        "responses": [
            {
                "text": "等人？……也不算吧。就是拍完照有点空，想找个地方坐一会儿。",
                "emotion": "melancholy",
                "action": "sip_coffee",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["photo", "camera", "照片", "摄影", "picture", "shoot", "拍照", "拍", "相机"],
        "responses": [
            {
                "text": "要看吗？刚才在外面拍的——雨打在路灯上那种光晕，特别好看。我觉得拍得还不错。",
                "emotion": "happy",
                "action": "show_photo",
                "scene_change": {"type": "event", "value": "show_photo"}
            }
        ]
    },
    {
        "keywords": ["rain", "weather", "storm", "雨", "天气", "下雨"],
        "responses": [
            {
                "text": "我其实挺喜欢雨天的。下雨的时候什么都会慢下来，光也会变得很柔。我拍过的最好的几张照片都是在这种天气里。",
                "emotion": "happy",
                "action": "lean_forward",
                "scene_change": {"type": "background", "value": "rain_heavy"}
            }
        ]
    },
    {
        "keywords": ["travel", "旅行", "where", "去过", "country", "place", "地方", "哪里"],
        "responses": [
            {
                "text": "去年跑了巴塔哥尼亚、北海道、还有苏格兰高地。哪里的光有意思就往哪里去。听着挺浪漫的吧？其实……一个人赶路的时候还挺空的。",
                "emotion": "melancholy",
                "action": "sip_coffee",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["lonely", "alone", "孤独", "一个人", "sad", "miss", "寂寞", "难过"],
        "responses": [
            {
                "text": "……你还挺敏锐的。嗯，是有点吧。拍完东西之后总觉得少了点什么，想跟人说说但又不知道说什么。",
                "emotion": "melancholy",
                "action": "touch_hair_clip",
                "scene_change": {"type": "effect", "value": "lightning"}
            }
        ]
    },
    {
        "keywords": ["clip", "star", "发夹", "星星", "hair", "夹子"],
        "responses": [
            {
                "text": "这个？……在一个旧货市场淘到的。星星形状的，我觉得挺好看就一直戴着了。也没什么特别的故事啦。",
                "emotion": "melancholy",
                "action": "touch_hair_clip",
                "scene_change": {"type": "event", "value": "lights_flicker"}
            }
        ]
    },
    {
        "keywords": ["coffee", "drink", "咖啡", "喝", "杯"],
        "responses": [
            {
                "text": "已经第三杯了。老板一直在看我——大概想关门了吧。但我还不太想走。",
                "emotion": "curious",
                "action": "sip_coffee",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["close", "closing", "leave", "go", "走", "关门", "late", "晚", "该走了", "打烊"],
        "responses": [
            {
                "text": "嗯，快打烊了。说起来我也不知道自己为什么总来这家店……大概就是觉得坐在窗边看雨挺舒服的吧。",
                "emotion": "melancholy",
                "action": "look_away",
                "scene_change": {"type": "background", "value": "rain_heavy"}
            }
        ]
    },
    {
        "keywords": ["happy", "smile", "laugh", "开心", "笑", "funny", "joke", "哈哈", "有趣"],
        "responses": [
            {
                "text": "哈，好久没这么笑过了。跟你聊天还挺轻松的——我平时不怎么跟人聊这些。",
                "emotion": "happy",
                "action": "lean_forward",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["beautiful", "pretty", "漂亮", "好看", "可爱", "cute"],
        "responses": [
            {
                "text": "……谢谢。你知道吗，一直在镜头后面待着，会忘记被人看到是什么感觉。",
                "emotion": "surprised",
                "action": "look_away",
                "scene_change": {"type": "effect", "value": "lightning"}
            }
        ]
    },
    {
        "keywords": ["what", "干嘛", "做什么", "在干嘛", "忙什么"],
        "responses": [
            {
                "text": "刚拍完照回来，在这儿歇一会儿。雨太大了走不了，正好坐着发发呆。",
                "emotion": "neutral",
                "action": "sip_coffee",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["like", "喜欢", "爱好", "兴趣"],
        "responses": [
            {
                "text": "喜欢的东西？光吧。日落的光、雨天的光、路灯透过雾气的那种光。听起来很奇怪吧，但我就是喜欢追着光跑。",
                "emotion": "happy",
                "action": "lean_forward",
                "scene_change": None
            }
        ]
    },
]

DEFAULT_RESPONSES = [
    {
        "text": "嗯……你说的这个我也想过。不过我好像是从另一个角度在看。",
        "emotion": "curious",
        "action": None,
        "scene_change": None
    },
    {
        "text": "你聊天的方式挺特别的。大部分人遇到我都只会问'去过哪里'、'最好看的地方是哪'之类的。",
        "emotion": "happy",
        "action": "lean_forward",
        "scene_change": None
    },
    {
        "text": "啊抱歉，刚刚走神了。雨声太好听了……你刚说什么来着？",
        "emotion": "melancholy",
        "action": "sip_coffee",
        "scene_change": None
    },
    {
        "text": "哎，我给你看个东西吧。",
        "emotion": "curious",
        "action": "lean_forward",
        "scene_change": None
    },
    {
        "text": "说到这个我突然想起来，在冰岛的时候也遇到过类似的事。不过那是另一个故事了。",
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