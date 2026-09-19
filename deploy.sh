#!/usr/bin/env bash
# Deploy to heavenly the same way mora and flight_vis do:
# ssh heavenly, stack under /opt/stacks, docker compose on proxy_network.
set -euo pipefail
REMOTE=/opt/stacks/app-heavenly-weather
REPO=https://github.com/heavenly-tech/weather.git

ssh heavenly "set -euo pipefail
  mkdir -p /opt/stacks
  if [ -d '$REMOTE/.git' ]; then
    git -C '$REMOTE' fetch origin
    git -C '$REMOTE' checkout main
    git -C '$REMOTE' pull --ff-only origin main
  else
    git clone --branch main '$REPO' '$REMOTE'
  fi
  cd '$REMOTE'
  docker compose up -d --build
"

echo "https://weather.heavenly.cl"
