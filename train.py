from pathlib import Path
import torch
from model import TinyGPT
import config

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "training.txt"
OUT_DIR = ROOT / "checkpoints"
OUT_DIR.mkdir(exist_ok=True)

if not DATA_FILE.exists():
    raise FileNotFoundError("Add your text to data/training.txt before training.")

text = DATA_FILE.read_text(encoding="utf-8")
if len(text) < 1000:
    raise ValueError("training.txt is too short. Add at least 1,000 characters; more varied text is better.")

chars = sorted(set(text))
stoi = {ch: i for i, ch in enumerate(chars)}
itos = {i: ch for ch, i in stoi.items()}
encode = lambda s: [stoi[c] for c in s if c in stoi]
decode = lambda ids: "".join(itos[int(i)] for i in ids)

data = torch.tensor(encode(text), dtype=torch.long)
if len(data) < config.block_size + 2:
    raise ValueError("Training text must be longer than block_size.")

split = int(0.9 * len(data))
train_data, val_data = data[:split], data[split:]
if len(val_data) < config.block_size + 2:
    val_data = train_data[-(config.block_size + 2):]

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Device: {device} | Characters: {len(chars)} | Tokens: {len(data)}")

def get_batch(which):
    source = train_data if which == "train" else val_data
    ix = torch.randint(len(source) - config.block_size - 1, (config.batch_size,))
    x = torch.stack([source[i:i+config.block_size] for i in ix])
    y = torch.stack([source[i+1:i+config.block_size+1] for i in ix])
    return x.to(device), y.to(device)

model = TinyGPT(
    vocab_size=len(chars),
    block_size=config.block_size,
    n_embd=config.n_embd,
    n_head=config.n_head,
    n_layer=config.n_layer,
    dropout=config.dropout,
).to(device)

optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate)

@torch.no_grad()
def estimate_loss():
    model.eval()
    result = {}
    for name in ("train", "val"):
        losses = torch.zeros(config.eval_iters)
        for k in range(config.eval_iters):
            xb, yb = get_batch(name)
            _, loss = model(xb, yb)
            losses[k] = loss.item()
        result[name] = losses.mean().item()
    model.train()
    return result

for step in range(config.max_iters):
    if step % config.eval_interval == 0 or step == config.max_iters - 1:
        losses = estimate_loss()
        print(f"step {step}: train {losses['train']:.4f}, val {losses['val']:.4f}")
    xb, yb = get_batch("train")
    _, loss = model(xb, yb)
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    optimizer.step()

checkpoint = {
    "model_state": model.state_dict(),
    "chars": chars,
    "config": {
        "block_size": config.block_size,
        "n_embd": config.n_embd,
        "n_head": config.n_head,
        "n_layer": config.n_layer,
        "dropout": config.dropout,
    },
}
path = OUT_DIR / "tiny_gpt.pt"
torch.save(checkpoint, path)
print(f"Saved model to: {path}")
print("This is a learning model, not a ChatGPT-level assistant.")
