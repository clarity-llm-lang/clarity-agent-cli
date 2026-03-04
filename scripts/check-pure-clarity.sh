#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ts_files="$(git ls-files '*.ts' '*.tsx' 2>/dev/null || true)"
if [[ -n "${ts_files}" ]]; then
  echo "TypeScript files are not allowed in this repository:"
  echo "${ts_files}"
  exit 1
fi

impl_dirs=(clarity src bin)
bad_impl=""

for dir in "${impl_dirs[@]}"; do
  if [[ -d "${dir}" ]]; then
    found="$(find "${dir}" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.tsx' \) | sort || true)"
    if [[ -n "${found}" ]]; then
      bad_impl+="${found}"$'\n'
    fi
  fi
done

if [[ -n "${bad_impl}" ]]; then
  echo "Implementation directories must be Clarity-only (found non-Clarity files):"
  printf "%s" "${bad_impl}"
  exit 1
fi

echo "Pure Clarity checks passed (implementation is Clarity-only)."
