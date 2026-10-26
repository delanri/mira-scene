"""后端测试：关键词匹配、好感度、拿相机⇔照片绑定、DeepSeek 降级、上下文不重复。

运行（在项目根目录）：python -m unittest
不需要 API key，也不会真的请求 DeepSeek（requests.post 全部被替换掉）。
"""

import json
import unittest
from unittest import mock

import mock_data
import server
from mock_data import get_mock_response


class FakeDeepSeekResponse:
    """假的 DeepSeek 返回，content 是模型输出的字符串。"""

    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


def chat(client, message, history=None):
    history = list(history or [])
    history.append({"role": "user", "content": message})
    return client.post("/api/chat", json={"message": message, "history": history}).get_json()


# ---------------------------------------------------------------- 关键词匹配
class TestKeywordMatching(unittest.TestCase):
    def test_topic_beats_compliment_when_same_length(self):
        # "相机"和"好看"都是两个字，话题（3）优先于夸奖（2）
        self.assertEqual(get_mock_response("你的相机好看")["action"], "show_photo")

    def test_compliment_beats_greeting_when_same_length(self):
        # "你好看"同时包含"你好"和"好看"，夸奖（2）优先于招呼（1）
        self.assertEqual(get_mock_response("你好看")["action"], "look_away")

    def test_greeting_uses_hand_to_mouth(self):
        self.assertEqual(get_mock_response("你好")["action"], "hand_to_mouth")
        self.assertEqual(get_mock_response("晚上好")["action"], "hand_to_mouth")

    def test_english_keywords_match_whole_words_only(self):
        # "this" 里有 "hi"、"good" 里有 "go"，都不应该被匹配
        default_texts = {r["text"] for r in mock_data.DEFAULT_RESPONSES}
        self.assertIn(get_mock_response("this is nice")["text"], default_texts)
        self.assertIn(get_mock_response("good night")["text"], default_texts)
        # 整个单词还是能匹配
        self.assertEqual(get_mock_response("hi there")["action"], "hand_to_mouth")
        self.assertEqual(get_mock_response("show me your camera")["action"], "show_photo")

    def test_travel_shows_photo(self):
        resp = get_mock_response("你去过哪里")
        self.assertEqual(resp["action"], "show_photo")
        self.assertEqual(resp["scene_change"], {"type": "event", "value": "show_photo"})

    def test_compliment_is_shy(self):
        self.assertEqual(get_mock_response("你好漂亮")["emotion"], "shy")


# ---------------------------------------------------------------- 好感度
class TestAffinity(unittest.TestCase):
    def test_stage_boundaries(self):
        expected = {1: 1, 3: 1, 4: 2, 6: 2, 7: 3, 20: 3}
        for current_round, stage in expected.items():
            self.assertEqual(server.affinity_stage(current_round), stage, f"第 {current_round} 轮")

    def test_waiting_question_unlocks_truth_at_stage_3(self):
        for stage in (1, 2):
            resp = get_mock_response("你在等谁", 0, stage)
            self.assertEqual(resp["action"], "hand_to_mouth", f"阶段 {stage} 还在躲")
        resp = get_mock_response("你在等谁", 0, 3)
        self.assertEqual(resp["action"], "lean_forward")
        self.assertEqual(resp["emotion"], "shy")
        self.assertIn("停下来", resp["text"])


# ---------------------------------------------------------------- 拿相机 ⇔ 照片
class TestBindPhotoAction(unittest.TestCase):
    def test_action_without_event_gets_event(self):
        resp = {"action": "show_photo", "scene_change": None}
        server.bind_photo_action(resp)
        self.assertEqual(resp["scene_change"], {"type": "event", "value": "show_photo"})

    def test_event_without_action_gets_action(self):
        resp = {"action": None, "scene_change": {"type": "event", "value": "show_photo"}}
        server.bind_photo_action(resp)
        self.assertEqual(resp["action"], "show_photo")

    def test_unrelated_response_untouched(self):
        resp = {"action": "sip_coffee", "scene_change": {"type": "effect", "value": "lightning"}}
        server.bind_photo_action(resp)
        self.assertEqual(resp, {"action": "sip_coffee", "scene_change": {"type": "effect", "value": "lightning"}})


# ---------------------------------------------------------------- /api/chat
class TestChatMockMode(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        patches = [mock.patch.object(server, "USE_MOCK", True), mock.patch.object(server.time, "sleep")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_mode_and_affinity_returned(self):
        data = chat(self.client, "你好")
        self.assertEqual(data["mode"], "mock")
        self.assertEqual(data["affinity"], 1)

    def test_affinity_grows_with_rounds(self):
        history = []
        stages = []
        for msg in ["你好", "名字", "雨", "咖啡", "发夹", "旅行", "你在等谁"]:
            data = chat(self.client, msg, history)
            history += [{"role": "user", "content": msg}, {"role": "assistant", "content": data["text"]}]
            stages.append(data["affinity"])
        self.assertEqual(stages, [1, 1, 1, 2, 2, 2, 3])
        self.assertIn("停下来", data["text"])  # 第 7 轮问"在等谁"说的是真话


class TestChatLiveMode(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        p = mock.patch.object(server, "USE_MOCK", False)
        p.start()
        self.addCleanup(p.stop)

    def test_deepseek_network_error_falls_back_without_retry(self):
        with mock.patch("requests.post", side_effect=ConnectionError("断网")) as post:
            data = chat(self.client, "你好")
        self.assertEqual(data["mode"], "fallback")
        self.assertTrue(data["text"])
        self.assertEqual(post.call_count, 1, "断网再试也没用，不重试")

    def test_deepseek_json_without_text_retries_then_falls_back(self):
        # 真实遇到过的坏回复：前面一串空格，有情绪有动作，唯独没有 text
        bad = '                {"emotion": "neutral", "action": "show_photo", "scene_change": {"type": "event", "value": "show_photo"}}'
        with mock.patch("requests.post", return_value=FakeDeepSeekResponse(bad)) as post:
            data = chat(self.client, "你在想什么")
        self.assertEqual(data["mode"], "fallback")
        self.assertEqual(post.call_count, 2, "格式坏了会再要一次")

    def test_deepseek_invalid_json_retries_then_falls_back(self):
        with mock.patch("requests.post", return_value=FakeDeepSeekResponse("这不是 JSON")) as post:
            data = chat(self.client, "你好")
        self.assertEqual(data["mode"], "fallback")
        self.assertEqual(post.call_count, 2)

    def test_retry_succeeds_stays_live(self):
        good = json.dumps({"text": "在想外面的雨。", "emotion": "neutral", "action": None, "scene_change": None}, ensure_ascii=False)
        responses = [FakeDeepSeekResponse('{"emotion": "neutral"}'), FakeDeepSeekResponse(good)]
        with mock.patch("requests.post", side_effect=responses) as post:
            data = chat(self.client, "你在想什么")
        self.assertEqual(data["mode"], "live")
        self.assertEqual(data["text"], "在想外面的雨。")
        self.assertEqual(post.call_count, 2)

    def test_assistant_history_sent_as_json(self):
        content = json.dumps({"text": "嗯。", "emotion": "neutral", "action": None, "scene_change": None})
        history = [
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "啊……你好。", "emotion": "surprised", "action": "hand_to_mouth", "scene_change": None},
        ]
        with mock.patch("requests.post", return_value=FakeDeepSeekResponse(content)) as post:
            chat(self.client, "你在想什么", history)
        messages = post.call_args.kwargs["json"]["messages"]
        assistant = [m for m in messages if m["role"] == "assistant"]
        self.assertEqual(len(assistant), 1)
        self.assertEqual(
            json.loads(assistant[0]["content"]),
            {"text": "啊……你好。", "emotion": "surprised", "action": "hand_to_mouth", "scene_change": None},
        )

    def test_prompt_has_valid_json_example(self):
        # prompt 里的样例必须是真正合法、带 text 的 JSON
        example = next(line for line in server.MIRA_SYSTEM_PROMPT.splitlines() if line.startswith('{"text"'))
        parsed = json.loads(example)
        self.assertTrue(parsed["text"])
        self.assertEqual(set(parsed), {"text", "emotion", "action", "scene_change"})

    def test_success_is_live_and_photo_bound(self):
        content = json.dumps({"text": "要看吗？", "emotion": "happy", "action": "show_photo", "scene_change": None})
        with mock.patch("requests.post", return_value=FakeDeepSeekResponse(content)):
            data = chat(self.client, "给我看看照片")
        self.assertEqual(data["mode"], "live")
        self.assertEqual(data["scene_change"], {"type": "event", "value": "show_photo"})

    def test_current_message_sent_once_and_round_in_prompt(self):
        content = json.dumps({"text": "嗯。", "emotion": "neutral", "action": None, "scene_change": None})
        history = [
            {"role": "user", "content": "你好"}, {"role": "assistant", "content": "你好呀"},
            {"role": "user", "content": "你叫什么"}, {"role": "assistant", "content": "Mira"},
            {"role": "user", "content": "雨好大"}, {"role": "assistant", "content": "是啊"},
        ]
        with mock.patch("requests.post", return_value=FakeDeepSeekResponse(content)) as post:
            data = chat(self.client, "你在等谁", history)
        messages = post.call_args.kwargs["json"]["messages"]
        user_msgs = [m["content"] for m in messages if m["role"] == "user"]
        self.assertEqual(user_msgs.count("你在等谁"), 1, "当前这句只能发一次")
        self.assertIn("第 4 轮", messages[0]["content"])
        self.assertIn("「好奇」", messages[0]["content"])
        self.assertEqual(data["affinity"], 2)


if __name__ == "__main__":
    unittest.main()