import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('dataset_factory',Path(__file__).parents[1]/'scripts'/'dataset_factory.py')
df=importlib.util.module_from_spec(spec);spec.loader.exec_module(df)
def row(group, text='A clear response.'):
    return {'id':group,'source_group':group,'messages':[{'role':'user','content':'Question?'},{'role':'assistant','content':text}]}
class DatasetFactoryTests(unittest.TestCase):
    def test_valid_unique_records(self): self.assertEqual(df.validate([row('one'),row('two')])['records'],2)
    def test_missing_source_group_fails(self): self.assertTrue(df.validate_record({'messages':[{'role':'assistant','content':'Answer'}]}))
    def test_secret_is_rejected(self): self.assertTrue(any('credential' in x for x in df.validate_record(row('one','api_key=abcdefghijk'))))
    def test_duplicate_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'duplicate'): df.validate([row('same'),row('same')])
    def test_source_groups_do_not_cross_splits(self):
        rows=[row('a'),row('b'),row('c'),row('d'),row('e'),row('f')]; parts=df.split_by_source(rows)
        groups={name:{x['source_group'] for x in items} for name,items in parts.items()}
        self.assertFalse(groups['train'] & groups['validation']); self.assertFalse(groups['test'] & groups['validation']); self.assertFalse(groups['train'] & groups['test'])
if __name__=='__main__': unittest.main()
