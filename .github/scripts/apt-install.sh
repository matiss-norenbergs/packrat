#!/usr/bin/env bash
# Installs apt packages on a CI runner without letting one stalled mirror hang the job.
#
# Usage: .github/scripts/apt-install.sh <package>...
#
# Each attempt runs `apt-get update` + `apt-get install` under a hard time limit, so a stalled
# apt is killed and retried instead of waiting for the step or job timeout. Output is never
# hidden, and the script fails (non-zero) when every attempt fails. Healthy runs take
# 25-55 s in total; the limit is ~3x that.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <package>..." >&2
  exit 2
fi

attempts=3
limit_seconds=150
pause_seconds=10

for attempt in $(seq 1 "$attempts"); do
  echo "::group::apt install attempt $attempt/$attempts"
  status=0
  timeout -k 10 "$limit_seconds" sudo env DEBIAN_FRONTEND=noninteractive bash -c '
    set -e
    opts=(-o Acquire::Retries=3 -o DPkg::Lock::Timeout=60)
    apt-get "${opts[@]}" update
    apt-get "${opts[@]}" install -y --no-install-recommends "$@"
  ' _ "$@" || status=$?
  echo "::endgroup::"

  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
    echo "::warning::apt attempt $attempt/$attempts stalled and was stopped after ${limit_seconds}s"
  else
    echo "::warning::apt attempt $attempt/$attempts failed with exit code $status"
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$pause_seconds"
  fi
done

echo "::error::apt install failed after $attempts attempts" >&2
exit 1
