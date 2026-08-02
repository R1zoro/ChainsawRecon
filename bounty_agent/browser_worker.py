from __future__ import annotations

"""A small, deterministic, same-origin Playwright mapping worker.

It deliberately maps public browser evidence; it does not submit forms, create
accounts, or replay state-changing requests.  The LLM chooses when to invoke it
and inspects its saved capture through the artifact store.
"""

BROWSER_WORKER_SCRIPT = r'''import argparse
import json
import os
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse


def same_origin(value, origin):
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and parsed.netloc == origin


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-pages", type=int, default=5)
    parser.add_argument("--max-depth", type=int, default=1)
    parser.add_argument("--timeout-ms", type=int, default=20000)
    parser.add_argument("--screenshot-dir", default="")
    args = parser.parse_args()
    from playwright.sync_api import sync_playwright

    start = args.url
    origin = urlparse(start).netloc
    output = {"start_url": start, "origin": origin, "pages": [], "forms": [], "scripts": [], "network": [], "console": [], "screenshots": [], "errors": []}
    queue = [(start, 0)]
    visited = set()
    with sync_playwright() as p:
        executable = "/usr/bin/chromium" if os.path.exists("/usr/bin/chromium") else None
        browser = p.chromium.launch(headless=True, executable_path=executable, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(ignore_https_errors=False)
        page = context.new_page()
        page.set_default_timeout(args.timeout_ms)
        def route_handler(route):
            if same_origin(route.request.url, origin):
                route.continue_()
            else:
                route.abort()
        page.route("**/*", route_handler)
        page.on("console", lambda msg: output["console"].append({"type": msg.type, "text": msg.text[:500]}))
        page.on("dialog", lambda dialog: dialog.dismiss())
        page.on("popup", lambda popup: popup.close())
        page.on("request", lambda req: output["network"].append({"url": req.url, "method": req.method, "resource_type": req.resource_type}) if same_origin(req.url, origin) else None)
        while queue and len(visited) < max(1, min(args.max_pages, 20)):
            url, depth = queue.pop(0)
            normalized = urldefrag(url)[0]
            if normalized in visited or not same_origin(normalized, origin):
                continue
            visited.add(normalized)
            try:
                response = page.goto(normalized, wait_until="domcontentloaded")
                page.wait_for_timeout(500)
                page_data = page.evaluate("""() => ({
                    title: document.title,
                    forms: Array.from(document.forms).map((form, index) => ({
                        form_id: 'form-' + index,
                        action: form.action || location.href,
                        method: (form.method || 'GET').toUpperCase(),
                        inputs: Array.from(form.elements).filter(el => el.name || el.type).map(el => ({
                            name: el.name || '', type: el.type || el.tagName.toLowerCase(),
                            id: el.id || '', required: !!el.required, value: (el.value || '').slice(0, 120)
                        }))
                    })),
                    links: Array.from(document.querySelectorAll('a[href]')).map(a => a.href),
                    scripts: Array.from(document.scripts).map(s => s.src).filter(Boolean),
                    text_length: (document.body?.innerText || '').length
                })""")
                final_url = page.url
                output["pages"].append({"url": normalized, "final_url": final_url, "status": response.status if response else None, "title": page_data["title"], "text_length": page_data["text_length"]})
                if args.screenshot_dir:
                    screenshot = Path(args.screenshot_dir) / (str(len(output["pages"])) + ".png")
                    screenshot.parent.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(screenshot), full_page=True)
                    output["screenshots"].append(str(screenshot))
                for form in page_data["forms"]:
                    form["page_url"] = final_url
                    output["forms"].append(form)
                output["scripts"].extend({"page_url": final_url, "url": item} for item in page_data["scripts"] if same_origin(item, origin))
                if depth < max(0, min(args.max_depth, 3)):
                    for link in page_data["links"]:
                        link = urldefrag(link)[0]
                        if same_origin(link, origin) and link not in visited:
                            queue.append((link, depth + 1))
            except Exception as exc:
                output["errors"].append({"url": normalized, "error": f"{type(exc).__name__}: {exc}"})
        browser.close()
    output["network"] = list({(i["url"], i["method"], i["resource_type"]): i for i in output["network"]}.values())[:500]
    output["scripts"] = list({i["url"]: i for i in output["scripts"]}.values())[:500]
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"pages": len(output["pages"]), "forms": len(output["forms"]), "scripts": len(output["scripts"]), "network": len(output["network"]), "screenshots": len(output["screenshots"]), "errors": len(output["errors"])}))

if __name__ == "__main__":
    main()
'''
