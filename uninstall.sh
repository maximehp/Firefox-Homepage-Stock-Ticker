#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIREFOX_APP="${FIREFOX_APP:-/Applications/Firefox.app}"
PROFILES_INI="${HOME}/Library/Application Support/Firefox/profiles.ini"
PROFILE_DIR="${PROFILE_DIR:-}"
BACKUP_DIR="${BACKUP_DIR:-}"

find_default_profile() {
  if [[ ! -f "$PROFILES_INI" ]]; then
    return 1
  fi

  awk -F= '
    function resolve_path(path, is_relative) {
      if (path ~ /^\// || is_relative == 0) {
        return path
      }
      return ENVIRON["HOME"] "/Library/Application Support/Firefox/" path
    }

    /^\[Profile/ {
      in_profile=1
      in_install=0
      path=""
      is_relative=1
      is_default=0
      next
    }

    /^\[Install/ {
      in_profile=0
      in_install=1
      next
    }

    /^\[/ {
      if ($0 !~ /^\[Profile/ && $0 !~ /^\[Install/) {
        in_profile=0
        in_install=0
      }
    }

    in_install && $1=="Default" {
      install_default=resolve_path($2, 1)
    }

    in_profile && $1=="Path" { path=$2 }
    in_profile && $1=="IsRelative" { is_relative=$2 }
    in_profile && $1=="Default" { is_default=$2 }
    in_profile && path != "" && is_default == 1 {
      profile_default=resolve_path(path, is_relative)
    }

    END {
      if (install_default != "") {
        print install_default
      } else if (profile_default != "") {
        print profile_default
      }
    }
  ' "$PROFILES_INI"
}

find_latest_backup() {
  local backup_root="${SCRIPT_DIR}/backups"
  if [[ ! -d "$backup_root" ]]; then
    return 1
  fi

  find "$backup_root" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1
}

restore_or_remove() {
  local live_path="$1"
  local backup_path="$2"
  local package_path="$3"

  if [[ -n "$backup_path" && -f "$backup_path" ]]; then
    mkdir -p "$(dirname "$live_path")"
    cp "$backup_path" "$live_path"
    echo "Restored: $live_path"
    return
  fi

  if [[ -f "$live_path" && -f "$package_path" ]] && cmp -s "$live_path" "$package_path"; then
    rm -f "$live_path"
    echo "Removed: $live_path"
    return
  fi

  if [[ -f "$live_path" ]]; then
    echo "Left in place (modified or no safe restore): $live_path"
  fi
}

if [[ -z "$PROFILE_DIR" ]]; then
  PROFILE_DIR="$(find_default_profile || true)"
fi

if [[ -z "$PROFILE_DIR" ]]; then
  echo "Could not detect a Firefox profile. Set PROFILE_DIR and rerun."
  exit 1
fi

if [[ ! -d "$FIREFOX_APP" ]]; then
  echo "Firefox app not found: $FIREFOX_APP"
  exit 1
fi

if [[ ! -d "$PROFILE_DIR" ]]; then
  echo "Firefox profile not found: $PROFILE_DIR"
  exit 1
fi

if [[ -z "$BACKUP_DIR" ]]; then
  BACKUP_DIR="$(find_latest_backup || true)"
fi

if [[ -n "$BACKUP_DIR" && ! -d "$BACKUP_DIR" ]]; then
  echo "Backup directory not found: $BACKUP_DIR"
  exit 1
fi

APP_RESOURCES="${FIREFOX_APP}/Contents/Resources"
APP_PREFS_DIR="${APP_RESOURCES}/defaults/pref"
PROFILE_CHROME_DIR="${PROFILE_DIR}/chrome"

restore_or_remove \
  "${APP_RESOURCES}/config.js" \
  "${BACKUP_DIR:+${BACKUP_DIR}/app/config.js}" \
  "${SCRIPT_DIR}/app/config.js"

restore_or_remove \
  "${APP_PREFS_DIR}/config-prefs.js" \
  "${BACKUP_DIR:+${BACKUP_DIR}/app/config-prefs.js}" \
  "${SCRIPT_DIR}/app/config-prefs.js"

PROFILE_FILES=(
  "bottomStocks.uc.js"
  "rebuild_userChrome.uc.js"
  "test.uc.js"
  "userContent.css"
  "utils/chrome.manifest"
  "utils/userChrome.jsm"
  "utils/xPref.jsm"
  "utils/BottomStocksParent.sys.mjs"
  "utils/BottomStocksChild.sys.mjs"
)

for rel_path in "${PROFILE_FILES[@]}"; do
  restore_or_remove \
    "${PROFILE_CHROME_DIR}/${rel_path}" \
    "${BACKUP_DIR:+${BACKUP_DIR}/profile/chrome/${rel_path}}" \
    "${SCRIPT_DIR}/profile/chrome/${rel_path}"
done

rmdir "${PROFILE_CHROME_DIR}/utils" 2>/dev/null || true
rmdir "${PROFILE_CHROME_DIR}" 2>/dev/null || true

echo "Uninstall finished."
echo "Firefox app: ${FIREFOX_APP}"
echo "Firefox profile: ${PROFILE_DIR}"

if [[ -n "$BACKUP_DIR" ]]; then
  echo "Backup source used: ${BACKUP_DIR}"
else
  echo "No backup directory found. Matching project files were removed only when safe."
fi

echo "If Firefox was open, fully quit it before relaunching."
