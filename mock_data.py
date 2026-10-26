"""Mock response data for demo mode (no API key needed)."""

import random
import re

# Conversation flow: each entry matches keyword patterns
# Falls through to default if no match
MOCK_RESPONSES = [
    {
        "keywords": ["hello", "hi", "hey", "你好", "嗨", "在吗", "晚上好"],
        "priority": 1,
        "responses": [
            {
                "text": "啊……你好。抱歉，刚刚在看外面的雨发呆。今晚的雨好大，对吧？",
                "emotion": "surprised",
                "action": "hand_to_mouth",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["name", "who", "你是谁", "名字", "call", "叫什么", "怎么称呼"],
        "priority": 3,
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
        "keywords": ["wait", "someone", "在等", "等谁", "expecting", "等人"],
        "priority": 2,
        "responses": [
            {
                "text": "等人？……也不算吧。就是拍完照有点空，想找个地方坐一会儿。",
                "emotion": "melancholy",
                "action": "hand_to_mouth",
                "scene_change": None
            },
            {
                # 熟络阶段（第 7 轮以后）才会说的真话
                "min_affinity": 3,
                "text": "……其实也不是在等谁。拍完照总想给人看看，可身边没人。所以就坐在这儿，等一个会停下来的人——今晚停下来的是你。",
                "emotion": "shy",
                "action": "lean_forward",
                "scene_change": None
            }
        ]
    },
    {
        "keywords": ["photo", "camera", "照片", "摄影", "picture", "shoot", "拍照", "拍", "相机"],
        "priority": 3,
        "responses": [
            {
                "text": "要看吗？上个月在冰岛拍的——黑沙滩上的北极光。在海边冻了三个晚上才等到。",
                "emotion": "happy",
                "action": "show_photo",
                "scene_change": {"type": "event", "value": "show_photo"},
                "photo": {
                    "prompt": "Aurora borealis over a black sand beach in Iceland at night, green and violet lights reflected on the wet sand, small waves, dark mountains on the horizon, stars",
                    "caption": "冰岛，上个月 —— 黑沙滩上的北极光",
                },
            }
        ]
    },
    {
        "keywords": ["rain", "weather", "storm", "雨", "天气", "下雨"],
        "priority": 3,
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
        "priority": 3,
        "responses": [
            {
                "text": "去年跑了巴塔哥尼亚、北海道，上个月刚从冰岛回来。哪里的光有意思就往哪里去。听着挺浪漫的吧？其实……一个人赶路的时候还挺空的。",
                "emotion": "melancholy",
                "action": "show_photo",
                "scene_change": {"type": "event", "value": "show_photo"},
                "photo": {
                    "prompt": "Aurora borealis over a black sand beach in Iceland at night, green and violet lights reflected on the wet sand, small waves, dark mountains on the horizon, stars",
                    "caption": "冰岛，上个月 —— 黑沙滩上的北极光",
                },
            }
        ]
    },
    {
        "keywords": ["lonely", "alone", "孤独", "一个人", "sad", "miss", "寂寞", "难过"],
        "priority": 2,
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
        "priority": 3,
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
        "priority": 3,
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
        "priority": 2,
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
        "priority": 2,
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
        "priority": 2,
        "responses": [
            {
                "text": "……谢谢。你知道吗，一直在镜头后面待着，会忘记被人看到是什么感觉。",
                "emotion": "shy",
                "action": "look_away",
                "scene_change": {"type": "effect", "value": "lightning"}
            }
        ]
    },
    {
        "keywords": ["what", "干嘛", "做什么", "在干嘛", "忙什么"],
        "priority": 1,
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
        "priority": 2,
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
        "action": "sip_coffee",
        "scene_change": None
    },
]


def _keyword_hit(keyword: str, message_lower: str) -> bool:
    """英文关键词按整个单词匹配（"this" 里的 "hi" 不算），中文照旧按包含匹配。"""
    if keyword.isascii():
        return re.search(r"(?<![a-z])" + re.escape(keyword) + r"(?![a-z])", message_lower) is not None
    return keyword in message_lower


def get_mock_response(message: str, turn_count: int = 0, affinity: int = 1) -> dict:
    """Get a mock response based on message keywords."""
    message_lower = message.lower()

    # 先比关键词长短，一样长再比 priority（话题 3 > 情绪/夸奖 2 > 招呼/泛问 1）
    # 例："你的相机好看" → 相机(2字,3) 胜 好看(2字,2)；"你好看" → 好看(2字,2) 胜 你好(2字,1)
    best_match = None
    best_score = (0, 0)

    for entry in MOCK_RESPONSES:
        for keyword in entry["keywords"]:
            if not _keyword_hit(keyword, message_lower):
                continue
            score = (len(keyword), entry["priority"])
            if score > best_score:
                best_match = entry
                best_score = score

    if best_match:
        # 好感度：只用当前阶段已解锁的版本（min_affinity 默认 1），有更高阶段的版本就优先用
        unlocked = [r for r in best_match["responses"] if r.get("min_affinity", 1) <= affinity]
        top = max(r.get("min_affinity", 1) for r in unlocked)
        resp = random.choice([r for r in unlocked if r.get("min_affinity", 1) == top])
        return {
            "text": resp["text"],
            "emotion": resp["emotion"],
            "action": resp["action"],
            "scene_change": resp["scene_change"],
            "photo": resp.get("photo"),  # 拿相机时那张照片的描述（配置了生图才会用到）
        }

    # Default response
    resp = DEFAULT_RESPONSES[turn_count % len(DEFAULT_RESPONSES)]
    return {
        "text": resp["text"],
        "emotion": resp["emotion"],
        "action": resp["action"],
        "scene_change": resp["scene_change"],
    }