#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIREFOX_APP="${FIREFOX_APP:-/Applications/Firefox.app}"
PROFILES_INI="${HOME}/Library/Application Support/Firefox/profiles.ini"
PROFILE_DIR="${PROFILE_DIR:-}"
BACKUP_ROOT="${SCRIPT_DIR}/backups/$(date +%Y%m%d-%H%M%S)"

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
PACKAGE_PROFILE_DIR="${SCRIPT_DIR}/profile/chrome"

mkdir -p "$BACKUP_ROOT/app" "$BACKUP_ROOT/profile" "$APP_PREFS_DIR" "$PROFILE_CHROME_DIR"

if [[ -f "${APP_RESOURCES}/config.js" ]]; then
  cp "${APP_RESOURCES}/config.js" "${BACKUP_ROOT}/app/config.js"
fi

if [[ -f "${APP_PREFS_DIR}/config-prefs.js" ]]; then
  cp "${APP_PREFS_DIR}/config-prefs.js" "${BACKUP_ROOT}/app/config-prefs.js"
fi

if [[ -d "${PROFILE_CHROME_DIR}" ]]; then
  cp -R "${PROFILE_CHROME_DIR}" "${BACKUP_ROOT}/profile/chrome"
fi

cp "${SCRIPT_DIR}/app/config.js" "${APP_RESOURCES}/config.js"
cp "${SCRIPT_DIR}/app/config-prefs.js" "${APP_PREFS_DIR}/config-prefs.js"
cp -R "${PACKAGE_PROFILE_DIR}/." "${PROFILE_CHROME_DIR}/"

chmod -R u+rwX "${PROFILE_CHROME_DIR}"

echo "Installed Firefox Home Stocks."
echo "Firefox app: ${FIREFOX_APP}"
echo "Firefox profile: ${PROFILE_DIR}"
echo "Backup saved to: ${BACKUP_ROOT}"
echo "If Firefox was open, fully quit it before relaunching."
