"""照片生成：她拿相机给你看照片时，按她描述的内容生成那张照片。

两种来源（provider），用环境变量切换：
  - comfyui：本地 ComfyUI（COMFYUI_URL），通过 ComfyUI 的 HTTP API 提交工作流、查进度、取图片
  - zhipu：智谱 CogView-3-Flash 云端接口（ZHIPU_API_KEY）
  - 都没配置 → 不生成，前端显示内置的冰岛极光照片

流程：create_job() 先查缓存 → 命中直接完成；没命中就在后台线程里生成，
状态（queued / running / done / failed）和耗时都记进 SQLite（store.py），前端轮询 /api/photo/<id>。
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import threading
import time
import uuid
from pathlib import Path

import requests

import store

GENERATED_DIR = Path(os.getenv("MIRA_GENERATED_DIR", Path(__file__).parent / "static" / "generated"))
COMFYUI_WORKFLOW = Path(os.getenv("COMFYUI_WORKFLOW", Path(__file__).parent / "comfyui" / "mira_photo_api.json"))
IMAGE_TIMEOUT_S = float(os.getenv("IMAGE_TIMEOUT_S", "60"))

# 统一的画面风格：像她用胶片相机拍的真实照片，不要文字
STYLE_SUFFIX = ", film photograph taken by a travel photographer, natural light, realistic, soft grain, no text, no watermark"
NEGATIVE_PROMPT = "text, watermark, logo, signature, cartoon, illustration, 3d render, lowres, blurry, deformed"


# ---------------------------------------------------------------- 选择来源
def provider_name() -> str:
    """当前用哪种来源。IMAGE_PROVIDER 可以强制指定；不指定就按配置自动选。"""
    forced = os.getenv("IMAGE_PROVIDER", "").strip().lower()
    if forced in ("comfyui", "zhipu", "none"):
        return forced
    if os.getenv("COMFYUI_URL"):
        return "comfyui"
    if os.getenv("ZHIPU_API_KEY"):
        return "zhipu"
    return "none"


def full_prompt(prompt: str) -> str:
    return prompt.strip().rstrip(".，。") + STYLE_SUFFIX


def cache_key(provider: str, prompt: str) -> str:
    return hashlib.sha1(f"{provider}|{full_prompt(prompt)}".encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- 任务
def create_job(prompt: str, caption: str = "") -> dict | None:
    """开一个生成任务，返回 {"job_id", "caption"}；没有可用来源时返回 None（前端用内置照片）。"""
    provider = provider_name()
    if provider == "none" or not prompt.strip():
        return None

    job_id = uuid.uuid4().hex[:12]
    key = cache_key(provider, prompt)
    now = time.time()

    # 缓存：同样的描述生成过、文件还在 → 直接完成
    hit = store.query_one(
        "SELECT image_file FROM photo_jobs WHERE cache_key = ? AND status = 'done' AND image_file IS NOT NULL "
        "ORDER BY finished_at DESC LIMIT 1",
        (key,),
    )
    if hit and (GENERATED_DIR / hit["image_file"]).exists():
        store.execute(
            "INSERT INTO photo_jobs (id, created_at, prompt, caption, cache_key, provider, status, image_file, cached, "
            "started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, 'done', ?, 1, ?, ?)",
            (job_id, now, prompt, caption, key, provider, hit["image_file"], now, now),
        )
        return {"job_id": job_id, "caption": caption}

    store.execute(
        "INSERT INTO photo_jobs (id, created_at, prompt, caption, cache_key, provider, status) "
        "VALUES (?, ?, ?, ?, ?, ?, 'queued')",
        (job_id, now, prompt, caption, key, provider),
    )
    threading.Thread(target=_run_job, args=(job_id, provider, prompt, key), daemon=True).start()
    return {"job_id": job_id, "caption": caption}


def _run_job(job_id: str, provider: str, prompt: str, key: str):
    store.execute("UPDATE photo_jobs SET status = 'running', started_at = ? WHERE id = ?", (time.time(), job_id))
    try:
        generate = generate_comfyui if provider == "comfyui" else generate_zhipu
        data, ext = generate(full_prompt(prompt))
        GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{key}.{ext}"
        (GENERATED_DIR / filename).write_bytes(data)
        store.execute(
            "UPDATE photo_jobs SET status = 'done', image_file = ?, finished_at = ? WHERE id = ?",
            (filename, time.time(), job_id),
        )
    except Exception as e:  # 任何失败都只记下来，前端会退回内置照片
        print(f"生图失败（{provider}）: {e}")
        store.execute(
            "UPDATE photo_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
            (str(e)[:500], time.time(), job_id),
        )


def job_status(job_id: str) -> dict | None:
    row = store.query_one("SELECT * FROM photo_jobs WHERE id = ?", (job_id,))
    if not row:
        return None
    end = row["finished_at"] or time.time()
    return {
        "status": row["status"],
        "url": f"/generated/{row['image_file']}" if row["status"] == "done" else None,
        "caption": row["caption"],
        "cached": bool(row["cached"]),
        "provider": row["provider"],
        "error": row["error"],
        "elapsed_ms": int((end - row["created_at"]) * 1000),
    }


def _ext_from_content_type(content_type: str) -> str:
    if "jpeg" in content_type or "jpg" in content_type:
        return "jpg"
    if "webp" in content_type:
        return "webp"
    return "png"


# ---------------------------------------------------------------- 智谱 CogView-3-Flash
def generate_zhipu(prompt: str) -> tuple:
    """同步接口：一次请求直接返回图片链接（链接会过期，所以马上下载到本地）。"""
    resp = requests.post(
        "https://open.bigmodel.cn/api/paas/v4/images/generations",
        headers={"Authorization": f"Bearer {os.getenv('ZHIPU_API_KEY', '')}", "Content-Type": "application/json"},
        json={"model": os.getenv("ZHIPU_IMAGE_MODEL", "cogview-3-flash"), "prompt": prompt, "size": "1152x864"},
        timeout=IMAGE_TIMEOUT_S,
    )
    resp.raise_for_status()
    url = resp.json()["data"][0]["url"]
    img = requests.get(url, timeout=IMAGE_TIMEOUT_S)
    img.raise_for_status()
    return img.content, _ext_from_content_type(img.headers.get("content-type", ""))


# ---------------------------------------------------------------- ComfyUI
def build_comfyui_workflow(prompt: str, workflow: dict | None = None) -> dict:
    """读工作流（API 格式），把 "%PROMPT%" / "%NEGATIVE%" 换成这次的内容，随机种子，按环境变量覆盖模型和采样参数。"""
    wf = json.loads(json.dumps(workflow)) if workflow else json.loads(COMFYUI_WORKFLOW.read_text(encoding="utf-8"))
    found_prompt = False
    for node in wf.values():
        inputs = node.get("inputs", {})
        for k, v in list(inputs.items()):
            if v == "%PROMPT%":
                inputs[k] = prompt
                found_prompt = True
            elif v == "%NEGATIVE%":
                inputs[k] = NEGATIVE_PROMPT
        if node.get("class_type") in ("KSampler", "KSamplerAdvanced"):
            for seed_key in ("seed", "noise_seed"):
                if seed_key in inputs:
                    inputs[seed_key] = random.randint(0, 2**31 - 1)
            if os.getenv("COMFYUI_STEPS"):
                inputs["steps"] = int(os.getenv("COMFYUI_STEPS"))
            if os.getenv("COMFYUI_CFG"):
                inputs["cfg"] = float(os.getenv("COMFYUI_CFG"))
        if node.get("class_type") == "CheckpointLoaderSimple" and os.getenv("COMFYUI_CHECKPOINT"):
            inputs["ckpt_name"] = os.getenv("COMFYUI_CHECKPOINT")
    if not found_prompt:
        raise ValueError("ComfyUI 工作流里没有 %PROMPT% 占位符")
    return wf


def generate_comfyui(prompt: str) -> tuple:
    """提交工作流 → 轮询 /history 直到出图 → 从 /view 取图片。"""
    base = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
    deadline = time.monotonic() + IMAGE_TIMEOUT_S

    resp = requests.post(
        f"{base}/prompt",
        json={"prompt": build_comfyui_workflow(prompt), "client_id": "mira-scene"},
        timeout=10,
    )
    if resp.status_code != 200:
        # ComfyUI 校验失败（比如模型文件名不对）会返回 400 + node_errors
        raise RuntimeError(f"ComfyUI 拒绝了工作流：{resp.status_code} {resp.text[:300]}")
    prompt_id = resp.json()["prompt_id"]

    while time.monotonic() < deadline:
        hist = requests.get(f"{base}/history/{prompt_id}", timeout=10).json()
        entry = hist.get(prompt_id)
        if entry:
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI 执行出错：{json.dumps(status.get('messages', []), ensure_ascii=False)[:300]}")
            for output in entry.get("outputs", {}).values():
                for image in output.get("images", []):
                    view = requests.get(
                        f"{base}/view",
                        params={"filename": image["filename"], "subfolder": image.get("subfolder", ""),
                                "type": image.get("type", "output")},
                        timeout=30,
                    )
                    view.raise_for_status()
                    return view.content, _ext_from_content_type(view.headers.get("content-type", "image/png"))
            if status.get("completed"):
                raise RuntimeError("ComfyUI 执行完了但没有输出图片（工作流里有 SaveImage 节点吗？）")
        time.sleep(0.8)
    raise TimeoutError(f"ComfyUI {IMAGE_TIMEOUT_S:.0f} 秒内没有出图")
