#!/bin/bash
set -e
echo "Deploying pdfpal..."
cd /home/openclaw/pdfpal/frontend
npm install
# Keep worker in sync with installed react-pdf version
cp node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
npm run build
systemctl restart pdfpal
echo "Done!"
