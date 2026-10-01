#!/usr/bin/env python3
"""PreToolUse guard: deny destructive/dangerous actions, ask on risky ones.
Reads hook JSON on stdin. Fast, stdlib only. Internal error -> ask (never silently allow, never brick)."""
import json, re, sys

def out(decision, reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
          "permissionDecision": decision, "permissionDecisionReason": reason}}))
    sys.exit(0)

# (regex, reason) — matched against the whole command (covers chains, pipes, subshells)
DENY = [
    (r"\brm\s+(-\w*[rR]\w*[fF]\w*|-\w*[fF]\w*[rR]\w*|--recursive\b.*--force|--force\b.*--recursive)\s+(--\s+)?(/|~|\$HOME|\.\.?|\*|/\*)(\s|$)", "rm -rf on root/home/cwd/glob"),
    (r"\brm\s+-\w*[rR]\w*\s+.*\s(/Users/bnqtoan/?|/Users/bnqtoan/Documents/?|~/?)(\s|$)", "rm -r on home/Documents"),
    (r"\bsudo\b", "sudo"),
    (r"\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b|\s\+\S)", "git force push"),
    (r"\bgit\s+push\b.*\s(main|master)\b", "push to main/master directly (branch first)"),
    (r"\bgit\s+reset\s+--hard\b", "git reset --hard (loses uncommitted work)"),
    (r"\bgit\s+clean\s+-\w*[fdx]", "git clean (deletes untracked files)"),
    (r"\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)", "git checkout/restore . (discards all changes)"),
    (r"\bgit\s+branch\s+-D\b", "git branch -D"),
    (r"\bgit\s+.*--no-verify\b", "skipping git hooks"),
    # Remote data / prod: this repo's D1 + deploy
    (r"\bpnpm\s+(run\s+)?db:migrate:(dev|preview|prod)\b", "remote D1 migration"),
    (r"\bpnpm\s+(run\s+)?db:seed:admin\b", "remote admin seed"),
    (r"\bdeploy-prod\.sh\b|\bpnpm\s+(run\s+)?deploy\b", "production deploy"),
    (r"\bwrangler\b.*\b(deploy|publish|delete|rollback)\b", "wrangler deploy/delete/rollback"),
    (r"\bwrangler\b.*\bd1\b.*\b(execute|migrations\s+apply|delete|time-travel\s+restore)\b.*--remote", "remote D1 write"),
    (r"\bwrangler\b.*\b(secret|kv\s+(key|bulk)\s+(put|delete)|queues\s+delete|r2\s+(object|bucket)\s+(put|delete))\b", "wrangler secret/KV/queue/R2 mutation"),
    (r"\bdrizzle-kit\s+(push|drop)\b", "drizzle-kit push/drop (project rule: generate only)"),
    (r"\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*;?\s*(\"|'|$))", "destructive SQL"),
    # Process rules of this project: 8788 belongs to another project; never mass-kill
    (r"\b(pkill|killall)\b", "mass kill — stop only your own processes by PID"),
    (r"\bkill\b.*\$\(\s*lsof\b|\blsof\b.*\|\s*xargs\s+kill", "kill by port lookup (8788 is another project)"),
    (r":8788\b.*\bkill\b|\bkill\b.*:8788\b", "8788 belongs to another project"),
    (r"free-ports\.sh", "free-ports.sh kills every wrangler/workerd (incl. pnpm dev) — run by hand"),
    # Exfil / remote-exec / secrets
    (r"\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b", "pipe remote script to shell"),
    (r"\b(cat|less|head|tail|cp|mv|scp|rsync|base64|xxd|open)\b[^|;&]*(\.dev\.vars(?!\.example)|(^|[\s/])\.env(\.(?!example)\S*)?(\s|$)|\.ssh/|aws/credentials|\.npmrc\b)", "reads/moves secret file"),
    (r"\b(curl|wget|nc)\b.*(-d\s*@|--data(-binary)?\s*@|-F\s+\S+=@|-T\s)\S*(\.env|\.dev\.vars|\.ssh|credentials)", "uploading secret file"),
    (r"\b(chmod|chown)\s+-R\b", "recursive chmod/chown"),
    (r"\b(mkfs|dd\s+if=|diskutil\s+(erase|reformat))\b|>\s*/dev/(disk|sd)", "disk-level write"),
    (r":\(\)\s*\{\s*:\|:&\s*\};:", "fork bomb"),
    (r"\bnpm\s+publish\b|\bpnpm\s+publish\b", "package publish"),
]
ASK = [
    (r"\brm\s+-\w*[rR]", "recursive delete — confirm target"),
    (r"\bgit\s+(stash\s+(drop|clear)|rebase|commit\s+--amend|tag\s+-d|push\s+.*--delete)\b", "history-rewriting git"),
    (r"\bpnpm\s+(install|add|remove|update|up)\b.*(-g\b|--global)|\bnpm\s+i(nstall)?\s+-g\b", "global install"),
    (r"\bpnpm\s+dev:reset\b", "dev:reset wipes the wrong dir (see CLAUDE.md)"),
    (r"\bmv\b.*\.wrangler/state", "moving local D1 state — only if intended"),
]
# File tools: protected paths
PROTECTED = [
    (r"(^|/)\.env(\.(?!example$)[^/]*)?$", "secret env file"),
    (r"(^|/)\.dev\.vars(\.(?!example$)[^/]*)?$", "secret .dev.vars"),
    (r"(^|/)\.git/", ".git internals"),
    (r"(^|/)\.ssh/|aws/credentials", "credentials"),
    (r"(^|/)\.claude/(hooks/guard\.py|settings(\.local)?\.json)$", "guard/settings — edit by hand"),
    (r"(^|/)apps/api/src/db/migrations/.*\.sql$", "applied migration — use pnpm db:generate, never hand-edit"),
    (r"(^|/)pnpm-lock\.yaml$", "lockfile — change via pnpm"),
]

try:
    d = json.load(sys.stdin)
    tool, ti = d.get("tool_name", ""), d.get("tool_input", {}) or {}
    if tool == "Bash":
        cmd = ti.get("command", "")
        for rx, why in DENY:
            if re.search(rx, cmd, re.I if "SQL" in why else 0):
                out("deny", f"guard: {why}. Do something safer or ask the human to run it (`! cmd`).")
        for rx, why in ASK:
            if re.search(rx, cmd):
                out("ask", f"guard: {why}")
    elif tool in ("Write", "Edit", "MultiEdit", "NotebookEdit", "Read"):
        p = ti.get("file_path") or ti.get("notebook_path") or ""
        for rx, why in PROTECTED:
            if re.search(rx, p):
                if tool == "Read" and not re.search(r"secret|credentials", why):
                    continue  # reading non-secret protected files is fine
                out("deny", f"guard: {why}: {p}")
except SystemExit:
    raise
except Exception as e:  # unknown input -> make the human look
    out("ask", f"guard internal error ({type(e).__name__}); confirm manually")
sys.exit(0)
