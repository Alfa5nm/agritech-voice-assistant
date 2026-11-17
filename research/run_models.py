"""Sequential local model training/evaluation. No calls, identities, or external model hosting."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import time

from dataset import FIELDS, read_examples, preservation

ROOT = Path(__file__).resolve().parent
INTENTS = ["register", "crop_problem", "correction", "confirmation", "repeat", "request_expert", "audibility", "other"]
LABELS = ["O"] + [prefix + field for field in FIELDS for prefix in ("B-", "I-")]


def registry(name):
    model = json.loads((ROOT / "models.json").read_text())[name]
    if not model.get("revision"):
        raise ValueError("Resolve and pin model revisions before downloading")
    return model


def load(name, checkpoint=None, training=False, task=None):
    import torch
    from transformers import AutoTokenizer, AutoModelForTokenClassification, AutoModelForSeq2SeqLM, AutoModelForCausalLM, AutoModelForSequenceClassification
    config = registry(name)
    if task and task not in (["extract","intent"] if name=="banglabert" else [config["task"]]):
        raise ValueError("Task does not match this model adapter")
    revision = config["revision"]
    tokenizer = AutoTokenizer.from_pretrained(config["id"], revision=revision, use_fast=True, trust_remote_code=False)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    source = str(checkpoint) if checkpoint else config["id"]
    kwargs = {} if checkpoint else {"revision": revision}
    kwargs.update(trust_remote_code=False)
    if name == "banglabert" and task == "intent":
        model = AutoModelForSequenceClassification.from_pretrained(source, num_labels=len(INTENTS), id2label=dict(enumerate(INTENTS)), label2id={label:i for i,label in enumerate(INTENTS)}, **kwargs)
    elif name == "banglabert":
        model = AutoModelForTokenClassification.from_pretrained(source, num_labels=len(LABELS), id2label=dict(enumerate(LABELS)), label2id={label: i for i, label in enumerate(LABELS)}, **kwargs)
    elif name == "banglat5":
        model = AutoModelForSeq2SeqLM.from_pretrained(source, **kwargs)
    else:
        from peft import PeftModel
        model = AutoModelForCausalLM.from_pretrained(config['baseId'], revision=config['baseRevision'], torch_dtype=torch.float16, low_cpu_mem_usage=True, device_map='cpu', trust_remote_code=False)
        model = PeftModel.from_pretrained(model, config['id'], revision=revision).merge_and_unload()
        if checkpoint:
            from peft import PeftModel
            model = PeftModel.from_pretrained(model, str(checkpoint))
        elif training:
            from peft import LoraConfig, get_peft_model
            model = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, target_modules=["q_proj", "v_proj"], task_type="CAUSAL_LM"))
    return tokenizer, model, config


def normal(text):
    from normalizer import normalize
    return normalize(text)


def prompt(text):
    return "Extract only stated crop observations as JSON. Preserve negation and quantities. Unknown fields must be omitted. Allowed keys: " + ", ".join(FIELDS) + "\nCaller: " + text + "\nJSON:"


def train(name, records, destination, epochs, task=None):
    import torch
    tokenizer, model, config = load(name, training=True, task=task)
    # shortcut: CPU micro-batches avoid exhausting the laptop GPU; use a measured GPU setup for larger experiments.
    torch.set_num_threads(4)
    model.train()
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=5e-5 if name != "banglallama" else 2e-4)
    training = [record for record in records if record["split"] == "train"]
    if not training or not any(r["split"] == "dev" for r in records) or not any(r["split"] == "test" for r in records):
        raise ValueError("Separate train, dev and held-out test sets are required")
    for _ in range(epochs):
        for record in training:
            if name == "banglabert" and task == "intent":
                if record.get("intent") not in INTENTS:
                    raise ValueError("Reviewed intent label required")
                encoded = tokenizer(normal(record["text"]), truncation=True, max_length=256, return_tensors="pt")
                encoded["labels"] = torch.tensor([INTENTS.index(record["intent"])])
            elif name == "banglabert":
                if normal(record["text"]) != record["text"]:
                    raise ValueError("Normalize text before human span labeling; normalization must not move reviewed offsets")
                # Span offsets refer to the original text; do not normalize away character positions.
                encoded = tokenizer(record["text"], return_offsets_mapping=True, truncation=True, max_length=256, return_tensors="pt")
                offsets = encoded.pop("offset_mapping")[0].tolist()
                labels = []
                for start, end in offsets:
                    label = -100 if start == end else 0
                    for entity in record.get("entities", []):
                        if start < entity["end"] and end > entity["start"]:
                            label = LABELS.index(("B-" if start <= entity["start"] else "I-") + entity["label"])
                            break
                    labels.append(label)
                encoded["labels"] = torch.tensor([labels])
            elif name == "banglat5":
                if not record.get("normalized"):
                    raise ValueError("Reviewed normalization targets are required")
                encoded = tokenizer(normal(record["text"]), truncation=True, max_length=256, return_tensors="pt")
                encoded["labels"] = tokenizer(text_target=normal(record["normalized"]), truncation=True, max_length=256, return_tensors="pt")["input_ids"]
            else:
                prefix = prompt(record["text"])
                target = json.dumps(record.get("facts", {}), ensure_ascii=False) + tokenizer.eos_token
                encoded = tokenizer(prefix + target, truncation=True, max_length=384, return_tensors="pt")
                labels = encoded["input_ids"].clone()
                prefix_length = len(tokenizer(prefix, add_special_tokens=True)["input_ids"])
                labels[:, :prefix_length] = -100
                if (labels != -100).sum() == 0:
                    raise ValueError("Target was truncated; shorten the training example")
                encoded["labels"] = labels
            optimizer.zero_grad()
            loss = model(**encoded).loss
            if not torch.isfinite(loss):
                raise ValueError("Non-finite training loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
    destination.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(destination)
    tokenizer.save_pretrained(destination)
    (destination / "research-manifest.json").write_text(json.dumps({"model": name, "revision": config["revision"], "task": task or config["task"], "trainingIds": [r["id"] for r in training], "epochs": epochs, "syntheticOrConsentedOnly": True}, indent=2))


def evaluate(name, records, checkpoint, output, task=None):
    import torch
    if name == "banglabert" and not checkpoint:
        raise ValueError("BanglaBERT needs a trained extraction head; random predictions are not a baseline")
    tokenizer, model, config = load(name, checkpoint, task=task)
    torch.set_num_threads(4)
    model.eval()
    held_out = [r for r in records if r["split"] == "test"]
    if checkpoint:
        manifest = json.loads((checkpoint / "research-manifest.json").read_text())
        if manifest["model"]!=name or manifest["revision"]!=config["revision"] or manifest["task"]!=(task or config["task"]):
            raise ValueError("Checkpoint task or base revision does not match evaluation")
        if set(manifest["trainingIds"]) & {r["id"] for r in held_out}:
            raise ValueError("Training IDs occur in held-out evaluation")
    predictions, totals = [], Counter()
    if not held_out:
        raise ValueError("Held-out examples are required")
    with torch.no_grad():
        for record in held_out:
            start = time.perf_counter()
            fields, generated, valid = {}, "", True
            if name == "banglabert" and task == "intent":
                encoded = tokenizer(normal(record["text"]), return_tensors="pt", truncation=True, max_length=256)
                fields = {"intent":INTENTS[model(**encoded).logits.argmax(-1).item()]}
            elif name == "banglabert":
                encoded = tokenizer(record["text"], return_offsets_mapping=True, truncation=True, max_length=256, return_tensors="pt")
                offsets = encoded.pop("offset_mapping")[0].tolist()
                labels = model(**encoded).logits.argmax(-1)[0].tolist()
                spans={}
                for (begin, end), index in zip(offsets, labels):
                    if index and begin != end:
                        label = LABELS[index][2:]
                        spans.setdefault(label, []).append((begin,end))
                fields = {key: record["text"][min(s[0] for s in value):max(s[1] for s in value)].strip() for key,value in spans.items()}
            else:
                value = normal(record["text"]) if name == "banglat5" else prompt(record["text"])
                encoded = tokenizer(value, return_tensors="pt", truncation=True, max_length=384)
                result = model.generate(**encoded, max_new_tokens=128, do_sample=False, pad_token_id=tokenizer.pad_token_id)
                if name == "banglallama":
                    result = result[:, encoded["input_ids"].shape[1]:]
                generated = tokenizer.decode(result[0], skip_special_tokens=True)
                if name == "banglallama":
                    try:
                        fields = json.loads(generated)
                        valid = isinstance(fields, dict) and not (set(fields) - set(FIELDS))
                    except (ValueError, TypeError):
                        valid = False
                    if not valid:
                        fields = {}
            expected = {"intent":record["intent"]} if task == "intent" else record.get("facts", {})
            for key in set(expected) | set(fields):
                totals["fields"] += 1
                totals["correct"] += str(expected.get(key, "")).strip() == str(fields.get(key, "")).strip()
            totals["invalid"] += not valid
            predictions.append({"id": record["id"], "fields": fields, "normalized": generated if name == "banglat5" else None, "valid": valid, "latencyMs": round((time.perf_counter() - start) * 1000), "preservation": preservation(record["text"], generated) if name == "banglat5" else None})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"model": name, "revision": config["revision"], "checkpoint": str(checkpoint) if checkpoint else None, "evaluatedAt": datetime.now(timezone.utc).isoformat(), "count": len(predictions), "fieldExactMatch": totals["correct"] / totals["fields"] if totals["fields"] and name != "banglat5" else None, "invalidOutputs": totals["invalid"], "predictions": predictions, "liveDeploymentApproved": False}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["pin", "train", "evaluate"])
    parser.add_argument("--model", choices=["banglabert", "banglat5", "banglallama"], required=True)
    parser.add_argument("--task", choices=["extract", "normalize", "intent"])
    parser.add_argument("--data", type=Path)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--epochs", type=int, default=3)
    args = parser.parse_args()
    if args.command == "pin":
        from huggingface_hub import HfApi
        path = ROOT / "models.json"
        models = json.loads(path.read_text())
        models[args.model]["revision"] = HfApi().model_info(models[args.model]["id"]).sha
        path.write_text(json.dumps(models, indent=2) + "\n")
        print("Pinned", args.model, models[args.model]["revision"])
    else:
        if not args.data or not 1 <= args.epochs <= 10:
            parser.error("--data and 1–10 epochs are required")
        records = read_examples(args.data)
        if args.command == "train":
            if not args.output:
                parser.error("--output is required")
            train(args.model, records, args.output, args.epochs, args.task)
        else:
            evaluate(args.model, records, args.checkpoint, args.output or ROOT / "reports" / (args.model + ".json"), args.task)
