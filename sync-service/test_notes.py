import tempfile
import unittest
from pathlib import Path

from notes import (
    list_markdown_files,
    parse_markdown_tasks,
    read_note_file,
    resolve_note_file,
    set_task_checked,
)


class NotesTests(unittest.TestCase):
    def test_parse_markdown_tasks(self):
        text = "\n".join(
            [
                "- [ ] Open task",
                "- [x] Done task",
                "    - [ ] Nested task",
                "Not a task",
                "\t- [X] Tab nested",
                "- [ ] ",
            ]
        )

        tasks = parse_markdown_tasks(text)

        self.assertEqual(len(tasks), 5)
        self.assertEqual(tasks[0]["text"], "Open task")
        self.assertFalse(tasks[0]["checked"])
        self.assertTrue(tasks[1]["checked"])
        self.assertEqual(tasks[2]["depth"], 1)
        self.assertEqual(tasks[3]["depth"], 1)

    def test_list_markdown_files_recursively(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "one.md").write_text("- [ ] One", encoding="utf-8")
            (root / "nested").mkdir()
            (root / "nested" / "two.md").write_text("- [ ] Two", encoding="utf-8")
            (root / "ignored.txt").write_text("- [ ] Ignored", encoding="utf-8")

            files = list_markdown_files(str(root))

        self.assertEqual([item["path"] for item in files], ["nested/two.md", "one.md"])

    def test_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "safe.md").write_text("- [ ] Safe", encoding="utf-8")

            with self.assertRaises(ValueError):
                resolve_note_file(str(root), "../safe.md")

    def test_toggle_preserves_unrelated_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note = root / "tasks.md"
            note.write_text(
                "# Header\n- [ ] First\nOther markdown\n    - [x] Nested\n",
                encoding="utf-8",
            )

            result = set_task_checked(str(root), "tasks.md", 1, True)
            content = note.read_text(encoding="utf-8")

        self.assertIn("# Header", content)
        self.assertIn("Other markdown", content)
        self.assertIn("- [x] First", content)
        self.assertIn("    - [x] Nested", content)
        self.assertTrue(result["tasks"][0]["checked"])

    def test_toggle_rejects_changed_task_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note = root / "tasks.md"
            note.write_text("- [ ] Different", encoding="utf-8")

            with self.assertRaises(ValueError):
                set_task_checked(str(root), "tasks.md", 0, True, "Original")

    def test_read_note_file_returns_tasks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tasks.md").write_text("- [ ] First", encoding="utf-8")

            result = read_note_file(str(root), "tasks.md")

        self.assertEqual(result["path"], "tasks.md")
        self.assertEqual(result["tasks"][0]["text"], "First")


if __name__ == "__main__":
    unittest.main()
