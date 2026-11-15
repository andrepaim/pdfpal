#!/bin/sh
set -eu
# Never replace an existing user-managed command.
target=/opt/pdfpal/bin/pdfpal-desktop-cli
link=/usr/bin/pdfpal-desktop-cli
if [ ! -e "$link" ] && [ ! -L "$link" ]; then ln -s "$target" "$link"; fi
