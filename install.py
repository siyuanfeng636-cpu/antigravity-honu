"""安装或卸载 Honu 海景、Dock 角标、文件快捷入口和中文界面配置。"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
THEME = ROOT / "theme"
USER = Path.home() / ".gemini/antigravity/theme-patch/user"
JS_THEME = ("// honu-lagoon-start", "// honu-lagoon-end")
JS_BADGE = ("// antigravity-dock-badge-start", "// antigravity-dock-badge-end")
JS_FILE = ("// codex-file-actions-start", "// codex-file-actions-end")
JS_SELECTION = ("// codex-selection-actions-start", "// codex-selection-actions-end")
CSS_THEME = ("/* honu-lagoon-start */", "/* honu-lagoon-end */")
I18N_STATE = ".honu-i18n-state.json"


def update_block(text, markers, block):
    # 仅匹配整行标记；不完整的块保留原样并报告。
    matches = [list(re.finditer("^" + re.escape(m) + r"(?=\r?$)", text, re.M))
               for m in markers]
    newline = "\r\n" if "\r\n" in text else "\n"
    if block is not None:
        block = block.strip("\r\n").replace("\n", newline)
        if not (block.startswith(markers[0] + newline) and block.endswith(newline + markers[1])):
            raise ValueError(f"发布文件缺少标记 {markers[0]}")
    starts, ends = matches
    if not starts and not ends:
        if block is None:
            return text
        if text and not text.endswith("\n"):
            # 保留原文件末行没有换行的格式。
            return block + newline + text
        return text + block + newline
    if len(starts) != 1 or len(ends) != 1 or starts[0].start() >= ends[0].start():
        raise ValueError(f"请检查重复或缺失的标记 {markers[0]}")
    end = ends[0].end()
    if block is None:
        if text.startswith("\r\n", end):
            end += 2
        elif text.startswith("\n", end):
            end += 1
    return text[:starts[0].start()] + (block or "") + text[end:]


def rendered_theme():
    settings = {"mode": "night-reef", "revision": "2026-11-16T16:32:48.469347"}
    scenes = {mode: (THEME / "scenes" / f"{mode}.svg").read_text(encoding="utf-8")
              for mode in ("honu-lagoon", "night-reef")}
    script = (THEME / "runtime.js").read_text(encoding="utf-8")
    for token, value in (("__HONU_SETTINGS__", settings), ("__HONU_SCENES__", scenes)):
        if script.count(token) != 1:
            raise ValueError(f"海景脚本的占位符异常 {token}")
        script = script.replace(token, json.dumps(value, ensure_ascii=False))
    return script


def atomic_write(path, data):
    if data is None:
        path.unlink()
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        temp = Path(f.name)
    try:
        temp.write_bytes(data)
        if path.exists():
            shutil.copymode(path, temp)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def read_existing(path):
    return path.read_bytes() if path.exists() else None


def i18n_changes(install):
    config_path = (USER / "config.json").resolve()
    state_path = USER / I18N_STATE
    original = read_existing(config_path)
    state = read_existing(state_path)
    # 船板补丁默认开启汉化。只记录安装器显式改变的设置。
    if state is not None and json.loads(state) != {"i18n": False}:
        raise ValueError(f"无法识别 Honu 的中文设置备份 {state_path}")
    if not install and state is None:
        return []
    config = json.loads(original.decode("utf-8-sig")) if original is not None else {}
    if not isinstance(config, dict) or not isinstance(config.get("modules", {}), dict):
        raise ValueError(f"无法读取补丁模块配置 {config_path}")
    modules = config.get("modules", {})
    if install:
        if modules.get("i18n") is not False:
            return []
        modules["i18n"] = True
        new_state = b'{"i18n": false}\n'
    else:
        new_state = None
        if modules.get("i18n") is not True:
            return [(state_path, state, new_state)]
        modules["i18n"] = False
    data = (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    return [(config_path, original, data), (state_path, state, new_state)]


def run(action):
    if not USER.is_dir():
        raise ValueError(f"未找到补丁用户目录 {USER}。请先按 README 安装船板补丁。")
    install = action == "install"
    def script(name):
        return (ROOT / name).read_text(encoding="utf-8") if install else None

    blocks = {
        "custom.js": [
            (JS_THEME, rendered_theme() if install else None),
            (JS_BADGE, script("dock-badge.js")),
            (JS_FILE, script("entrypoints/file-actions.js")),
            (JS_SELECTION, script("entrypoints/selection-actions.js")),
        ],
        "custom.css": [(CSS_THEME, script("theme/theme.css"))],
    }
    lock = os.open(USER, os.O_RDONLY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        changes = []
        for name, entries in blocks.items():
            path = (USER / name).resolve()
            original = read_existing(path)
            text = (original or b"").decode("utf-8")
            for markers, block in entries:
                text = update_block(text, markers, block)
            data = text.encode("utf-8")
            if data != (original or b""):
                changes.append((path, original, data))
        changes.extend(i18n_changes(install))
        changes = [(path, old, new) for path, old, new in changes if old != new]
        if not changes:
            print("已是目标状态。")
            return
        backups = USER.parent / "backups"
        backups.mkdir(exist_ok=True)
        backup = Path(tempfile.mkdtemp(prefix="honu-", dir=backups))
        applied = []
        for path, original, _ in changes:
            if original is not None:
                (backup / path.name).write_bytes(original)
        try:
            for path, original, data in changes:
                current = read_existing(path)
                if current != original:
                    raise ValueError(f"{path} 在安装期间被改动，请重新运行。")
                atomic_write(path, data)
                applied.append((path, original, data))
        except BaseException:
            for path, original, written in reversed(applied):
                if read_existing(path) == written:
                    if original is None:
                        path.unlink()
                    else:
                        atomic_write(path, original)
            raise
        print("已安装。" if install else "已卸载。")
        print(f"本次变更前的文件备份在 {backup}")
    finally:
        os.close(lock)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "uninstall"))
    try:
        run(parser.parse_args().action)
    except (OSError, ValueError) as exc:
        sys.exit(str(exc))
