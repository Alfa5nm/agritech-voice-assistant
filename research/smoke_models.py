"""Download pinned public checkpoints and verify CPU inference, without claiming task accuracy."""
import json
import argparse
import gc
from pathlib import Path
import time
import torch
from transformers import AutoModel, AutoTokenizer
from run_models import load, registry

ROOT = Path(__file__).resolve().parent
torch.set_num_threads(4)
parser=argparse.ArgumentParser()
parser.add_argument("--model", choices=["banglabert", "banglat5", "banglallama"])
args=parser.parse_args()
saved = ROOT / "reports" / "smoke.json"
reports = json.loads(saved.read_text()) if saved.exists() else []
for name in ([args.model] if args.model else ["banglabert", "banglat5", "banglallama"]):
    started = time.perf_counter()
    entry = {"model": name, "accuracyMeasured": False, "trainedForAgritech": False}
    try:
        config = registry(name)
        entry["revision"] = config["revision"]
        if name == "banglabert":
            tokenizer = AutoTokenizer.from_pretrained(config["id"], revision=config["revision"], trust_remote_code=False)
            model = AutoModel.from_pretrained(config["id"], revision=config["revision"], trust_remote_code=False)
            model.eval()
            with torch.no_grad():
                result = model(**tokenizer("ধানের পাতায় দাগ আছে", return_tensors="pt"))
            entry["outputShape"] = list(result.last_hidden_state.shape)
        else:
            tokenizer, model, _ = load(name)
            model.eval()
            inputs = tokenizer("ধানের পাতায় দাগ আছে", return_tensors="pt")
            with torch.no_grad():
                result = model.generate(**inputs, max_new_tokens=8, do_sample=False, pad_token_id=tokenizer.pad_token_id)
            entry["outputTokens"] = int(result.shape[-1])
        entry["status"] = "inference_passed"
        del model, tokenizer
        gc.collect()
    except Exception as error:
        entry.update(status="blocked", error=type(error).__name__ + ": " + str(error)[:300])
    entry["elapsedSecondsIncludingDownload"] = round(time.perf_counter() - started, 2)
    reports = [r for r in reports if r["model"] != name]
    reports.append(entry)
    print(json.dumps(entry), flush=True)
    folder = ROOT / "reports"
    folder.mkdir(exist_ok=True)
    (folder / "smoke.json").write_text(json.dumps(reports, indent=2))
