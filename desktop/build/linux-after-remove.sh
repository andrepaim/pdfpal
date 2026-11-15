#!/bin/sh
set -eu
link=/usr/bin/pdfpal-desktop-cli
if [ -L "$link" ] && [ "$(readlink "$link")" = /opt/pdfpal/bin/pdfpal-desktop-cli ]; then rm "$link"; fi
