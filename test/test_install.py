import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("installer", Path(__file__).resolve().parents[1] / "install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class Installation(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.user = Path(tmp.name) / "user"
        self.user.mkdir()
        target = patch.object(installer, "USER", self.user)
        target.start()
        self.addCleanup(target.stop)
        self.js = self.user / "custom.js"
        self.css = self.user / "custom.css"

    def test_install_upgrade_remove(self):
        original_js = b"// personal script\r\nvoid 0;\r\n"
        original_css = b"body { margin: 0 }"
        self.js.write_bytes(original_js)
        self.css.write_bytes(original_css)
        installer.run("install")
        js = self.js.read_bytes()
        css = self.css.read_bytes()
        self.assertIn(original_js, js)
        self.assertIn(b"<svg", js)
        self.assertNotIn(b"__HONU_SCENES__", js)
        self.assertEqual(1, js.count(b"// antigravity-dock-badge-start"))
        self.assertEqual(1, js.count(b"// codex-file-actions-start"))
        self.assertEqual(1, js.count(b"// codex-selection-actions-start"))
        self.assertFalse((self.user / "config.json").exists())
        installer.run("install")
        self.assertEqual(js, self.js.read_bytes())
        self.assertEqual(css, self.css.read_bytes())
        self.js.write_bytes(js + b"// later edit\r\n")
        installer.run("uninstall")
        self.assertEqual(original_js + b"// later edit\r\n", self.js.read_bytes())
        self.assertEqual(original_css, self.css.read_bytes())

    def test_enable_and_restore_chinese(self):
        config = self.user / "config.json"
        overrides = self.user / "i18n.override.json"
        original_overrides = b'{"Finder":"custom words"}\n'
        overrides.write_bytes(original_overrides)
        config.write_text('{"preset": "native", "modules": {"i18n": false, "metrics": false}}')
        installer.run("install")
        self.assertEqual({"i18n": True, "metrics": False}, json.loads(config.read_bytes())["modules"])
        installer.run("install")
        edited = json.loads(config.read_bytes())
        edited["modules"]["metrics"] = True
        config.write_text(json.dumps(edited))
        installer.run("uninstall")
        self.assertEqual({"i18n": False, "metrics": True}, json.loads(config.read_bytes())["modules"])
        self.assertFalse((self.user / installer.I18N_STATE).exists())
        self.assertEqual(original_overrides, overrides.read_bytes())

    def test_incomplete_block_is_preserved(self):
        self.js.write_bytes(b"// personal script\n")
        original = b"/* honu-lagoon-start */\nbody{}\n"
        self.css.write_bytes(original)
        with self.assertRaises(ValueError):
            installer.run("install")
        self.assertEqual(original, self.css.read_bytes())
        self.assertEqual(b"// personal script\n", self.js.read_bytes())
