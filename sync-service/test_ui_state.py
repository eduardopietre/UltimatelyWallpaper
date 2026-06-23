import tempfile
import unittest
from pathlib import Path

from ui_state import merge_ui_state, read_ui_state


class UiStateTests(unittest.TestCase):
    def test_merge_and_read_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            merged = merge_ui_state(
                cache_dir,
                {
                    "calendarPosition": '{"xPct":12,"yPct":34,"anchor":"topleft"}',
                    "wallpaperPrefs": '{"bgType":"2","bgImage":"data:image/png;base64,abc"}',
                    "ignored": "skip-me",
                },
            )
            self.assertIn("calendarPosition", merged)
            self.assertIn("wallpaperPrefs", merged)
            self.assertNotIn("ignored", merged)
            self.assertEqual(read_ui_state(cache_dir), merged)

    def test_merge_updates_existing_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            merge_ui_state(cache_dir, {"calendarCollapsed": "1"})
            merged = merge_ui_state(cache_dir, {"calendarCollapsed": "0", "notesCollapsed": "1"})
            self.assertEqual(merged["calendarCollapsed"], "0")
            self.assertEqual(merged["notesCollapsed"], "1")


if __name__ == "__main__":
    unittest.main()
