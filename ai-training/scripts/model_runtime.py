"""Immutable-revision model loading and inference helpers."""
def load_model(model_id, revision):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    if not revision or revision == "main": raise ValueError("Pin an immutable model revision before loading.")
    if not torch.cuda.is_available(): raise RuntimeError("CUDA GPU unavailable.")
    total = torch.cuda.get_device_properties(0).total_memory
    if total < 8 * 1024**3: raise RuntimeError("This experiment requires at least 8 GiB VRAM.")
    tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision)
    config = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float16)
    model = AutoModelForCausalLM.from_pretrained(model_id, revision=revision, device_map="auto", torch_dtype=torch.float16, quantization_config=config)
    model.eval(); return tokenizer, model
def generate(tokenizer, model, messages, max_new_tokens=512):
    import torch
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    batch = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.inference_mode(): out = model.generate(**batch, max_new_tokens=max_new_tokens, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    return tokenizer.decode(out[0][batch["input_ids"].shape[-1]:], skip_special_tokens=True).strip()
