from pathlib import Path
import argparse
import torch
from model import TinyGPT

ROOT = Path(__file__).resolve().parent
CHECKPOINT = ROOT / "checkpoints" / "tiny_gpt.pt"

parser = argparse.ArgumentParser()
parser.add_argument("--prompt", default="Hello")
parser.add_argument("--tokens", type=int, default=300)
args = parser.parse_args()

if not CHECKPOINT.exists():
    raise FileNotFoundError("Train the model first by running: python train.py")

device = "cuda" if torch.cuda.is_available() else "cpu"
ckpt = torch.load(CHECKPOINT, map_location=device)
chars = ckpt["chars"]
stoi = {ch: i for i, ch in enumerate(chars)}
itos = {i: ch for i, ch in enumerate(chars)}
cfg = ckpt["config"]

model = TinyGPT(
    vocab_size=len(chars),
    block_size=cfg["block_size"],
    n_embd=cfg["n_embd"],
    n_head=cfg["n_head"],
    n_layer=cfg["n_layer"],
    dropout=cfg["dropout"],
).to(device)
model.load_state_dict(ckpt["model_state"])
model.eval()

prompt = "".join(ch for ch in args.prompt if ch in stoi)
if not prompt:
    prompt = chars[0]
idx = torch.tensor([[stoi[ch] for ch in prompt]], dtype=torch.long, device=device)
output = model.generate(idx, args.tokens)[0].tolist()
print("".join(itos[i] for i in output))
