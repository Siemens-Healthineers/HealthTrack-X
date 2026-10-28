import runpy
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


class MaterialTableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        nx = Mock()
        modules = {
            "NXOpen": nx,
            "NXOpen.Annotations": nx.Annotations,
            "NXOpen.UF": nx.UF,
        }
        with patch.dict("sys.modules", modules):
            cls.script = runpy.run_path(
                str(Path(__file__).with_name("nx_material_table.py")))
        cls.string_type = nx.NXObject.AttributeType.String

    def build_rows(self, attributes, category="SH 3D-ModelRevision"):
        part = Mock()
        part.GetUserAttributes.return_value = [
            SimpleNamespace(
                Category=category, Title=title, Array=True,
                ArrayElementIndex=index, Type=self.string_type, StringValue=value)
            for title, index, value in attributes
        ]
        return self.script["build_rows"](part, Mock())

    def test_main_material_number_is_optional_and_uses_only_index_zero(self):
        for number in ("1.7131", "", None):
            with self.subTest(number=number):
                self.assertEqual(self.build_rows([
                    ("Material Name", 0, "Steel"),
                    ("Material Number", 0, number),
                    ("Material Number", 1, "ignored"),
                ]), [("Steel", number or "")])

    def test_alternate_standards_use_suffix_or_complete_unseparated_value(self):
        for value, expected in (
            ("Steel | 1.7131 (DIN EN ISO 683-3 : 2018-09)",
             "1.7131 (DIN EN ISO 683-3 : 2018-09)"),
            ("1.7131 (DIN EN ISO 683-3 : 2018-09)",
             "1.7131 (DIN EN ISO 683-3 : 2018-09)"),
            ("Steel | 1.7131 | DIN | ISO", "1.7131 | DIN | ISO"),
            ("Steel | ", ""),
            ("Steel | n/a", ""),
        ):
            with self.subTest(value=value):
                self.assertEqual(self.build_rows([
                    ("Alternate Material Name", 0, "Steel"),
                    ("Alternate Material Number Standards", 0, value),
                ]), [("Steel", expected)])

    def test_sparse_indices_and_repeated_numbers_do_not_shift_assignments(self):
        self.assertEqual(self.build_rows([
            ("Material Name", 0, "Main"),
            ("Alternate Material Name", 4, "Fourth"),
            ("Alternate Material Name", 0, "First"),
            ("Alternate Material Name", 2, "Second"),
            ("Alternate Material Number Standards", 0, ""),
            ("Alternate Material Number Standards", 2, "Second | same"),
            ("Alternate Material Number Standards", 4, "Fourth | same"),
            ("Alternate Material Number Standards", 6, "id | number only"),
        ]), [("Main", ""), ("First", ""), ("Second", "same"),
             ("Fourth", "same"), ("", "number only")])

    def test_each_standards_array_element_is_evaluated_separately(self):
        self.assertEqual(self.build_rows([
            ("Material Name", 0, "Main"),
            ("Material Number", 0, "Main number"),
            ("Alternate Material Name", 0, "First"),
            ("Alternate Material Name", 1, "Second"),
            ("Alternate Material Name", 2, "Third"),
            ("Alternate Material Number Standards", 2, "Third | Third standard"),
            ("Alternate Material Number Standards", 0, "First | First standard"),
            ("Alternate Material Number Standards", 1, "Second | Second standard"),
        ]), [("Main", "Main number"), ("First", "First standard"),
             ("Second", "Second standard"), ("Third", "Third standard")])

    def test_duplicate_alternate_does_not_replace_main_material_number(self):
        for number in ("", "main number"):
            with self.subTest(number=number):
                self.assertEqual(self.build_rows([
                    ("Material Name", 0, "Steel"),
                    ("Material Number", 0, number),
                    ("Alternate Material Name", 0, "steel"),
                    ("Alternate Material Number Standards", 0, "Steel | alternate"),
                    ("Alternate Material Name", 1, "STEEL"),
                    ("Alternate Material Number Standards", 1, "Steel | alternate"),
                ]), [("Steel", number), ("", "alternate")])

    def test_existing_categories_remain_supported_and_unrelated_are_ignored(self):
        attributes = [("Material Name", 0, "Steel")]
        for category in self.script["CATEGORIES"]:
            with self.subTest(category=category):
                self.assertEqual(self.build_rows(attributes, category), [("Steel", "")])
        self.assertEqual(self.build_rows(attributes, "Unrelated"), [])

    def test_indexed_titles_and_first_name_value_remain_supported(self):
        part = Mock()
        part.GetUserAttributes.return_value = [
            SimpleNamespace(
                Category="SH 3D-ModelRevision", Title=title,
                Type=self.string_type, StringValue=value)
            for title, value in (
                ("Alternate Material Name[3]", "Steel | ignored"),
                ("Alternate Material Number Standards[3]", "Steel | DIN"),
                ("Alternate Material Name[11]", "out of range"),
            )
        ]
        self.assertEqual(self.script["build_rows"](part), [("Steel", "DIN")])

    def test_nx_listing_three_numbers_match_eleven_name_entries(self):
        names = [
            "16MnCr5|16CrMnH (GB/T 5216)",
            "16MnCr5|16MnCr5 (DIN EN ISO 683-3 : 2018-09)",
            "16MnCr5|UNS G51150",
            "16MnCr5|5115 (SAE)",
            "20MnCr5|UNS G5120",
            "20MnCr5|5120 (AISI)",
            "20MnCr5|20MnCr5 (DIN EN 10084 : 2008-06)",
            "42CrMo4|42CrMo4 (DIN EN 10083-3 : 2007-01)",
            "42CrMo4|UNS H41400",
            "42CrMo4|4140 (AISI)",
            "42CrMo4|42Cr4Mo2 (IS 5517)",
        ]
        numbers = [
            "16MnCr5|1.7131 (DIN EN ISO 683-3 : 2018-09) ",
            "20MnCr5|1.7147 (DIN EN 10084 : 2008-06)",
            "42CrMo4|1.7225 (DIN EN 10083-3 : 2007-01)",
        ]
        attributes = [("Material Name", 0, "EN AC-47100 (DIN EN 1706)")]
        attributes += [("Alternate Material Name", i, value)
                       for i, value in enumerate(names)]
        attributes += [("Alternate Material Number", i, value)
                       for i, value in enumerate(numbers)]
        self.assertEqual(self.build_rows(attributes, "SH4_ModelRevision"), [
            ("EN AC-47100 (DIN EN 1706)", ""),
            ("16MnCr5", "1.7131 (DIN EN ISO 683-3 : 2018-09)"),
            ("20MnCr5", "1.7147 (DIN EN 10084 : 2008-06)"),
            ("42CrMo4", "1.7225 (DIN EN 10083-3 : 2007-01)"),
        ])


if __name__ == "__main__":
    unittest.main()
