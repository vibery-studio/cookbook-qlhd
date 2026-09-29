#!/usr/bin/env bash
# Stop ONLY this repo's dev/e2e workerd + wrangler processes (by PID, matched on this repo's path), then report the ports.
# Never pkill/killall workerd: other projects on the machine run their own (e.g. a demo app on 8788).
ROOT=$(git rev-parse --show-toplevel)
PIDS=$(pgrep -f "$ROOT/node_modules/.*(workerd|wrangler)" || true)
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null && echo "stopped: $PIDS" || echo "nothing of this repo running"
for p in ${@:-8787 8791}; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && echo "port $p: still busy (another project?) — pick another port, don't wait" || echo "port $p: free"; done
