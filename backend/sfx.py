"""音效资产库：内置 manifest + 用户库（list / import / delete）

契约（任务书 §2.3）：
  GET  /sfx/list    → { assets: SfxAsset[] }        （内置 + 用户合并，file_path 为绝对路径）
  POST /sfx/import  → { asset: SfxAsset }           （拷贝入用户库目录 + 登记 + 算时长）
  POST /sfx/delete  → { deleted: true }             （仅限 user 来源）

用户库为运行时产物（backend/user_library/ + user_library.json），不入库。
"""
from __future__ import annotations

import os
import json
import shutil
import re
import time

import soundfile as sf

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BACKEND_DIR)  # assets/ 位于仓库根

MANIFEST_FILE = os.path.join(BACKEND_DIR, "sfx_manifest.json")
USER_LIB_DIR = os.path.join(BACKEND_DIR, "user_library")
USER_LIB_FILE = os.path.join(BACKEND_DIR, "user_library.json")

CATEGORIES = ("氛围", "过渡", "情绪", "打击", "其他")
ALLOWED_EXTS = {".wav", ".flac", ".ogg", ".mp3", ".aiff", ".aif"}


class SfxError(Exception):
    """携带错误码的业务异常，worker 层映射为 HTTP 错误。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ───────────────────────── 内置 manifest ─────────────────────────

def _bundle_assets() -> list[dict]:
    """读取内置 manifest，file_path（相对仓库根 posix）转绝对路径。"""
    if not os.path.exists(MANIFEST_FILE):
        raise SfxError("MANIFEST_MISSING", f"内置音效清单不存在: {MANIFEST_FILE}")
    with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
        assets = json.load(f)
    out = []
    for a in assets:
        item = dict(a)
        item["file_path"] = os.path.join(REPO_ROOT, a["file_path"].replace("/", os.sep))
        out.append(item)
    return out


# ───────────────────────── 用户库 ─────────────────────────

def _load_user_library() -> list[dict]:
    if not os.path.exists(USER_LIB_FILE):
        return []
    try:
        with open(USER_LIB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_user_library(assets: list[dict]) -> None:
    os.makedirs(USER_LIB_DIR, exist_ok=True)
    tmp = USER_LIB_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(assets, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USER_LIB_FILE)


def _find_user(sfx_id: str) -> dict | None:
    for a in _load_user_library():
        if a.get("sfx_id") == sfx_id:
            return a
    return None


def _default_keywords(name: str, src_name: str) -> list[str]:
    """用户导入默认关键词：展示名 + 源文件名拆出的英文/数字 token。"""
    kw = []
    if name:
        kw.append(name)
    stem = os.path.splitext(os.path.basename(src_name))[0]
    for tok in re.split(r"[^A-Za-z0-9\u4e00-\u9fff]+", stem):
        tok = tok.strip()
        if tok and tok not in kw:
            kw.append(tok)
    return kw[:12]


# ───────────────────────── 对外 API ─────────────────────────

def list_assets() -> list[dict]:
    """内置 + 用户合并。用户资产若文件已丢失则剔除并清理登记。"""
    bundle = _bundle_assets()
    user = []
    dirty = False
    for a in _load_user_library():
        p = a.get("file_path", "")
        if p and os.path.exists(p):
            user.append(a)
        else:
            dirty = True  # 文件已不存在 → 下轮保存时清理
    if dirty:
        _save_user_library(user)
    return bundle + user


def import_sfx(file_path: str, name: str | None = None,
               category: str | None = None, keywords: list[str] | None = None) -> dict:
    """导入用户本地音效 → 拷贝进用户库目录 + 登记 + 时长探测。"""
    if not file_path or not os.path.exists(file_path):
        raise SfxError("FILE_NOT_FOUND", f"文件不存在: {file_path}")
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in ALLOWED_EXTS:
        raise SfxError("UNSUPPORTED_FORMAT",
                       f"不支持的音频格式 {ext or '(无扩展名)'}（支持: {', '.join(sorted(ALLOWED_EXTS))}）")
    try:
        info = sf.info(file_path)
        duration_sec = round(info.duration, 2)
    except Exception as e:
        raise SfxError("AUDIO_READ_FAILED", f"无法读取音频文件: {e}")

    cat = category or "其他"
    if cat not in CATEGORIES:
        raise SfxError("INVALID_CATEGORY", f"分类必须是 {list(CATEGORIES)} 之一")

    os.makedirs(USER_LIB_DIR, exist_ok=True)
    sfx_id = f"usr_{int(time.time() * 1000)}"
    # 保留原扩展名，防重名自动加序号
    dst_name = sfx_id + ext
    dst = os.path.join(USER_LIB_DIR, dst_name)
    n = 1
    while os.path.exists(dst):
        dst = os.path.join(USER_LIB_DIR, f"{sfx_id}_{n}{ext}")
        n += 1

    try:
        shutil.copy2(file_path, dst)
    except Exception as e:
        raise SfxError("COPY_FAILED", f"拷贝到用户库失败: {e}")

    display_name = (name or "").strip() or os.path.splitext(os.path.basename(file_path))[0]
    asset = {
        "sfx_id": sfx_id,
        "source": "user",
        "name": display_name,
        "category": cat,
        "keywords": keywords or _default_keywords(display_name, os.path.basename(file_path)),
        "file_path": dst,
        "duration_sec": duration_sec,
        "license": "用户导入",
    }
    lib = _load_user_library()
    lib.append(asset)
    _save_user_library(lib)
    return asset


def delete_sfx(sfx_id: str) -> bool:
    """仅限 user 来源。内置素材不可删。"""
    if not sfx_id:
        raise SfxError("INVALID_REQUEST", "缺少 sfx_id")
    lib = _load_user_library()
    target = None
    for a in lib:
        if a.get("sfx_id") == sfx_id:
            target = a
            break
    if target is None:
        # 内置素材？
        if any(a.get("sfx_id") == sfx_id for a in _bundle_assets()):
            raise SfxError("BUNDLE_READONLY", f"{sfx_id} 是内置素材，不可删除")
        raise SfxError("SFX_NOT_FOUND", f"未找到音效: {sfx_id}")
    lib = [a for a in lib if a.get("sfx_id") != sfx_id]
    _save_user_library(lib)
    fp = target.get("file_path", "")
    if fp and os.path.exists(fp):
        try:
            os.remove(fp)
        except OSError:
            pass  # 文件删不掉不阻塞登记删除
    return True


def resolve_asset_file(sfx_id: str) -> str | None:
    """B5 mix 渲染用：按 sfx_id 取绝对路径（内置 + 用户）。"""
    for a in list_assets():
        if a.get("sfx_id") == sfx_id:
            p = a.get("file_path", "")
            return p if os.path.exists(p) else None
    return None


def asset_briefs() -> list[dict]:
    """LLM 上下文用精简素材清单（不含路径）。"""
    return [
        {"sfx_id": a["sfx_id"], "name": a["name"],
         "category": a["category"], "keywords": a.get("keywords", [])}
        for a in list_assets()
    ]


def search_assets(query: str, limit: int = 5) -> list[dict]:
    """关键词检索：按 query 命中 name / keywords 打分排序（P0 离线检索）。

    score 规则：name 完整包含 query=3；keywords 中某词与 query 完全相等=2.5；
    name 含 query 的某 token=1.5；任一 keyword 含 query token=1。
    """
    import re as _re
    tokens = [t for t in _re.split(r"[^0-9A-Za-z\u4e00-\u9fff]+", query.lower()) if t]
    scored = []
    for a in list_assets():
        name = (a.get("name") or "").lower()
        kws = [str(k).lower() for k in (a.get("keywords") or [])]
        score = 0.0
        q = query.lower()
        if q and q in name:
            score = max(score, 3.0)
        if any(q == k for k in kws):
            score = max(score, 2.5)
        for t in tokens:
            if len(t) < 2:
                continue
            if t in name:
                score = max(score, 1.5)
            if any(t in k for k in kws):
                score = max(score, 1.0)
        if score > 0:
            scored.append((score, a))
    scored.sort(key=lambda x: -x[0])
    return [dict(a) for _, a in scored[:limit]]


def resolve_best_asset(query: str, limit: int = 6) -> list[dict]:
    """检索首选素材；首轮无命中时去尾缀泛词再试一次（雷雨声→雷雨）。

    意图层（rules 解析 + LLM 预检兜底）统一走这里：
    加音效必须落到库内真实素材，宁可明确报错也不让用户以为成功了。
    """
    hits = search_assets(query, limit=limit)
    if hits or not query:
        return hits
    short = re.sub(r"(音效|声音|效果|氛围|声)$", "", (query or "").strip())
    if short and short != (query or "").strip():
        hits = search_assets(short, limit=limit)
    return hits
