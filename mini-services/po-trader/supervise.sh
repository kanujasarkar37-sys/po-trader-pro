#!/bin/bash
# po-trader supervisor — keeps the engine alive.
# IMPORTANT: this script must be launched DETACHED (double-fork + setsid) so it
# survives tool sessions:  ( setsid bash supervise.sh & )
# NOTE: never put "bun --hot index.ts" literally in this file's invocation path
# — pkill -f patterns match it. Log path must be writable by user z.
cd "$(dirname "$0")"
mkdir -p /tmp/po-engine
while true; do
  bun --hot ./index.ts >> /tmp/po-engine/engine.log 2>&1
  echo "[supervisor] $(date '+%H:%M:%S') engine exited rc=$? — restarting in 1s" >> /tmp/po-engine/engine.log
  sleep 1
done
