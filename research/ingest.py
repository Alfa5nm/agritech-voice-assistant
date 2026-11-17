"""Bounded, resumable public source catalog. Collection requires recorded reuse permission."""
import argparse
from collections import deque
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import time
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent
AGENT = "AgritechResearchCatalog/1.0"
SKIP = re.compile(r"/(?:officers|staff|employee|login|register|registration|tender|jobs|contact|citizen|notice|feedback)(?:[/?.-]|$)", re.I)
RELEVANT = re.compile(r"crop|cultivat|rice|pest|disease|soil|water|weather|advis|forecast|calendar|bulletin|technolog|publication|book|ফসল|ধান|বালাই|মাটি|আবহাও|কৃষি|রোগ|সেচ|পরামর্শ|প্রযুক্তি", re.I)


def canonical(url):
    value = urlsplit(url)
    if value.scheme != "https" or value.username or value.password or value.port not in (None, 443):
        raise ValueError("Only public HTTPS URLs are allowed")
    return urlunsplit((value.scheme, value.netloc.lower(), value.path or "/", value.query, ""))


def validate_url(url, hosts, resolve=True):
    url = canonical(url)
    host = urlsplit(url).hostname
    if host not in hosts:
        raise ValueError("Publisher host not registered: " + host)
    if resolve:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError("Private network address rejected")
    return url


class Redirects(HTTPRedirectHandler):
    def __init__(self, hosts):
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl, self.hosts)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, hosts, maximum=20_971_520):
    validate_url(url, hosts)
    request = Request(url, headers={"User-Agent": AGENT, "Accept": "text/html,application/pdf,text/plain"})
    with build_opener(Redirects(hosts)).open(request, timeout=20) as response:
        data = response.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError("Document exceeds size limit")
        return data, response.headers.get_content_type(), response.headers.get_content_charset() or "utf-8"


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ignored = 0
        self.in_title = False
        self.title = []
        self.parts = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "footer", "header"):
            self.ignored += 1
        if tag == "title":
            self.in_title = True
        if tag == "a":
            attrs = dict(attrs)
            if attrs.get("href"):
                self.links.append(attrs["href"])

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer", "header"):
            self.ignored = max(0, self.ignored - 1)
        if tag == "title":
            self.in_title = False

    def handle_data(self, value):
        value = " ".join(value.split())
        if value and self.in_title:
            self.title.append(value)
        if value and not self.ignored:
            self.parts.append(value)


def chunks(text, size=1200):
    """Keep paragraphs together where possible; do not lose units at byte boundaries."""
    result, current = [], ""
    for paragraph in re.split(r"\n\s*\n", text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if current and len(current) + len(paragraph) > size:
            result.append(current)
            current = ""
        # Long paragraphs remain intact so dosage qualifications are not split away.
        current += ("\n\n" if current else "") + paragraph
    if current:
        result.append(current)
    return result


def rest(table, rows):
    base, key, token = (os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "AGRITECH_ACCESS_TOKEN"))
    if not all((base, key, token)):
        raise ValueError("Authenticated operator database settings are required")
    request = Request(base + "/rest/v1/" + table, data=json.dumps(rows).encode(), method="POST", headers={
        "apikey": key, "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "resolution=" + ("merge-duplicates" if table == "agritech_documents" else "ignore-duplicates") + ",return=minimal",
    })
    with build_opener().open(request, timeout=30) as response:
        response.read()


def source_permission(source):
    base, key, token = (os.environ[k] for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "AGRITECH_ACCESS_TOKEN"))
    request = Request(base + "/rest/v1/agritech_sources?id=eq." + source["id"] + "&select=reuse_status,reuse_basis", headers={"apikey": key, "Authorization": "Bearer " + token})
    with build_opener().open(request, timeout=20) as response:
        rows = json.load(response)
    if rows:
        source = {**source, **rows[0]}
    return source


def upload(identifier, body, kind):
    base, key, token = (os.environ[k] for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "AGRITECH_ACCESS_TOKEN"))
    request = Request(base + "/storage/v1/object/agritech-sources/" + identifier, data=body, method="POST", headers={"apikey": key, "Authorization": "Bearer " + token, "Content-Type": kind, "x-upsert": "false"})
    try:
        with build_opener().open(request, timeout=30) as response:
            response.read()
    except HTTPError as error:
        if error.code not in (400, 409):
            raise
        # A retry may find the same content-addressed object already uploaded.
        with build_opener().open(Request(base + "/storage/v1/object/authenticated/agritech-sources/" + identifier, headers={"apikey": key, "Authorization": "Bearer " + token}), timeout=30) as existing:
            if sha256(existing.read()).digest() != sha256(body).digest():
                raise ValueError("Stored object does not match this version")


def run(source, mode, limit, output, publish=False):
    if publish:
        source = source_permission(source)
    if mode == "collect" and not (source["reuse_status"] == "permitted" and source.get("reuse_basis")):
        raise ValueError("Collection requires documented source reuse permission")
    folder = output / source["id"]
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"documents": {}, "blocked": [], "complete": False}
    queue, seen, robots = deque([source["url"]]), set(), {}
    count = 0
    if publish:
        rest("agritech_sources", [source])
    while queue and count < limit:
        url = queue.popleft()
        try:
            url = validate_url(url, source["allowed_hosts"])
            if url in seen or SKIP.search(url):
                continue
            seen.add(url)
            origin = "https://" + urlsplit(url).netloc
            if origin not in robots:
                try:
                    body, _, _ = fetch(origin + "/robots.txt", source["allowed_hosts"], 262144)
                except HTTPError as error:
                    if error.code not in (404, 410):
                        raise
                    body = b""
                parser = RobotFileParser()
                parser.parse(body.decode("utf-8", errors="replace").splitlines())
                robots[origin] = parser
            if not robots[origin].can_fetch(AGENT, url):
                raise ValueError("Publisher robots policy disallows collection")
            count += 1
            time.sleep(max(1.0, float(robots[origin].crawl_delay(AGENT) or 0)))
            body, kind, charset = fetch(url, source["allowed_hosts"])
            digest = sha256(body).hexdigest()
            identifier = sha256((source["id"] + digest).encode()).hexdigest()
            title, pages, links, quality = url, [], [], "metadata_only"
            if kind == "text/html":
                page = Page()
                page.feed(body.decode(charset, errors="replace"))
                title = " ".join(page.title) or url
                links = page.links
                if mode == "collect":
                    pages = [(None, "\n\n".join(page.parts))]
                    quality = "extracted"
            elif kind == "application/pdf":
                if mode == "collect":
                    from pypdf import PdfReader
                    reader = PdfReader(BytesIO(body))
                    if len(reader.pages) > 200:
                        raise ValueError("Large PDF queued for separate extraction review")
                    pages = [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]
                    quality = "ocr_required" if any(len(text.strip()) < 30 for _, text in pages) else "extracted"
            elif kind == "text/plain" and mode == "collect":
                pages, quality = [(None, body.decode(charset, errors="replace"))], "extracted"
            elif kind not in ("application/pdf", "text/html", "text/plain"):
                continue
            if any(len(content) > 2_000_000 for _, content in pages):
                raise ValueError("Extracted page exceeds review limit")
            record = manifest["documents"].get(identifier) or {"id": identifier, "source_id": source["id"], "url": url, "title": title[:1000], "language": "bn", "retrieved_at": datetime.now(timezone.utc).isoformat(), "content_hash": digest, "version": digest, "extraction_status": quality, "metadata": {"reuse_status": source["reuse_status"], "district": None, "crop": None}}
            record["extraction_status"] = quality
            record["metadata"]["time_sensitive"] = bool(re.search(r"advisory|bulletin|forecast|বুলেটিন|পূর্বাভাস", title + " " + url, re.I))
            manifest["documents"][identifier] = record
            if mode == "collect":
                (folder / (identifier + (".pdf" if kind == "application/pdf" else ".html" if kind == "text/html" else ".txt"))).write_bytes(body)
                records = [{"id": sha256((identifier + str(page) + str(i) + content).encode()).hexdigest(), "document_id": identifier, "text": content, "page": page, "section": title[:1000], "review_status": "PENDING"} for page, content in pages for i, content in enumerate(chunks(content)) if len(content.strip()) >= 30]
                if any(len(record["text"]) > 8000 for record in records):
                    raise ValueError("Long passage queued for manual segmentation")
                (folder / (identifier + ".chunks.json")).write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
            if publish:
                rest("agritech_documents", [record])
                if mode == "collect" and records:
                    upload(identifier, body, kind)
                    for i in range(0, len(records), 50):
                        rest("agritech_chunks", records[i:i + 50])
            for link in links:
                target = urljoin(url, link)
                try:
                    target = validate_url(target, source["allowed_hosts"], resolve=False)
                except ValueError:
                    continue
                if target not in seen and RELEVANT.search(target) and not SKIP.search(target):
                    queue.append(target)
        except Exception as error:
            manifest["blocked"].append({"url": url, "reason": type(error).__name__ + ": " + str(error)[:180]})
        manifest["complete"] = False
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"source": source["id"], "documents": len(manifest["documents"]), "blocked": len(manifest["blocked"]), "complete": False, "mode": mode}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--mode", choices=["catalog", "collect"], default="catalog")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--output", type=Path, default=ROOT / "private" / "sources")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error("limit must be 1–100")
    sources = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    source = next((source for source in sources if source["id"] == args.source), None)
    if not source:
        parser.error("unknown registered source")
    print(json.dumps(run(source, args.mode, args.limit, args.output, args.publish)))
