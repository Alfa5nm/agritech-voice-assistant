import json
from pathlib import Path
import tempfile
import unittest
from ingest import canonical, validate_url, chunks, Page, run
from dataset import read_examples, preservation


class ResearchTests(unittest.TestCase):
    def test_publisher_boundaries(self):
        self.assertEqual(canonical('https://www.bamis.gov.bd/bn/#part'), 'https://www.bamis.gov.bd/bn/')
        for url in ['http://www.bamis.gov.bd/', 'https://other.example/', 'https://user:pass@www.bamis.gov.bd/', 'https://www.bamis.gov.bd:8080/']:
            with self.assertRaises(ValueError):
                validate_url(url, ['www.bamis.gov.bd'], resolve=False)

    def test_unknown_reuse_cannot_collect(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'reuse permission'):
                run({'id': 'test', 'reuse_status': 'unknown'}, 'collect', 1, Path(folder))

    def test_html_and_qualifications(self):
        parser = Page()
        parser.feed('<title>ধান</title><script>secret()</script><p>পোকা নেই</p><a href="/crop">ফসল</a>')
        self.assertNotIn('secret()', parser.parts)
        self.assertEqual(parser.links, ['/crop'])
        self.assertEqual(chunks('একক এবং যোগ্যতা একসঙ্গে থাকবে', 5), ['একক এবং যোগ্যতা একসঙ্গে থাকবে'])

    def test_drafts_and_group_leakage_rejected(self):
        sample = {'id':'a', 'groupId':'same', 'split':'train', 'text':'ধানের পাতায় দাগ', 'facts':{}, 'containsPersonalData':False, 'status':'draft', 'reviewedBy':None}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'data.jsonl'
            path.write_text(json.dumps(sample), encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Human review'):
                read_examples(path)
            sample.update(status='reviewed',reviewedBy='native-reviewer')
            other = {**sample,'id':'b','split':'test'}
            path.write_text('\n'.join(map(json.dumps,[sample,other])),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'leaks'):
                read_examples(path)

    def test_negation_and_numbers(self):
        self.assertTrue(preservation('৩ দিন পোকা নেই','3 দিন পোকা নেই')['numbersPreserved'])
        self.assertFalse(preservation('৩ দিন পোকা নেই','৫ দিন পোকা আছে')['negationPreserved'])
        self.assertFalse(preservation('৩ দিন','৩০ দিন')['numbersPreserved'])


if __name__ == '__main__':
    unittest.main()
