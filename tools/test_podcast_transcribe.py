#!/usr/bin/env python
import html
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from faster_whisper import WhisperModel


SHOWS = [
    "Brussels Playbook",
    "FT News Briefing",
    "The Intelligence from The Economist",
    "The President's Daily Brief",
    "The Vergecast",
]


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "raports" / "tests" / "podcast-transcription"


def text(value):
    if value is None:
        return ""
    return html.unescape(" ".join(str(value).split())).strip()


def slugify(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        import json

        return json.loads(response.read().decode("utf-8"))


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": "podcast-test/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def duration_seconds(value):
    value = text(value)
    if not value:
        return None
    if value.isdigit():
        return int(value)
    parts = value.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None
    return None


def child_text(node, local_name):
    for child in list(node):
        if child.tag.split("}")[-1] == local_name:
            return text(child.text)
    return ""


def enclosure_url(node):
    for child in list(node):
        if child.tag.split("}")[-1] == "enclosure":
            return child.attrib.get("url", "")
    return ""


def apple_feed(show):
    query = urllib.parse.quote(show)
    result = fetch_json(f"https://itunes.apple.com/search?term={query}&media=podcast&limit=1")
    if not result.get("results"):
        return None
    match = result["results"][0]
    return {
        "show": match.get("collectionName") or show,
        "feed": match.get("feedUrl", ""),
    }


def candidates():
    output = []
    for show in SHOWS:
        feed_info = apple_feed(show)
        if not feed_info or not feed_info["feed"]:
            continue
        root = ET.fromstring(fetch_bytes(feed_info["feed"]))
        channel = root.find("channel")
        if channel is None:
            continue
        for item in channel.findall("item")[:5]:
            audio = enclosure_url(item)
            seconds = duration_seconds(child_text(item, "duration"))
            if not audio or seconds is None:
                continue
            output.append(
                {
                    "show": feed_info["show"],
                    "feed": feed_info["feed"],
                    "title": child_text(item, "title"),
                    "published": child_text(item, "pubDate"),
                    "duration": seconds,
                    "audio": audio,
                }
            )
    return sorted(output, key=lambda item: item["duration"])


def write_markdown(path, lines):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


def main():
    episodes = candidates()
    if not episodes:
        raise SystemExit("No podcast episode with audio and duration was found.")

    episode = episodes[0]
    stem = f"{slugify(episode['show'])}-{slugify(episode['title'])}"
    audio_path = OUT / f"{stem}.mp3"
    transcript_path = OUT / f"{stem}-transcript.md"
    raport_path = OUT / f"{stem}-test-raport.md"

    OUT.mkdir(parents=True, exist_ok=True)
    if not audio_path.exists():
        audio_path.write_bytes(fetch_bytes(episode["audio"]))

    print(f"Selected: {episode['show']} - {episode['title']}")
    print(f"Duration: {episode['duration']} seconds")
    print(f"Audio: {audio_path}")

    model_name = "base.en"
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(audio_path), beam_size=1)

    rows = []
    plain = []
    for segment in segments:
        line = text(segment.text)
        if not line:
            continue
        rows.append(f"[{segment.start:0.1f}-{segment.end:0.1f}] {line}")
        plain.append(line)

    transcript_text = " ".join(plain)
    write_markdown(
        transcript_path,
        [
            f"# Podcast Transcript Test - {episode['show']}",
            "",
            f"- **Episode:** {episode['title']}",
            f"- **Published:** {episode['published']}",
            f"- **Duration:** {episode['duration']} seconds",
            f"- **Language detected:** {info.language} ({info.language_probability:.2f})",
            f"- **Model:** faster-whisper {model_name}, CPU int8",
            f"- **Audio file:** {audio_path}",
            "",
            "## Transcript",
            "",
            *rows,
        ],
    )

    write_markdown(
        raport_path,
        [
            f"# Podcast Transcription Test Raport - {episode['show']}",
            "",
            f"- **Episode:** {episode['title']}",
            f"- **Published:** {episode['published']}",
            f"- **Duration:** {episode['duration']} seconds",
            f"- **Transcript file:** {transcript_path}",
            "",
            "## Test result",
            "",
            "- RSS discovery worked.",
            "- Audio download worked.",
            "- Local transcription worked.",
            "- This is not yet part of the daily/weekly pipeline.",
            "",
            "## Transcript",
            "",
            transcript_text or "No transcript text was produced.",
        ],
    )

    print(f"Transcript: {transcript_path}")
    print(f"Raport markdown: {raport_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        raise
