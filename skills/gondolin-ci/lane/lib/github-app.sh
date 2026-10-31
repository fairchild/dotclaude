# shellcheck shell=bash
# Mint with a GitHub App instead of the operator's own login. Source this, then call
# load_app_config <file> and app_installation_token. The file holds three shell assignments:
#   GITHUB_APP_ID=  GITHUB_APP_INSTALLATION_ID=  GITHUB_APP_PRIVATE_KEY_PATH=

load_app_config() {
  # shellcheck disable=SC1090
  source "$1"
  if [ -z "${GITHUB_APP_ID:-}" ] || [ -z "${GITHUB_APP_INSTALLATION_ID:-}" ] || [ -z "${GITHUB_APP_PRIVATE_KEY_PATH:-}" ]; then
    printf '%s\n' "$1 needs GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY_PATH" >&2
    return 1
  fi
  [ -f "$GITHUB_APP_PRIVATE_KEY_PATH" ] || {
    printf '%s\n' "private key not found: $GITHUB_APP_PRIVATE_KEY_PATH" >&2
    return 1
  }
}

base64url() { openssl base64 -e | tr -d '\n=' | tr '+/' '-_'; }

generate_jwt() {
  local now header payload signature
  now=$(date +%s)
  header=$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | base64url)
  payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 600))" "$GITHUB_APP_ID" | base64url)
  signature=$(printf '%s' "${header}.${payload}" | openssl dgst -sha256 -sign "$GITHUB_APP_PRIVATE_KEY_PATH" | base64url)
  printf '%s\n' "${header}.${payload}.${signature}"
}

# An unbounded curl without --fail turns an API error into an empty value that reads like a
# legitimate answer, and a stalled API into a run that never returns. The token goes through a
# config file descriptor because arguments are visible to every account on the machine.
github_api() {
  curl -sS --fail-with-body --connect-timeout 10 --max-time 30 \
    --config <(printf 'header = "Authorization: Bearer %s"\n' "$1") \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${@:2}"
}

# The token covers one repository and the one permission minting takes, whatever else the App holds.
# $1 is that repository's name, without its owner.
app_installation_token() {
  local body token scope
  scope=$(jq -nc --arg name "$1" '{repositories: [$name], permissions: {administration: "write"}}')
  body=$(github_api "$(generate_jwt)" -X POST -H "Content-Type: application/json" -d "$scope" \
    "https://api.github.com/app/installations/${GITHUB_APP_INSTALLATION_ID}/access_tokens") || {
    printf '%s\n' "could not reach the installation token endpoint" >&2
    return 1
  }
  token=$(printf '%s' "$body" | jq -r '.token // empty')
  [ -n "$token" ] || {
    printf '%s\n' "no installation token in GitHub's answer" >&2
    return 1
  }
  printf '%s\n' "$token"
}
