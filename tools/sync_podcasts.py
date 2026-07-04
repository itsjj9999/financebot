#!/usr/bin/env python
import argparse
import email.utils
import hashlib
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from faster_whisper import WhisperModel


def clean(value):
    if value is None:
        return ""
    return html.unescape(" ".join(str(value).split())).strip()


def slugify(value, fallback="podcast"):
    slug = re.sub(r"[^a-z0-9]+", "-", clean(value).lower()).strip("-")
    return (slug or fallback)[:90]


def timestamp(seconds):
    total = max(0, int(seconds))
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def fetch_bytes(url, timeout=120):
    request = urllib.request.Request(url, headers={"User-Agent": "finance-video-podcast-sync/0.1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def child_text(node, local_name):
    for child in list(node):
        if child.tag.split("}")[-1] == local_name:
            return clean(child.text)
    return ""


def enclosure_url(node):
    for child in list(node):
        if child.tag.split("}")[-1] == "enclosure":
            return child.attrib.get("url", "")
    return ""


def duration_seconds(value):
    value = clean(value)
    if not value:
        return 0
    if value.isdigit():
        return int(value)
    parts = value.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return 0
    return 0


def pub_date_to_date(value):
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(ZoneInfo("Europe/Kyiv")).date().isoformat()
    except Exception:
        match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", value or "")
        return match.group(1) if match else ""


def episode_id(source_slug, title, published, audio_url):
    digest = hashlib.sha1(f"{source_slug}|{title}|{published}|{audio_url}".encode("utf-8")).hexdigest()[:16]
    return f"podcast-{digest}"


def parse_feed(source):
    root = ET.fromstring(fetch_bytes(source["url"], timeout=60))
    channel = root.find("channel")
    if channel is None:
        return []
    episodes = []
    for item in channel.findall("item"):
        title = child_text(item, "title")
        published = child_text(item, "pubDate")
        audio = enclosure_url(item)
        if not title or not published or not audio:
            continue
        episodes.append(
            {
                "id": episode_id(source["slug"], title, published, audio),
                "title": title,
                "published": published,
                "publishedDate": pub_date_to_date(published),
                "duration": duration_seconds(child_text(item, "duration")),
                "audio": audio,
                "page": child_text(item, "link") or audio,
            }
        )
    return episodes


def compact_segments(segments):
    chunks = []
    current = None
    for segment in segments:
        line = clean(segment.text)
        if not line:
            continue
        if current is None:
            current = {"start": segment.start, "end": segment.end, "parts": [line]}
            continue
        duration = segment.end - current["start"]
        length = len(" ".join(current["parts"]))
        sentence_end = re.search(r'[.!?]["\']?$', current["parts"][-1])
        if duration >= 35 or length >= 550 or (duration >= 18 and sentence_end):
            chunks.append(current)
            current = {"start": segment.start, "end": segment.end, "parts": [line]}
        else:
            current["parts"].append(line)
            current["end"] = segment.end
    if current:
        chunks.append(current)
    return chunks


def build_markdown(source, episode, chunks, model_name):
    duration = timestamp(episode["duration"]) if episode["duration"] else "unknown"
    transcript = "\n\n".join(
        f"**[{timestamp(chunk['start'])}]({episode['page']})** {' '.join(chunk['parts'])}"
        for chunk in chunks
    )
    return f"""# {episode['title']}

## Video information

- **Channel:** {source['name']}
- **Published:** {episode['publishedDate']}
- **Duration:** {duration}
- **Language:** en
- **Caption source:** local-podcast-transcription ({model_name})
- **Video:** {episode['page']}
- **Video ID:** {episode['id']}

> **Caption warning:** This podcast transcript was generated locally from audio with faster-whisper. Names, numbers, and noisy clips may contain transcription errors.

## Instructions for ChatGPT

Treat this transcript as the primary source for our discussion. Begin by producing:

1. A concise overview of the episode's narrative.
2. The central financial, economic, geopolitical, or technology thesis.
3. The argument's progression from premise to conclusion.
4. Important claims, evidence, assumptions, and predictions.
5. The speaker's tone and framing: bullish, bearish, neutral, promotional, alarmist, or mixed.
6. Financial concepts I should learn to understand the episode.
7. Plausible counterarguments and information that would verify or falsify the claims.

When answering later questions:

- Cite transcript timestamps using the links below.
- Separate what the speaker says from your own interpretation.
- Label facts, opinions, forecasts, and speculation.
- Explain finance terminology in plain language without oversimplifying it.
- Point out uncertainty, missing evidence, incentives, and possible bias.
- Do not present the episode's claims as personalized financial advice.
- If the transcript does not support an answer, say so clearly.

## Timestamped transcript

{transcript}
"""


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def transcribe_episode(model, source, episode, raw_root, model_name):
    output_folder = raw_root / source["slug"] / episode["publishedDate"]
    output_folder.mkdir(parents=True, exist_ok=True)
    stem = f"{slugify(episode['title'], episode['id'])}-{episode['id']}"
    audio_path = output_folder / f"{stem}.mp3"
    transcript_path = output_folder / f"{stem}.md"

    if not audio_path.exists():
        audio_path.write_bytes(fetch_bytes(episode["audio"]))

    segments, _info = model.transcribe(str(audio_path), beam_size=1)
    chunks = compact_segments(segments)
    if not chunks:
        raise RuntimeError("Local transcription produced no text.")
    transcript_path.write_text(build_markdown(source, episode, chunks, model_name), encoding="utf-8")
    return transcript_path


def build_source_packet(date, source, created, daily_root):
    if not created:
        return None
    folder = daily_root / date
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / f"{source['slug']}-source.md"
    sections = [
        f"# Daily source packet - {date}",
        "",
        "Create one concise daily market brief from these podcast episodes. Remove repeated stories. Explain market moves in plain English. Separate reported facts from forecasts.",
        "",
        f"Podcast episodes included: {len(created)}",
    ]
    for item in created:
        sections.extend(["", "---", "", Path(item["transcript"]).read_text(encoding="utf-8")])
    destination.write_text("\n".join(sections), encoding="utf-8")
    return destination


def main():
    parser = argparse.ArgumentParser(description="Sync and locally transcribe podcast episodes for one date.")
    parser.add_argument("--date", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--sources", required=True)
    parser.add_argument("--model", default="base.en")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = Path(args.root)
    sources = [item for item in json.loads(Path(args.sources).read_text(encoding="utf-8")) if item.get("type") == "podcast"]
    state_path = root / ".finance-video" / "state.json"
    state = load_json(state_path, {"channels": {}})
    raw_root = root / "01 raw gathered text"
    daily_root = root / "02 daily source bundles"
    run_folder = daily_root / args.date
    run_folder.mkdir(parents=True, exist_ok=True)

    model = None
    all_created = []
    all_skipped = []

    for source in sources:
        print(f"\n=== {source['name']} ===", flush=True)
        channel_state = state.setdefault("channels", {}).setdefault(source["url"], {"processed": {}})
        created = []
        try:
            episodes = [item for item in parse_feed(source) if item["publishedDate"] == args.date]
        except Exception as error:
            all_skipped.append({"source": source["name"], "reason": str(error)})
            print(f"Skipped source: {error}", flush=True)
            continue

        if not episodes:
            print(f"No episode published on {args.date}.", flush=True)
            continue

        for episode in episodes:
            if not args.force and episode["id"] in channel_state["processed"]:
                print(f"Already synced: {episode['title']}", flush=True)
                continue
            try:
                if model is None:
                    model = WhisperModel(args.model, device="cpu", compute_type="int8")
                print(f"Transcribing: {episode['title']}", flush=True)
                transcript_path = transcribe_episode(model, source, episode, raw_root, args.model)
                record = {
                    "id": episode["id"],
                    "title": episode["title"],
                    "source": source["name"],
                    "sourceSlug": source["slug"],
                    "transcript": str(transcript_path),
                    "url": episode["page"],
                    "audio": episode["audio"],
                    "duration": episode["duration"],
                }
                created.append(record)
                all_created.append(record)
                channel_state["processed"][episode["id"]] = {
                    "title": episode["title"],
                    "url": episode["page"],
                    "audio": episode["audio"],
                    "transcript": str(transcript_path),
                    "syncedAt": datetime.now(timezone.utc).isoformat(),
                    "published": episode["publishedDate"],
                    "duration": episode["duration"],
                }
                print(f"Created: {transcript_path}", flush=True)
            except Exception as error:
                skipped = {"source": source["name"], "title": episode["title"], "reason": str(error)}
                all_skipped.append(skipped)
                print(f"Skipped episode: {error}", flush=True)

        packet = build_source_packet(args.date, source, created, daily_root)
        if packet:
            print(f"Daily source packet: {packet}", flush=True)

    write_json(state_path, state)
    summary_path = run_folder / "podcasts-sync-summary.json"
    write_json(
        summary_path,
        {
            "date": args.date,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "created": all_created,
            "skipped": all_skipped,
        },
    )
    print(f"\nPodcast sync summary: {summary_path}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\nError: {error}", file=sys.stderr)
        sys.exit(1)
