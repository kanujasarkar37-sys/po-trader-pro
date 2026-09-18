#!/bin/bash
# po-trader supervisor — restarts the engine if it exits (survives tool sessions
# via double-fork launch; see worklog). NOTE: never put "bun --hot index.ts"
# literally in this file's invocation path — pkill -f patterns match it.
cd "$(dirname "$0")"
while true; do
  bun --hot ./index.ts >> /tmp/po-trader.log 2>&1
  echo "[supervisor] $(date '+%H:%M:%S') engine exited rc=$? — restarting in 1s" >> /tmp/po-trader.log
  sleep 1
done
