"""Step 5 of YarlisAISolutions/sdods#127: map stripe-sponsor.json into the site and turn sponsorship on.

Usage, from the repo root: python3 scripts/sponsor/sponsor-go-live.py . ~/sdods-stripe/stripe-sponsor.json
Runbook: .claude/skills/sdods-sponsor/SKILL.md
Only public URLs are read from the JSON (buy.stripe.com / billing.stripe.com); ids are ignored.
"""
import json, re, sys, pathlib

root = pathlib.Path(sys.argv[1])
data = json.load(open(sys.argv[2]))

def rw(rel, fn):
    p = root / rel
    s = p.read_text()
    out = fn(s)
    if out == s:
        sys.exit(f"no change in {rel}")
    p.write_text(out)

tiers = ["coffee", "supporter", "champion", "monthly-coffee", "monthly-supporter", "monthly-champion"]
urls = {t: data[f"link_{t}"]["url"] for t in tiers}
custom = data["link_any-amount"]["url"]
portal = data["portal"]["url"]
for u in [*urls.values(), custom]:
    assert re.match(r"^https://buy\.stripe\.com/\S+$", u), u
assert re.match(r"^https://billing\.stripe\.com/p/login/\S+$", portal), portal
assert len(set([*urls.values(), custom])) == 7, "duplicate payment link"

def sponsor_ts(s):
    for t, u in urls.items():
        s, n = re.subn(r"(id: '%s',[\s\S]*?url: )''" % re.escape(t), r"\g<1>'%s'" % u, s, count=1)
        assert n == 1, t
    s = s.replace("export const CUSTOM_AMOUNT_URL = '';", f"export const CUSTOM_AMOUNT_URL = '{custom}';")
    s = s.replace("export const MANAGE_SUBSCRIPTION_URL = '';", f"export const MANAGE_SUBSCRIPTION_URL =\n  '{portal}';")
    return s
rw("apps/www/lib/sponsor.ts", sponsor_ts)

rw("packages/contracts/src/sponsor.ts", lambda s: s.replace("SPONSOR_ENABLED: boolean = false;", "SPONSOR_ENABLED: boolean = true;"))
rw("installer/install.sh", lambda s: s.replace("SPONSOR_ENABLED=0\n", "SPONSOR_ENABLED=1\n"))
rw("installer/install.ps1", lambda s: s.replace("$SponsorEnabled = $false\n", "$SponsorEnabled = $true\n"))
rw("apps/desktop/src/main/menu.ts", lambda s: s.replace("const SPONSOR_ENABLED = false;\n", "const SPONSOR_ENABLED = true;\n"))

def readme(s):
    # Unwrap each `<!-- sponsor: ... -->` block, keeping its inner lines.
    s, n = re.subn(r"[ \t]*<!-- sponsor: [^\n]*\n([\s\S]*?)[ \t]*-->\n", r"\1", s)
    assert n == 3, f"expected 3 sponsor blocks in README.md, found {n}"
    return s
rw("README.md", readme)

rw(".github/FUNDING.yml", lambda s: s.replace(
    "#\n# Commented out while SPONSOR_ENABLED (packages/contracts/src/sponsor.ts) is off; uncomment with it.\n# custom: ['https://sdods.com/sponsor/']",
    "custom: ['https://sdods.com/sponsor/']"))

for pkg in ["agents", "cli", "contracts", "core", "db", "integrations", "mcp", "server"]:
    p = root / f"packages/{pkg}/package.json"
    s = p.read_text()
    if '"funding"' in s:
        continue
    out = re.sub(r'(\n  "license": "[^"]*",\n)', r'\1  "funding": "https://sdods.com/sponsor/",\n', s, count=1)
    assert out != s, f"no license line to anchor funding in {p}"
    p.write_text(out)

print("applied: 8 Stripe URLs, SPONSOR_ENABLED on in 4 copies, README, FUNDING.yml, package.json funding")
