#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIREFOX_APP="${FIREFOX_APP:-/Applications/Firefox.app}"
PROFILES_INI="${HOME}/Library/Application Support/Firefox/profiles.ini"
PROFILE_DIR="${PROFILE_DIR:-}"
BACKUP_ROOT="${SCRIPT_DIR}/backups/$(date +%Y%m%d-%H%M%S)"
MANIFEST_FILE="${BACKUP_ROOT}/install-manifest.tsv"
TARGET_FILE="${BACKUP_ROOT}/install-target.tsv"

MANAGED_APP_FILES=(
  "config.js"
  "config-prefs.js"
)

MANAGED_PROFILE_FILES=(
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

hash_file() {
  shasum -a 256 "$1" | awk '{ print $1 }'
}

backup_if_exists() {
  local live_path="$1"
  local backup_path="$2"

  if [[ -f "$live_path" ]]; then
    mkdir -p "$(dirname "$backup_path")"
    cp "$live_path" "$backup_path"
  fi
}

record_manifest_entry() {
  local rel_path="$1"
  local live_path="$2"

  printf '%s\t%s\n' "$rel_path" "$(hash_file "$live_path")" >> "$MANIFEST_FILE"
}

install_managed_file() {
  local source_path="$1"
  local live_path="$2"
  local backup_path="$3"
  local rel_path="$4"

  backup_if_exists "$live_path" "$backup_path"
  mkdir -p "$(dirname "$live_path")"
  cp "$source_path" "$live_path"
  record_manifest_entry "$rel_path" "$live_path"
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

APP_RESOURCES="${FIREFOX_APP}/Contents/Resources"
APP_PREFS_DIR="${APP_RESOURCES}/defaults/pref"
PROFILE_CHROME_DIR="${PROFILE_DIR}/chrome"

mkdir -p "$BACKUP_ROOT" "$APP_PREFS_DIR" "$PROFILE_CHROME_DIR" "$PROFILE_CHROME_DIR/utils"
: > "$MANIFEST_FILE"
printf 'firefox_app\t%s\nprofile_dir\t%s\n' "$FIREFOX_APP" "$PROFILE_DIR" > "$TARGET_FILE"

for rel_path in "${MANAGED_APP_FILES[@]}"; do
  source_path="${SCRIPT_DIR}/app/${rel_path}"
  if [[ "$rel_path" == "config.js" ]]; then
    live_path="${APP_RESOURCES}/${rel_path}"
  else
    live_path="${APP_PREFS_DIR}/${rel_path}"
  fi

  install_managed_file \
    "$source_path" \
    "$live_path" \
    "${BACKUP_ROOT}/app/${rel_path}" \
    "app/${rel_path}"
done

for rel_path in "${MANAGED_PROFILE_FILES[@]}"; do
  install_managed_file \
    "${SCRIPT_DIR}/profile/chrome/${rel_path}" \
    "${PROFILE_CHROME_DIR}/${rel_path}" \
    "${BACKUP_ROOT}/profile/chrome/${rel_path}" \
    "profile/chrome/${rel_path}"
done

chmod -R u+rwX "${PROFILE_CHROME_DIR}"

echo "Installed Firefox Home Stocks."
echo "Firefox app: ${FIREFOX_APP}"
echo "Firefox profile: ${PROFILE_DIR}"
echo "Backup saved to: ${BACKUP_ROOT}"
echo "If Firefox was open, fully quit it before relaunching."
