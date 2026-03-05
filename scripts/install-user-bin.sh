#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${CLARITY_BIN_DIR:-$HOME/.local/bin}"

CLI_BIN="${ROOT_DIR}/dist/claritycli.cjs"
AGENT_BIN="${ROOT_DIR}/dist/clarity-agent.cjs"

if [[ ! -f "${CLI_BIN}" || ! -f "${AGENT_BIN}" ]]; then
  echo "Missing build artifacts in dist/. Run 'npm run build' first."
  exit 1
fi

mkdir -p "${BIN_DIR}"

ln -sf "${CLI_BIN}" "${BIN_DIR}/claritycli"
ln -sf "${AGENT_BIN}" "${BIN_DIR}/clarity-agent"
ln -sf "${AGENT_BIN}" "${BIN_DIR}/clarity-hitl"

echo "Installed commands into ${BIN_DIR}:"
echo "- claritycli"
echo "- clarity-agent"
echo "- clarity-hitl"

case ":${PATH}:" in
  *":${BIN_DIR}:"*)
    echo "PATH already contains ${BIN_DIR}."
    ;;
  *)
    echo "Add this to your shell config:"
    echo "export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac
