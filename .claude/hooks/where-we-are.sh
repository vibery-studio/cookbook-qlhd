#!/usr/bin/env bash
# SessionStart hook: Claude Code runs this when a session starts; what it prints lands in Claude's context.
# It answers one question: where are we in docs/WORKFLOW.md?
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
echo "Where we are (docs/):"
for step in intent spec plan fix; do
  f=$(ls docs/$step/*.md 2>/dev/null | sort | tail -1)
  [ -n "$f" ] && echo "- $step: $f — $(grep -m1 -i '^Status:' "$f" || echo 'Status: ?')"
done
# the roadmap: the agreed order of features — Claude builds only what is on the Active one
rm_active=$(grep -l -i -E '^Status:[[:space:]]*Active' docs/roadmap/ROADMAP-*.md 2>/dev/null | sort | tail -1)
if [ -n "$rm_active" ]; then
  next=$(awk -F'|' '/^\|[[:space:]]*[0-9]+[[:space:]]*\|/ { st=$(NF-1); gsub(/[ \t]/,"",st); if (tolower(st) !~ /^done/) { gsub(/^[ \t]+|[ \t]+$/,"",$2); gsub(/^[ \t]+|[ \t]+$/,"",$3); print "#" $2 " " $3; exit } }' "$rm_active")
  if [ -n "$next" ]; then echo "- roadmap: $rm_active (Active) — next: $next"
  else echo "- roadmap: $rm_active — every row is done → draft the next ROADMAP (MAP lines not served yet + Parked + what users asked for), then STOP for approval"; fi
elif [ -f ENGINEERING.md ]; then
  echo "- roadmap: none Active yet → after ENGINEERING.md is approved, draft docs/roadmap/ROADMAP-01.md before any feature"
fi
todo=$(grep -l -E '^status: *(todo|doing)' docs/plan/cards/*.md 2>/dev/null | wc -l | tr -d ' ')
[ "$todo" != 0 ] && echo "- cards not done: $todo"
[ -z "$(ls docs/intent docs/fix 2>/dev/null)" ] && echo "- no feature started yet"
changed=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[ "$changed" != 0 ] && echo "- uncommitted changes: $changed file(s) — waiting for the human's OK?"
echo "Tell the human where we are in one line before anything else."
exit 0
