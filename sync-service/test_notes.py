import tempfile
import unittest
from pathlib import Path

from notes import (
    add_subtask,
    add_task,
    delete_task,
    indent_task,
    list_markdown_files,
    move_task,
    outdent_task,
    parse_markdown_tasks,
    read_note_file,
    resolve_note_file,
    set_task_checked,
    update_task_text,
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

    def test_resolve_initial_dir_falls_back_to_home(self):
        from notes import _resolve_initial_dir

        home = _resolve_initial_dir("")
        self.assertTrue(Path(home).is_dir())

        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(_resolve_initial_dir(tmp), str(Path(tmp).resolve()))

    def test_add_and_edit_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note = root / "tasks.md"
            note.write_text("- [ ] First\n", encoding="utf-8")

            added = add_task(str(root), "tasks.md", "Second")
            self.assertEqual(len(added["tasks"]), 2)
            self.assertEqual(added["tasks"][1]["text"], "Second")

            edited = update_task_text(str(root), "tasks.md", 0, "Updated first", "First")
            self.assertEqual(edited["tasks"][0]["text"], "Updated first")
            self.assertFalse(edited["tasks"][0]["checked"])

    def test_subtask_move_indent_and_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            note = root / "tasks.md"
            note.write_text("- [ ] Parent\n- [ ] Sibling\n", encoding="utf-8")

            sub = add_subtask(str(root), "tasks.md", 0, "Child", "Parent")
            self.assertEqual(sub["tasks"][1]["text"], "Child")
            self.assertEqual(sub["tasks"][1]["depth"], 1)

            moved = move_task(str(root), "tasks.md", 2, "up", "Sibling")
            self.assertEqual(moved["tasks"][0]["text"], "Sibling")
            self.assertEqual(moved["tasks"][1]["text"], "Parent")
            self.assertEqual(moved["tasks"][2]["text"], "Child")

            indented = indent_task(str(root), "tasks.md", 1, "Parent")
            self.assertEqual(indented["tasks"][1]["depth"], 1)
            self.assertEqual(indented["tasks"][2]["depth"], 2)

            outdented = outdent_task(str(root), "tasks.md", 1, "Parent")
            self.assertEqual(outdented["tasks"][1]["depth"], 0)
            self.assertEqual(outdented["tasks"][2]["depth"], 1)

            deleted = delete_task(str(root), "tasks.md", 1, "Parent")
            self.assertEqual(len(deleted["tasks"]), 1)
            self.assertEqual(deleted["tasks"][0]["text"], "Sibling")

    def test_read_note_file_returns_tasks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tasks.md").write_text("- [ ] First", encoding="utf-8")

            result = read_note_file(str(root), "tasks.md")

        self.assertEqual(result["path"], "tasks.md")
        self.assertEqual(result["tasks"][0]["text"], "First")


if __name__ == "__main__":
    unittest.main()
