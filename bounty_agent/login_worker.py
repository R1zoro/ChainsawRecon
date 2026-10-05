from __future__ import annotations

"""A deterministic Playwright login worker for simple id+password web apps.

The model never sees credentials: the runner writes a login spec JSON file
(``--spec``) that names *environment variables* holding the username and
password, and this script reads them from its own environment.  Secrets never
appear on the command line, in traces, or in artifacts.

The worker launches Firefox (the operator-facing "mozilla tab"), performs the
login, and captures the resulting session state (cookies + storage) to a JSON
output file.  It deliberately does not crawl or submit anything beyond the
login form.
"""

LOGIN_WORKER_SCRIPT = r'''import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True, help="Path to login spec JSON (selectors, urls, env var names).")
    parser.add_argument("--output", required=True)
    parser.add_argument("--timeout-ms", type=int, default=30000)
    args = parser.parse_args()

    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    login_url = spec["login_url"]
    verify_url = spec.get("verify_url", "")
    headless = bool(spec.get("headless", True))
    verify_only = bool(spec.get("verify_only"))

    result = {
        "success": False, "final_url": "", "title": "", "cookies": [],
        "storage": {}, "verify_status": None, "verify_ok": None, "error": "",
    }

    from playwright.sync_api import sync_playwright

    if verify_only:
        # Cookie-injection lane: no login.  Restore the operator-supplied (or
        # previously captured) cookies, then judge the session by verify_url.
        supplied = spec.get("cookies") or {}
        with sync_playwright() as p:
            browser = p.firefox.launch(headless=headless)
            context = browser.new_context(ignore_https_errors=False)
            domain = urlparse(login_url).hostname or ""
            context.add_cookies([
                {"name": name, "value": value, "domain": domain, "path": "/"}
                for name, value in supplied.items()
            ])
            page = context.new_page()
            page.set_default_timeout(args.timeout_ms)
            try:
                target = verify_url or login_url
                resp = page.goto(target, wait_until="domcontentloaded")
                page.wait_for_timeout(500)
                result["final_url"] = page.url
                result["title"] = page.title()
                result["verify_status"] = resp.status if resp else None
                indicator = spec.get("verify_indicator", "")
                if indicator:
                    result["verify_ok"] = indicator in page.content()
                else:
                    result["verify_ok"] = resp is not None and resp.status < 400
                result["success"] = bool(result["verify_ok"])
                result["cookies"] = context.cookies()
            except Exception as exc:
                result["error"] = f"{type(exc).__name__}: {exc}"
            finally:
                browser.close()
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"success": result["success"], "verify_ok": result["verify_ok"],
                          "cookies": len(result["cookies"]), "error": result["error"]}))
        return

    username = os.environ.get(spec.get("username_env", ""), "")
    password = os.environ.get(spec.get("password_env", ""), "")
    if not username or not password:
        result["error"] = "credentials missing from environment (check username_env/password_env names)"
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(result), encoding="utf-8")
        print(json.dumps({"success": False, "error": result["error"]}))
        return

    with sync_playwright() as p:
        browser = p.firefox.launch(headless=headless)
        context = browser.new_context(ignore_https_errors=False)
        page = context.new_page()
        page.set_default_timeout(args.timeout_ms)
        try:
            page.goto(login_url, wait_until="domcontentloaded")
            page.wait_for_timeout(800)

            user_sel = _first_present(page, [spec.get("username_selector"),
                "input[type=email]", "input[name*=user i]", "input[name*=email i]",
                "input[name=username]", "input[id*=user i]", "input[type=text]"])
            pass_sel = _first_present(page, [spec.get("password_selector"), "input[type=password]"])
            if not user_sel or not pass_sel:
                raise RuntimeError(f"could not locate login fields (user={user_sel!r} pass={pass_sel!r})")

            page.fill(user_sel, username)
            page.fill(pass_sel, password)

            submit_sel = _first_present(page, [spec.get("submit_selector"),
                "button[type=submit]", "input[type=submit]", "button:has-text('Log in')",
                "button:has-text('Sign in')", "button:has-text('Login')"])
            if submit_sel:
                page.click(submit_sel)
            else:
                page.press(pass_sel, "Enter")

            # Wait for a success signal: url change, explicit url fragment, or selector.
            success_url_contains = spec.get("success_url_contains", "")
            success_selector = spec.get("success_selector", "")
            try:
                if success_url_contains:
                    page.wait_for_url(lambda u: success_url_contains in u, timeout=10000)
                elif success_selector:
                    page.wait_for_selector(success_selector, timeout=10000)
                else:
                    page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass  # fall through; we judge by final state below

            result["final_url"] = page.url
            result["title"] = page.title()
            logged_in = True
            if success_url_contains:
                logged_in = success_url_contains in page.url
            elif success_selector:
                logged_in = page.query_selector(success_selector) is not None
            else:
                logged_in = urlparse(page.url).path.rstrip("/") != urlparse(login_url).path.rstrip("/")
            result["success"] = bool(logged_in)

            result["cookies"] = context.cookies()
            try:
                result["storage"] = page.evaluate(
                    "() => Object.fromEntries(Object.entries(localStorage))")
            except Exception:
                result["storage"] = {}

            if verify_url and result["success"]:
                resp = page.goto(verify_url, wait_until="domcontentloaded")
                result["verify_status"] = resp.status if resp else None
                indicator = spec.get("verify_indicator", "")
                if indicator:
                    body = page.content()
                    result["verify_ok"] = indicator in body
                else:
                    result["verify_ok"] = resp is not None and resp.status < 400
        except Exception as exc:
            result["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            browser.close()

    # Never persist the credentials themselves.
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"success": result["success"], "final_url": result["final_url"],
                      "cookies": len(result["cookies"]), "verify_ok": result["verify_ok"],
                      "error": result["error"]}))


def _first_present(page, selectors):
    for sel in selectors:
        if not sel:
            continue
        try:
            if page.query_selector(sel) is not None:
                return sel
        except Exception:
            continue
    return None


if __name__ == "__main__":
    main()
'''
