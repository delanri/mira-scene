"""生图 + 观测页测试：任务状态、缓存、智谱和 ComfyUI 两种来源、失败退回、/debug、/api/event。

不会真的请求智谱或 ComfyUI：requests.post / requests.get 全部被替换掉。
"""

import json
import os
import time
import unittest
from unittest import mock

import imagegen
import server
import store

PNG = b"\x89PNG\r\n\x1a\nfake-image-bytes"


class FakeResp:
    def __init__(self, json_data=None, content=b"", status=200, content_type="image/png"):
        self._json = json_data
        self.content = content
        self.status_code = status
        self.headers = {"content-type": content_type}
        self.text = json.dumps(json_data) if json_data is not None else ""

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def wait_job(job_id, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = imagegen.job_status(job_id)
        if s["status"] in ("done", "failed"):
            return s
        time.sleep(0.05)
    raise AssertionError("任务没有结束")


def unique_prompt(tag):
    # 每个测试用不同描述，避免互相命中缓存
    return f"{tag} aurora over a black sand beach {time.time_ns()}"


class TestProviderSelection(unittest.TestCase):
    def test_auto_selection(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "", "COMFYUI_URL": "", "ZHIPU_API_KEY": ""}):
            self.assertEqual(imagegen.provider_name(), "none")
        with mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "", "COMFYUI_URL": "", "ZHIPU_API_KEY": "k"}):
            self.assertEqual(imagegen.provider_name(), "zhipu")
        with mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "", "COMFYUI_URL": "http://x", "ZHIPU_API_KEY": "k"}):
            self.assertEqual(imagegen.provider_name(), "comfyui", "本地 ComfyUI 优先")

    def test_no_provider_means_builtin_photo(self):
        with mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "none"}):
            self.assertIsNone(imagegen.create_job("anything", "配字"))


class TestZhipu(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "zhipu", "ZHIPU_API_KEY": "k"})
        p.start()
        self.addCleanup(p.stop)

    def test_generate_then_cache(self):
        prompt = unique_prompt("zhipu")
        post = mock.Mock(return_value=FakeResp({"data": [{"url": "https://img.example/x.png"}]}))
        get = mock.Mock(return_value=FakeResp(content=PNG))
        with mock.patch("requests.post", post), mock.patch("requests.get", get):
            job = imagegen.create_job(prompt, "冰岛，上个月")
            status = wait_job(job["job_id"])
        self.assertEqual(status["status"], "done")
        self.assertFalse(status["cached"])
        self.assertTrue(status["url"].startswith("/generated/"))
        sent = post.call_args.kwargs["json"]
        self.assertEqual(sent["model"], "cogview-3-flash")
        self.assertIn(prompt, sent["prompt"])
        self.assertIn("no text", sent["prompt"], "统一风格后缀")

        # 第二次同样的描述：直接命中缓存，不再请求
        post2 = mock.Mock()
        with mock.patch("requests.post", post2):
            job2 = imagegen.create_job(prompt, "冰岛，上个月")
        status2 = imagegen.job_status(job2["job_id"])
        self.assertEqual(status2["status"], "done")
        self.assertTrue(status2["cached"])
        self.assertEqual(status2["url"], status["url"])
        post2.assert_not_called()

    def test_failure_is_recorded(self):
        with mock.patch("requests.post", side_effect=ConnectionError("断网")):
            job = imagegen.create_job(unique_prompt("fail"), "")
            status = wait_job(job["job_id"])
        self.assertEqual(status["status"], "failed")
        self.assertIn("断网", status["error"])
        self.assertIsNone(status["url"])


class TestComfyUI(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "comfyui", "COMFYUI_URL": "http://comfy:8188"})
        p.start()
        self.addCleanup(p.stop)

    def test_workflow_injection(self):
        with mock.patch.dict(os.environ, {"COMFYUI_CHECKPOINT": "my_model.safetensors", "COMFYUI_STEPS": "8"}):
            wf = imagegen.build_comfyui_workflow("a rainy street")
        texts = [n["inputs"].get("text") for n in wf.values() if n["class_type"] == "CLIPTextEncode"]
        self.assertIn("a rainy street", texts)
        self.assertIn(imagegen.NEGATIVE_PROMPT, texts)
        sampler = next(n for n in wf.values() if n["class_type"] == "KSampler")
        self.assertEqual(sampler["inputs"]["steps"], 8)
        self.assertGreater(sampler["inputs"]["seed"], -1)
        ckpt = next(n for n in wf.values() if n["class_type"] == "CheckpointLoaderSimple")
        self.assertEqual(ckpt["inputs"]["ckpt_name"], "my_model.safetensors")

    def test_workflow_without_placeholder_rejected(self):
        with self.assertRaises(ValueError):
            imagegen.build_comfyui_workflow("x", {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "fixed"}}})

    def test_submit_poll_and_download(self):
        history_calls = {"n": 0}

        def fake_get(url, **kw):
            if "/history/" in url:
                history_calls["n"] += 1
                if history_calls["n"] < 2:  # 第一次查：还没好
                    return FakeResp({})
                return FakeResp({"pid-1": {
                    "status": {"status_str": "success", "completed": True},
                    "outputs": {"9": {"images": [{"filename": "mira_photo_0001.png", "subfolder": "", "type": "output"}]}},
                }})
            if url.endswith("/view"):
                self.assertEqual(kw["params"]["filename"], "mira_photo_0001.png")
                return FakeResp(content=PNG)
            raise AssertionError(url)

        post = mock.Mock(return_value=FakeResp({"prompt_id": "pid-1"}))
        with mock.patch("requests.post", post), mock.patch("requests.get", side_effect=fake_get), \
                mock.patch.object(imagegen.time, "sleep"):
            job = imagegen.create_job(unique_prompt("comfy"), "")
            status = wait_job(job["job_id"])
        self.assertEqual(status["status"], "done", status)
        self.assertEqual(post.call_args.args[0], "http://comfy:8188/prompt")
        self.assertGreaterEqual(history_calls["n"], 2)

    def test_comfyui_rejects_workflow(self):
        bad = FakeResp({"error": "invalid prompt", "node_errors": {"4": "ckpt not found"}}, status=400)
        with mock.patch("requests.post", return_value=bad):
            job = imagegen.create_job(unique_prompt("reject"), "")
            status = wait_job(job["job_id"])
        self.assertEqual(status["status"], "failed")
        self.assertIn("ComfyUI 拒绝了工作流", status["error"])


class TestChatPhotoAndDebug(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        for p in (mock.patch.object(server, "USE_MOCK", True), mock.patch.object(server.time, "sleep")):
            p.start()
            self.addCleanup(p.stop)

    def chat(self, msg):
        return self.client.post("/api/chat", json={"message": msg, "history": [{"role": "user", "content": msg}]}).get_json()

    def test_no_provider_photo_is_none(self):
        data = self.chat("你的相机好看")
        self.assertEqual(data["action"], "show_photo")
        self.assertIsNone(data["photo"])

    def test_with_provider_returns_job_and_polls(self):
        post = mock.Mock(return_value=FakeResp({"data": [{"url": "https://img.example/y.png"}]}))
        with mock.patch.dict(os.environ, {"IMAGE_PROVIDER": "zhipu", "ZHIPU_API_KEY": "k"}), \
                mock.patch("requests.post", post), mock.patch("requests.get", return_value=FakeResp(content=PNG)):
            data = self.chat("你的相机好看")
            self.assertEqual(data["photo"]["caption"], "冰岛，上个月 —— 黑沙滩上的北极光")
            wait_job(data["photo"]["job_id"])
            polled = self.client.get(f"/api/photo/{data['photo']['job_id']}").get_json()
        self.assertEqual(polled["status"], "done")
        self.assertEqual(self.client.get("/api/photo/nope").status_code, 404)

    def test_photo_field_not_leaked_without_show_photo(self):
        resp = {"text": "嗯。", "action": None, "scene_change": None, "photo": {"prompt": "x"}}
        server.attach_photo_job(resp)
        self.assertNotIn("photo", resp)

    def test_missing_photo_prompt_uses_reply_text(self):
        resp = {"text": "刚拍的雨夜路灯。", "action": "show_photo", "scene_change": None}
        with mock.patch.object(server.imagegen, "create_job", return_value={"job_id": "j", "caption": ""}) as cj:
            server.attach_photo_job(resp)
        self.assertIn("刚拍的雨夜路灯", cj.call_args.args[0])

    def test_turn_logged_and_debug_page(self):
        self.chat("debug 页测试这一句")
        self.assertEqual(self.client.post("/api/event", json={"type": "interrupt", "request_id": "r1"}).status_code, 200)
        self.assertEqual(self.client.post("/api/event", json={"type": "hack"}).status_code, 400)
        row = store.query_one("SELECT * FROM turns WHERE user_text = ?", ("debug 页测试这一句",))
        self.assertEqual(row["mode"], "mock")
        self.assertIsNotNone(row["latency_ms"])
        page = self.client.get("/debug")
        self.assertEqual(page.status_code, 200)
        html = page.get_data(as_text=True)
        self.assertIn("debug 页测试这一句", html)
        self.assertIn("interrupt", html)

    def test_debug_escapes_html(self):
        self.chat("<script>alert(1)</script>")
        html = self.client.get("/debug").get_data(as_text=True)
        self.assertNotIn("<script>alert(1)</script>", html)


if __name__ == "__main__":
    unittest.main()
