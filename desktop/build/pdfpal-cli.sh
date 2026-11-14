#!/bin/sh
# pdfpal command-line launcher inside pdfpal.app/Contents/Resources/bin.
# Runs the bundled cli.mjs with the application's own runtime, like build/pdfpal-cli.cs on Windows.
# It may be reached through a symlink (for example ~/.local/bin/pdfpal), so it resolves its real
# location with POSIX shell features and plain readlink only. No shell interpolation of arguments.
unset CDPATH

directory_of() {
  case $1 in
    */*) set -- "${1%/*}"; printf '%s\n' "${1:-/}" ;;
    *) printf '.\n' ;;
  esac
}

fail() {
  printf '%s\n' 'pdfpal: The bundled CLI could not start. Reinstall pdfpal from its disk image.' >&2
  exit 1
}

self=$0
hops=0
while [ -L "$self" ]; do
  hops=$((hops + 1))
  [ "$hops" -le 40 ] || fail
  target=$(readlink "$self") || fail
  case $target in
    /*) self=$target ;;
    *) self=$(directory_of "$self")/$target ;;
  esac
done

bin=$(cd -P -- "$(directory_of "$self")" && pwd -P) || fail
contents=$(cd -P -- "$bin/../.." && pwd -P) || fail
launcher=$bin/${self##*/}
executable=$contents/MacOS/__PDFPAL_EXECUTABLE__
[ -f "$launcher" ] && [ -x "$executable" ] || fail

unset NODE_OPTIONS NODE_PATH
ELECTRON_RUN_AS_NODE=1
PDFPAL_CLI_DESKTOP=1
PDFPAL_CLI_LAUNCHER=$launcher
export ELECTRON_RUN_AS_NODE PDFPAL_CLI_DESKTOP PDFPAL_CLI_LAUNCHER
exec "$executable" "$contents/Resources/app.asar/cli.mjs" "$@"
