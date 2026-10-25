#!/usr/bin/env bash
# Kage smoke check:
#  1. every relative asset referenced in index.html exists on disk
#  2. the inline <script> block parses clean (node --check)
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
while IFS= read -r ref; do
  if [ ! -e "$ref" ]; then
    echo "MISSING: $ref"
    fail=1
  fi
done < <(python3 - <<'EOF'
import re
h = open('index.html', encoding='utf-8').read()
refs = set()
for pat in [r"url\(\s*['\"]?([^'\")\s]+)['\"]?\s*\)",
            r'(?:src|href)="([^"#]+)"']:
    for m in re.finditer(pat, h):
        u = m.group(1)
        if not u.startswith(('data:', 'http', '#', 'mailto:')):
            refs.add(u)
print('\n'.join(sorted(refs)))
EOF
)

python3 - <<'EOF'
import re
h = open('index.html', encoding='utf-8').read()
m = re.search(r'<script>\n(.*)</script>', h, re.S)
open('/tmp/kage-inline-check.js', 'w', encoding='utf-8').write(m.group(1))
EOF
node --check /tmp/kage-inline-check.js || fail=1
node scripts/test-reduced-motion.js || fail=1

if [ "$fail" = 0 ]; then
  echo "kage check: OK"
else
  echo "kage check: FAILED"
  exit 1
fi
