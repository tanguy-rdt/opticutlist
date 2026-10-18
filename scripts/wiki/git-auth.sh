#!/usr/bin/env bash
# Credentialed Git only: never run the parser or npm in this process.
set -euo pipefail
if [[ -z "${WIKI_PUBLISH_TOKEN:-}" ]]; then
  echo '::error::Missing WIKI_PUBLISH_TOKEN. Follow docs/developer-guide/wiki-publishing.md.'
  exit 1
fi
askpass="$(mktemp "$RUNNER_TEMP/opticutlist-wiki-askpass.XXXXXX")"
trap 'rm -f "$askpass"' EXIT
chmod 700 "$askpass"
cat > "$askpass" <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "$WIKI_PUBLISH_TOKEN" ;;
  *) exit 1 ;;
esac
ASKPASS
export GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0
case "${1:-}" in
  clone)
    if ! git -c credential.helper= clone --quiet --depth=1 "https://github.com/${WIKI_REPOSITORY}.wiki.git" "$2"; then
      echo '::error::Cannot clone Wiki. Check initialization, token permissions, expiry and SSO. No authentication fallback is used.'
      exit 1
    fi
    ;;
  push)
    branch="$(git -C "$2" symbolic-ref --short HEAD)"
    if ! git -C "$2" -c credential.helper= push origin "HEAD:$branch"; then
      echo '::error::Wiki push failed. Check token permissions and concurrent edits. No force-push or authentication fallback is used.'
      exit 1
    fi
    ;;
  *) echo '::error::Unsupported authenticated Wiki operation.'; exit 1 ;;
esac
