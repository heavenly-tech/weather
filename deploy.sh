#!/usr/bin/env bash
# Restart the prebuilt weather image on heavenly.
# This script does not build, and it does not put secrets on the command line.
#
# Build on omarchibald or the Mac mini, for linux/amd64:
#   docker build --platform linux/amd64 -t app-heavenly-weather:latest .
#   docker save app-heavenly-weather:latest | ssh heavenly docker load
#
# Before the swap, load Infrastructure's prebuilt Node image
# app-heavenly-weather:node (see docs/cutover-checklist.md) and check its digest.
# Do not rebuild that image on the VPS.
#
# Rollback, one command, from a machine that can ssh heavenly:
#   ssh heavenly 'docker tag app-heavenly-weather:node app-heavenly-weather:latest && cd /opt/stacks/app-heavenly-weather && docker compose up -d --no-build --force-recreate'
#
# METEOCHILE_USER and METEOCHILE_TOKEN stay in the env file next to compose
# on the VPS. Do not pass them to this script.
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
  docker image inspect app-heavenly-weather:latest >/dev/null
  cd '$REMOTE'
  docker compose up -d --no-build --pull never
"

echo "https://weather.heavenly.cl"
