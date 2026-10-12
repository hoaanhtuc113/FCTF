#!/usr/bin/env bash
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
if [[ ! -d "${root}" ]]; then
  echo "Production configuration directory does not exist." >&2
  exit 1
fi

# Print file names only. Never print the content of private configuration.
matches=""
if matches="$(grep -rlE --include='*.yaml' --include='*.yml' --include='*.sql' '__FCTF_SECRET_[A-Z0-9_]+__' "${root}")"; then
  echo "Deployment stopped: unresolved secret templates in these files:" >&2
  printf '%s\n' "${matches}" >&2
  echo "Render private configuration using prepare-private-prod.py first." >&2
  exit 1
else
  status=$?
  if [[ ${status} -ne 1 ]]; then
    echo "Cannot inspect production configuration; deployment stopped." >&2
    exit 1
  fi
fi
