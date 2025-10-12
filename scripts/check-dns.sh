#!/usr/bin/env bash
set -euo pipefail

if ! command -v dig >/dev/null 2>&1; then
  echo "dig command not found. Install dnsutils (Debian/Ubuntu) or bind-utils (RHEL) to use this script." >&2
  exit 2
fi

ROOT_DOMAIN=${1:-goldshore.org}
WWW_DOMAIN="www.${ROOT_DOMAIN#www.}"
API_DOMAIN="api.${ROOT_DOMAIN#api.}"

EXPECTED_ROOT_CNAME=${EXPECTED_ROOT_CNAME:-goldshore-web.pages.dev}
EXPECTED_WWW_CNAME=${EXPECTED_WWW_CNAME:-goldshore-web.pages.dev}
EXPECTED_API_CNAME=${EXPECTED_API_CNAME:-workers.dev}

STATUS=0

check_domain() {
  local domain=$1
  local expected_cname=$2
  local label=$3

  echo "=== ${label}: ${domain} ==="
  local cname
  cname=$(dig +short CNAME "$domain" || true)
  if [[ -n "$cname" ]]; then
    echo "CNAME -> ${cname}"
    if [[ -n "$expected_cname" ]]; then
      if [[ "${cname%.}" != "$expected_cname" ]]; then
        echo "[WARN] Expected CNAME $expected_cname" >&2
        STATUS=1
      else
        echo "[OK] CNAME matches expected target"
      fi
    fi
  else
    echo "(no CNAME record returned)"
  fi

  local a_records
  a_records=$(dig +short "$domain" A)
  if [[ -n "$a_records" ]]; then
    printf 'A records:\n%s\n' "$a_records"
  else
    echo "[WARN] No A records returned" >&2
    STATUS=1
  fi

  local aaa_records
  aaa_records=$(dig +short "$domain" AAAA)
  if [[ -n "$aaa_records" ]]; then
    printf 'AAAA records:\n%s\n' "$aaa_records"
  fi

  echo
}

check_domain "$ROOT_DOMAIN" "$EXPECTED_ROOT_CNAME" "Apex"
check_domain "$WWW_DOMAIN" "$EXPECTED_WWW_CNAME" "WWW"
check_domain "$API_DOMAIN" "$EXPECTED_API_CNAME" "API"

if [[ $STATUS -ne 0 ]]; then
  echo "DNS checks completed with warnings." >&2
else
  echo "DNS checks passed."
fi

exit $STATUS
