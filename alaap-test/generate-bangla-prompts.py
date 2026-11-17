"""Generate fixed Bangla questions. No caller audio or text is sent."""
import asyncio
import json
from pathlib import Path

import edge_tts


async def main():
    root = Path(__file__).resolve().parent
    prompts = json.loads((root / "bangla-prompts.json").read_text(encoding="utf-8"))
    output = root / "bangla-prompts"
    output.mkdir(exist_ok=True)
    for key, prompt in prompts.items():
        await edge_tts.Communicate(prompt, "bn-BD-NabanitaNeural").save(
            str(output / f"{key}.mp3")
        )
        print(key, flush=True)


asyncio.run(main())
