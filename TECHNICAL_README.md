# Finance Video Tool - Technical Operator README

This is a private CLI tool that turns YouTube captions, selected podcast episodes, and filtered Reddit headlines from finance/news sources into daily market-learning PDFs.

It does not download YouTube video or audio. Podcast sources download same-day episode audio and transcribe it locally with faster-whisper.
Reddit ingestion uses approved OAuth Data API access, never requests comments, and never opens outbound article pages. Reddit is restricted to cross-source topic comparison and cannot establish facts or thesis changes by itself.

## Folder map

```text
01 raw gathered text/        Raw YouTube captions and podcast transcripts
02 daily source bundles/     Daily grouped transcript packets and sync manifests
03 analysis and evidence/    Evidence cards, daily briefs, weekly reviews, company notes
04 pdf raports/              Final PDFs for reading
05 learning tracker/         Prediction journal, research candidates, company theses
```

Old pre-rename folders may be stored in:

```text
99 old folder backup - safe to delete later/
```

## Setup

From the project root:

```powershell
$env:YOUTUBE_DL_SKIP_PYTHON_CHECK='1'
npm install
npx codex login
```

`npx codex login` is required for full AI synthesis using the user’s ChatGPT/Codex subscription.

Podcast transcription requires FFmpeg plus a Python 3.12 virtual environment:

```powershell
winget install --source winget --id Gyan.FFmpeg.Essentials
winget install --source winget --id Python.Python.3.12
py -3.12 -m venv .venv-transcribe
.\.venv-transcribe\Scripts\python.exe -m pip install faster-whisper
```

The first transcription downloads the Whisper model into the local Hugging Face cache. Default model is `base.en`.

## Main commands

Fetch new YouTube videos, fetch/transcribe same-day podcast episodes, analyze everything, and generate the daily PDF:

```powershell
npm run daily
```

Generate a raport from already gathered captions/evidence without fetching YouTube again:

```powershell
npm run raport
```

Generate a raport for a specific date:

```powershell
npm run raport -- --date YYYY-MM-DD
```

Use local fallback mode if Codex login/synthesis is unavailable:

```powershell
npm run raport -- --date YYYY-MM-DD --local
```

Force rebuild of the daily brief/raport:

```powershell
npm run raport -- --date YYYY-MM-DD --force
```

Sync only podcast episodes published today:

```powershell
npm run sync:podcasts
```

Use a larger local Whisper model for better podcast transcription:

```powershell
npm run sync:podcasts -- --podcast-model small.en
```

Run the old YouTube-only path:

```powershell
npm run daily -- --skip-podcasts
```

Run a syntax/sanity check:

```powershell
npm run check
```

## Source list

Sources are configured in:

```text
sources.json
```

YouTube sources have:

```json
{
  "type": "youtube",
  "name": "Bloomberg Television",
  "slug": "bloomberg-television",
  "url": "https://www.youtube.com/@markets/videos"
}
```

Broad channels can use `skipTitleKeywords` to skip obvious non-market videos before captions are downloaded.

Podcast sources use RSS feed URLs:

```json
{
  "type": "podcast",
  "name": "FT News Briefing",
  "slug": "ft-news-briefing",
  "url": "https://feeds.acast.com/public/shows/73fe3ede-5c5c-4850-96a8-30db8dbae8bf"
}
```

Reddit sources use subreddit names and factuality filters:

```json
{
  "type": "reddit",
  "name": "Reddit Economics",
  "slug": "reddit-economics",
  "subreddit": "Economics",
  "externalOnly": true,
  "allowedFlairs": ["News", "Research Summary", "Statistics"]
}
```

All report-day boundaries use the timezone named by the `REPORT_TIME_ZONE` environment variable (any IANA zone name, e.g. `UTC`, `America/New_York`, `Europe/London`). It defaults to `UTC`.

## Outputs

Daily PDF:

```text
04 pdf raports/daily raports/YYYY-MM-DD/daily-market-raport-YYYY-MM-DD.pdf
```

Daily Markdown/JSON:

```text
03 analysis and evidence/daily briefs/YYYY-MM-DD/
```

Per-video evidence cards:

```text
03 analysis and evidence/evidence cards/YYYY-MM-DD/SOURCE/VIDEO_ID.json
```

Raw transcripts:

```text
01 raw gathered text/SOURCE/YYYY-MM-DD/
```

## Common problems

### Codex is not signed in

Run:

```powershell
npx codex login
```

Then retry the raport command.

If a PDF is needed immediately, use:

```powershell
npm run raport -- --date YYYY-MM-DD --local
```

### YouTube HTTP 429 / Too Many Requests

Run slower:

```powershell
npm run daily -- --video-delay 30 --source-delay 45
```

### No PDF was created

Check whether evidence exists:

```text
03 analysis and evidence/evidence cards/YYYY-MM-DD/manifest.json
```

Then run:

```powershell
npm run raport -- --date YYYY-MM-DD --local
```

### Raport feels too dense

The daily renderer is intentionally KISS-style. The formatting logic lives in:

```text
src/render_daily.js
src/lib/plain_english.js
src/lib/local_brief.js
```

The full AI synthesis prompt lives in:

```text
src/analyze_daily.js
```

## Maintenance notes

- Do not edit generated JSON unless you know why.
- Do not delete `.finance-video/state.json` unless you want the tool to forget which videos it already processed.
- If folder names change, update `src/lib/project.js` first. Other scripts import folder paths from there.
- Use `npm run check` after code changes.


##weekly 
npm run weekly -- --ending 2026-06-25

  Important: it needs daily brief JSON files already created under:

  03 analysis and evidence\daily briefs\YYYY-MM-DD\daily-market-brief.json
