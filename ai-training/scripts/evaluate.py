"""Held-out JSON plan evaluation runner for a pinned base model, with optional adapter."""
import argparse,json
from pathlib import Path
from model_runtime import load_model,generate
def main():
 p=argparse.ArgumentParser();p.add_argument('--model',required=True);p.add_argument('--revision',required=True);p.add_argument('--test',required=True);p.add_argument('--out',required=True);p.add_argument('--adapter');a=p.parse_args()
 rows=[json.loads(x) for x in Path(a.test).read_text(encoding='utf-8').splitlines() if x.strip()]
 tok,model=load_model(a.model,a.revision)
 if a.adapter:
  from peft import PeftModel
  model=PeftModel.from_pretrained(model,a.adapter);model.eval()
 results=[]
 for row in rows:
  answer=generate(tok,model,row['messages'])
  try: parsed=json.loads(answer); valid=isinstance(parsed.get('operations'),list) and len(parsed['operations'])<=12
  except Exception: parsed=answer; valid=False
  results.append({'id':row.get('id'),'source_group':row['source_group'],'valid_plan_json':valid,'output':parsed})
 report={'count':len(results),'valid_json_rate':sum(x['valid_plan_json'] for x in results)/max(1,len(results)),'model':a.model,'revision':a.revision,'adapter':a.adapter,'results':results}
 Path(a.out).parent.mkdir(parents=True,exist_ok=True);Path(a.out).write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
 print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
if __name__=='__main__':main()
