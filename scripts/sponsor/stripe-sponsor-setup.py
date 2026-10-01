"""Creates the SDODS sponsorship objects in Stripe (live mode): 2 products, 7 prices, 7 payment links
and a customer-portal login page. Safe to re-run: progress is saved to ./stripe-sponsor.json and
anything already created is skipped. Run with STRIPE_API_KEY=rk_live_... in the environment, from a
folder outside the repo (e.g. ~/sdods-stripe/). Runbook: .claude/skills/sdods-sponsor/SKILL.md"""
import json, subprocess, sys, os
PROFILE = os.environ.get("STRIPE_PROFILE", "sdods")
# With STRIPE_API_KEY set (a restricted live key you created), the CLI uses it instead of a profile.
FLAGS = [] if os.environ.get("STRIPE_API_KEY") else ["--project-name", PROFILE, "--live"]
OUT = os.path.join(os.getcwd(), "stripe-sponsor.json")
state = json.load(open(OUT)) if os.path.exists(OUT) else {}
def save(): json.dump(state, open(OUT, "w"), indent=2)

def api(method, path, params):
    cmd = ["stripe", method, path] + FLAGS
    for k, v in params.items():
        cmd += ["-d", f"{k}={v}"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try: d = json.loads(r.stdout)
    except Exception: sys.exit(f"bad output for {path}: {r.stdout}{r.stderr}")
    if "error" in d: sys.exit(f"{path}: {json.dumps(d['error'])}")
    if d.get("livemode") is False: sys.exit(f"{path}: not live mode")
    return d

def once(key, fn):
    if key not in state:
        state[key] = fn(); save()
        print("created", key, state[key] if isinstance(state[key], str) else "")
    return state[key]

M = {"metadata[source]": "sdods-sponsor"}
p_once = once("product_once", lambda: api("post", "/v1/products", {**M, "name": "Sponsor SDODS",
    "description": "One-time sponsorship of the SDODS open-source project"})["id"])
p_month = once("product_monthly", lambda: api("post", "/v1/products", {**M, "name": "SDODS Monthly Sponsor",
    "description": "Monthly sponsorship of the SDODS open-source project"})["id"])

TIERS = [("coffee", 500, None), ("supporter", 2500, None), ("champion", 10000, None),
         ("monthly-coffee", 500, "month"), ("monthly-supporter", 2500, "month"), ("monthly-champion", 10000, "month")]
for tid, cents, interval in TIERS:
    params = {**M, "metadata[tier]": tid, "currency": "usd", "unit_amount": cents,
              "product": p_month if interval else p_once, "nickname": tid}
    if interval: params["recurring[interval]"] = interval
    once(f"price_{tid}", lambda: api("post", "/v1/prices", params)["id"])

def custom_price():
    for mx in (99999999, 10000000, 1000000):
        cmd = {**M, "metadata[tier]": "any-amount", "currency": "usd", "product": p_once, "nickname": "any-amount",
               "custom_unit_amount[enabled]": "true", "custom_unit_amount[preset]": 5000,
               "custom_unit_amount[minimum]": 100, "custom_unit_amount[maximum]": mx}
        r = subprocess.run(["stripe", "post", "/v1/prices"] + FLAGS + sum([["-d", f"{k}={v}"] for k, v in cmd.items()], []), capture_output=True, text=True)
        d = json.loads(r.stdout)
        if "error" not in d:
            state["custom_max_cents"] = mx; return d["id"]
        print("max", mx, "rejected:", d["error"].get("message"))
    sys.exit("no custom max accepted")
once("price_any-amount", custom_price)

COMMON = {"after_completion[type]": "redirect",
          "after_completion[redirect][url]": "https://sdods.com/sponsor/thanks/",
          "billing_address_collection": "auto",
          "custom_fields[0][key]": "thanks",
          "custom_fields[0][label][type]": "custom",
          "custom_fields[0][label][custom]": "Name or company to thank publicly",
          "custom_fields[0][type]": "text",
          "custom_fields[0][optional]": "true",
          "line_items[0][quantity]": 1}
for tid in [t[0] for t in TIERS] + ["any-amount"]:
    monthly = tid.startswith("monthly")
    params = {**COMMON, **M, "metadata[tier]": tid, "line_items[0][price]": state[f"price_{tid}"]}
    if monthly:
        params["subscription_data[metadata][source]"] = "sdods-sponsor"
        params["subscription_data[metadata][tier]"] = tid
    else:
        params["submit_type"] = "pay"
        params["payment_intent_data[metadata][source]"] = "sdods-sponsor"
        params["payment_intent_data[metadata][tier]"] = tid
    def mk(params=params):
        d = api("post", "/v1/payment_links", params); return {"id": d["id"], "url": d["url"]}
    once(f"link_{tid}", mk)

def portal():
    d = api("post", "/v1/billing_portal/configurations", {
        "business_profile[headline]": "SDODS Developers: manage your sponsorship",
        "business_profile[privacy_policy_url]": "https://sdods.com/privacy/",
        "default_return_url": "https://sdods.com/sponsor/",
        "features[subscription_cancel][enabled]": "true",
        "features[subscription_cancel][mode]": "immediately",
        "features[payment_method_update][enabled]": "true",
        "features[invoice_history][enabled]": "true",
        "login_page[enabled]": "true",
        "metadata[source]": "sdods-sponsor"})
    return {"id": d["id"], "url": d["login_page"]["url"]}
once("portal", portal)
print(json.dumps({k: v for k, v in state.items()}, indent=2))
