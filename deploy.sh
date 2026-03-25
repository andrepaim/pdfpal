#!/bin/bash
set -e
echo "Deploying clawd-reader..."
cd /root/clawd-reader/frontend
npm install
# Keep worker in sync with installed react-pdf version
cp node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
npm run build
systemctl restart clawd-reader
echo "Done!"
