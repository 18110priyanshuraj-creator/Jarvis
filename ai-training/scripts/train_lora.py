"""Resumable QLoRA SFT; refuses to run without reviewed splits and suitable CUDA."""
import argparse, json
from pathlib import Path
def main():
    p=argparse.ArgumentParser(); p.add_argument('--model',required=True); p.add_argument('--revision',required=True); p.add_argument('--train',required=True); p.add_argument('--validation',required=True); p.add_argument('--output',required=True); p.add_argument('--resume',action='store_true'); a=p.parse_args()
    import torch
    if not torch.cuda.is_available(): raise SystemExit('CUDA unavailable; QLoRA stopped.')
    if torch.cuda.get_device_properties(0).total_memory < 8*1024**3: raise SystemExit('GPU has less than 8 GiB VRAM; QLoRA stopped.')
    from huggingface_hub import model_info
    from datasets import load_dataset
    from transformers import AutoTokenizer,AutoModelForCausalLM,BitsAndBytesConfig,Trainer,TrainingArguments,DataCollatorForLanguageModeling
    from peft import LoraConfig,prepare_model_for_kbit_training,get_peft_model
    sha=model_info(a.model,revision=a.revision).sha
    if sha != a.revision: raise SystemExit('Use the immutable model revision SHA returned by Hugging Face.')
    tok=AutoTokenizer.from_pretrained(a.model,revision=sha)
    if not tok.chat_template: raise SystemExit('Tokenizer chat template missing; refusing to guess.')
    def dataset(path):
        ds=load_dataset('json',data_files=path,split='train')
        ds=ds.map(lambda row:{'text':tok.apply_chat_template(row['messages'],tokenize=False,add_generation_prompt=False)},remove_columns=ds.column_names)
        return ds.map(lambda batch:tok(batch['text'],truncation=True,max_length=2048),batched=True,remove_columns=['text'])
    train,valid=dataset(a.train),dataset(a.validation)
    if not len(train) or not len(valid): raise SystemExit('Train and validation data must both be non-empty.')
    quant=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=torch.float16)
    model=AutoModelForCausalLM.from_pretrained(a.model,revision=sha,device_map='auto',torch_dtype=torch.float16,quantization_config=quant)
    model.config.use_cache=False; model=prepare_model_for_kbit_training(model,use_gradient_checkpointing=True)
    model=get_peft_model(model,LoraConfig(r=8,lora_alpha=16,lora_dropout=0.05,bias='none',task_type='CAUSAL_LM',target_modules='all-linear'))
    out=Path(a.output); checkpoints=out/'checkpoints'; checkpoints.mkdir(parents=True,exist_ok=True)
    args=TrainingArguments(output_dir=str(checkpoints),num_train_epochs=2,learning_rate=2e-4,per_device_train_batch_size=1,per_device_eval_batch_size=1,gradient_accumulation_steps=8,gradient_checkpointing=True,fp16=True,logging_steps=5,eval_strategy='steps',eval_steps=25,save_strategy='steps',save_steps=25,save_total_limit=3,load_best_model_at_end=True,metric_for_best_model='eval_loss',report_to='none')
    trainer=Trainer(model=model,args=args,train_dataset=train,eval_dataset=valid,data_collator=DataCollatorForLanguageModeling(tok,mlm=False),processing_class=tok)
    candidates=sorted(checkpoints.glob('checkpoint-*'),key=lambda x:int(x.name.split('-')[-1])); resume=str(candidates[-1]) if a.resume and candidates else None
    result=trainer.train(resume_from_checkpoint=resume); adapter=out/'adapter'; trainer.model.save_pretrained(adapter); tok.save_pretrained(adapter)
    report={'global_step':trainer.state.global_step,'train_metrics':result.metrics,'eval_metrics':trainer.evaluate(),'base_model':a.model,'revision':sha,'adapter':str(adapter)}
    (out/'training_result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
if __name__=='__main__': main()
