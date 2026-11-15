#!/bin/sh
# Keep the npm `pdfpal` command independent. Use the installed Electron runtime.
set -eu
launcher=$0
if [ -L "$launcher" ]; then launcher=$(readlink -f -- "$launcher"); fi
app_dir=$(CDPATH= cd -- "$(dirname -- "$launcher")/.." && pwd)
export ELECTRON_RUN_AS_NODE=1
export PDFPAL_CLI_LAUNCHER="$launcher"
exec "$app_dir/pdfpal-desktop" "$app_dir/resources/app.asar/cli.mjs" "$@"
