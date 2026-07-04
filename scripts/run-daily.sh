#!/bin/zsh
# Runs the daily financebot pipeline unattended (e.g. via launchd or cron).
# Logs to ~/Library/Logs/financebot/daily-YYYY-MM-DD.log so failures can be
# diagnosed without a terminal attached.
#
# Personalize via environment variables set by your scheduler (e.g. the
# EnvironmentVariables dict in a launchd plist) rather than editing this
# file: REPORT_TIME_ZONE (IANA zone, defaults to UTC) and ANALYSIS_ENGINE
# ("claude" or "codex").

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/financebot"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-$(date +%Y-%m-%d).log"

# Schedulers (launchd, cron) run without your shell profile, so node/npm
# may not be on PATH. This covers Homebrew and the most recently installed
# nvm version; adjust if your setup differs.
NVM_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${NVM_BIN}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export REPORT_TIME_ZONE="${REPORT_TIME_ZONE:-UTC}"
export ANALYSIS_ENGINE="${ANALYSIS_ENGINE:-claude}"

{
  echo "=== financebot daily run: $(date) ==="
  cd "$PROJECT_DIR" && caffeinate -i npm run daily
  echo "=== finished: $(date), exit code $? ==="
} >> "$LOG_FILE" 2>&1
