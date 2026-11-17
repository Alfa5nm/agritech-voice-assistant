"""Reviewed, pseudonymous text examples only. Split groups before training."""
import json
from pathlib import Path
import re
import unicodedata

FIELDS = ["crop", "stage", "symptom", "symptomLocation", "duration", "farmLocation", "priorActions", "quantity", "unit", "negation"]
PHONE = re.compile(r"(?:\+?৮৮|\+?88)?[০0][১1][০-৯0-9]{9}")


def read_examples(path, reviewed=True):
    records = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    seen, groups, utterances = set(), {}, {}
    for record in records:
        if not isinstance(record.get("id"), str) or record["id"] in seen:
            raise ValueError("Every example requires a unique ID")
        seen.add(record["id"])
        if not record.get("groupId") or record.get("split") not in ("train", "dev", "test"):
            raise ValueError("Assign a group and split before training")
        if record["groupId"] in groups and groups[record["groupId"]] != record["split"]:
            raise ValueError("Conversation or paraphrase group leaks across splits")
        groups[record["groupId"]] = record["split"]
        canonical = " ".join(unicodedata.normalize('NFC',record.get('text','')).split())
        if canonical in utterances and utterances[canonical] != record['split']:
            raise ValueError('Duplicate utterance leaks across splits')
        utterances[canonical] = record['split']
        if reviewed and (not record.get("reviewedBy") or record.get("status") != "reviewed"):
            raise ValueError("Human review required; teacher drafts are not labels")
        if reviewed and record.get("requiresSpanReview"):
            raise ValueError("Resolve invalid teacher spans before training")
        if record.get("containsPersonalData") is not False or PHONE.search(record.get("text", "")):
            raise ValueError("Remove personal data before research use")
        if not isinstance(record.get("text"), str) or not 1 <= len(record["text"]) <= 2000:
            raise ValueError("Invalid example text")
        for entity in record.get("entities", []):
            if entity.get("label") not in FIELDS or not 0 <= entity.get("start", -1) < entity.get("end", 0) <= len(record["text"]):
                raise ValueError("Invalid labeled text span")
        if set(record.get("facts", {})) - set(FIELDS):
            raise ValueError("Unsupported or identifying training field")
    return records


def preservation(reference, generated):
    def normalized(value):
        value = unicodedata.normalize("NFC", value)
        return value.translate(str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789"))
    reference, generated = normalized(reference), normalized(generated)
    numbers = re.findall(r"\d+(?:\.\d+)?", reference)
    negatives = re.findall(r"(?<!\w)(?:না|নাই|নেই|নয়|no|not)(?!\w)", reference, re.I)
    return {"numbersPreserved": numbers == re.findall(r"\d+(?:\.\d+)?", generated), "negationPreserved": bool(negatives) == bool(re.findall(r"(?<!\w)(?:না|নাই|নেই|নয়|no|not)(?!\w)", generated, re.I)), "manualMeaningReviewRequired": reference != generated}
