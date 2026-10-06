#!/usr/bin/env bash
set -euo pipefail
umask 077

# The timer runs this file through ~/fmm/current. Resolve it before switching
# current, so the running deploy keeps using its own tested helper files.
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
root="$HOME/fmm"
shared="$root/shared"
releases="$root/releases"
current="$root/current"
state_file="$shared/ci-poll-state"
status_file="$shared/deploy-status.json"
repo_url="https://github.com/TK-06/find-my-mines.git"
api_url="https://api.github.com/repos/TK-06/find-my-mines/actions/workflows/ci.yml/runs"
started_at=$(date +%s%3N)
dry_run=0

if [[ "$#" -eq 1 && "$1" == "--dry-run" ]]; then
  dry_run=1
elif [[ "$#" -ne 0 ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

log() { printf '%s\n' "$*"; }
duration() { printf '%s' "$(( $(date +%s%3N) - started_at ))"; }
write_status() {
  node "$script_dir/write-status.mjs" "$status_file" "$sha" "$1" "$2" "$(duration)" ||
    log "Could not write deployment status"
}
record_state() {
  local temporary="$state_file.tmp.$$"
  printf '%s %s %s\n' "$sha" "$1" "$2" > "$temporary"
  mv -f -- "$temporary" "$state_file"
}

candidate=""
next_link=""
cleanup() {
  if [[ -n "$candidate" && "$candidate" == "$releases"/.staging-* && -d "$candidate" ]]; then
    rm -rf -- "$candidate"
  fi
  if [[ -n "$next_link" && -L "$next_link" ]]; then
    rm -f -- "$next_link"
  fi
}
trap cleanup EXIT

if [[ "$dry_run" -eq 0 ]]; then
  mkdir -p -- "$shared" "$releases"
  exec 9>"$shared/deploy.lock"
  if ! flock -n 9; then
    log "Another deployment check is running"
    exit 0
  fi
fi

if [[ ! -L "$current" || ! -d "$current" ]]; then
  log "Bootstrap required: $current must point to a healthy release"
  exit 0
fi

deployed_sha=$(git -C "$current" rev-parse HEAD)
sha=$(git ls-remote "$repo_url" refs/heads/main | awk '{print $1}')
if [[ ! "$sha" =~ ^[a-f0-9]{40}$ ]]; then
  log "Cannot read the main branch SHA"
  exit 1
fi
if [[ "$sha" == "$deployed_sha" ]]; then
  log "Already deployed $sha"
  exit 0
fi

now=$(date +%s)
prior_sha=""
next_poll=0
prior_state=""
if [[ -f "$state_file" ]]; then
  read -r prior_sha next_poll prior_state < "$state_file" || true
fi
if [[ "$prior_sha" == "$sha" && "$next_poll" =~ ^[0-9]+$ && "$now" -lt "$next_poll" ]]; then
  log "Waiting for the next CI check for $sha ($prior_state)"
  exit 0
fi

query="$api_url?head_sha=$sha&branch=main&event=push&per_page=10"
if ! response=$(curl --fail --silent --show-error --max-time 15 \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" "$query"); then
  log "CI API unavailable for $sha"
  if [[ "$dry_run" -eq 0 ]]; then record_state "$((now + 300))" wait; fi
  exit 0
fi
decision=$(printf '%s' "$response" | node "$script_dir/ci-gate.mjs" /dev/stdin "$sha") || decision="wait"
case "$decision" in
  wait)
    log "CI is not complete for $sha"
    if [[ "$dry_run" -eq 0 ]]; then record_state "$((now + 180))" wait; fi
    exit 0
    ;;
  skip)
    log "CI failed for $sha; skipping this commit"
    if [[ "$dry_run" -eq 0 ]]; then
      record_state "$((now + 900))" skip
      write_status skipped-ci-failed "CI did not pass for this commit"
    fi
    exit 0
    ;;
  deploy) ;;
  *)
    log "Unexpected CI decision; deployment stopped"
    exit 1
    ;;
esac

release="$releases/$sha"
if [[ "$dry_run" -eq 1 ]]; then
  log "Would clone $sha into $release, install, build, switch current, restart, and check health"
  exit 0
fi
if [[ -e "$release" ]]; then
  log "Release directory already exists for $sha; inspect it before retrying"
  write_status failed "Release directory already exists"
  exit 1
fi

candidate="$releases/.staging-$sha-$$"
if ! git clone --quiet --depth 1 --single-branch --branch main "$repo_url" "$candidate"; then
  log "Clone failed for $sha"
  record_state "$((now + 300))" wait
  write_status failed "Clone failed"
  exit 1
fi
if [[ "$(git -C "$candidate" rev-parse HEAD)" != "$sha" ]]; then
  log "Main moved during clone; retrying later"
  record_state "$((now + 180))" wait
  exit 0
fi
if ! (cd "$candidate" && npm ci); then
  log "npm ci failed for $sha"
  record_state "$((now + 900))" wait
  write_status failed "Dependency install failed"
  exit 1
fi
ln -s -- "$shared/.env" "$candidate/.env"
if ! (cd "$candidate" && npm run build); then
  log "Build failed for $sha"
  record_state "$((now + 900))" wait
  write_status failed "Build failed"
  exit 1
fi
mv -- "$candidate" "$release"
candidate=""

healthy() {
  local attempt
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if systemctl is-active --quiet findmymines &&
      curl --fail --silent --max-time 2 http://127.0.0.1:3000/health > /dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}
switch_to() {
  next_link="$root/.current-next-$$"
  ln -s -- "$1" "$next_link"
  mv -Tf -- "$next_link" "$current"
  next_link=""
}
previous=$(readlink -f -- "$current")
switch_to "$release"
if ! sudo -n /usr/bin/systemctl restart findmymines || ! healthy; then
  log "New release unhealthy; restoring $previous"
  switch_to "$previous"
  if sudo -n /usr/bin/systemctl restart findmymines && healthy; then
    write_status rolled-back "New release failed health check; previous release restored"
  else
    write_status failed "New release failed and rollback needs manual repair"
    exit 1
  fi
  if [[ "$release" == "$releases"/"$sha" ]]; then rm -rf -- "$release"; fi
  record_state "$((now + 900))" wait
  exit 1
fi

write_status deployed "CI passed and health check succeeded"
log "Deployed $sha"

# Keep the three newest verified releases. The current and previous release
# are protected even if their timestamps are unusual.
mapfile -t release_dirs < <(
  find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -nr | cut -d' ' -f2-
)
kept=0
for directory in "${release_dirs[@]}"; do
  name=$(basename -- "$directory")
  if [[ ! "$name" =~ ^[a-f0-9]{40}$ ]]; then continue; fi
  kept=$((kept + 1))
  if [[ "$kept" -gt 3 && "$directory" != "$release" && "$directory" != "$previous" ]]; then
    rm -rf -- "$directory"
  fi
done
