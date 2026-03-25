#!/bin/bash
set -e
echo "Deploying clawd-reader..."
cd /root/clawd-reader/frontend && npm install && npm run build
systemctl restart clawd-reader
echo "Done!"
