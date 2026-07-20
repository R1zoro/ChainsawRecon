from __future__ import annotations

import json

from bounty_agent.browser_evidence import parse_har
from bounty_agent.recon_db import ReconStore, SurfaceRecord
from bounty_agent.source_analysis import analyze_source_tree
from bounty_agent.technologies import detect_technology_observations
from bounty_agent.world_model import WorldModel, stable_id


def test_world_model_materializes_generator_hosts_and_exports_catalogs(tmp_path):
    store = ReconStore(tmp_path / "engagement.db")
    world = WorldModel(store, "eng-1", program_name="Example", target="https://app.example.com", mode="mapping")
    surfaces = (
        SurfaceRecord(f"https://{host}{path}", host, path, kind, "test", auth_context="guest")
        for host, path, kind in [
            ("app.example.com", "/", "web"),
            ("api.example.com", "/v1/orders", "api"),
        ]
    )
    world.ingest_surfaces(surfaces)
    summary = world.architecture_summary()
    assert {item["host"] for item in summary["services"]} == {"app.example.com", "api.example.com"}
    assert any(item["path"] == "/v1/orders" for item in summary["routes"])
    world.write_catalogs(tmp_path / "catalogs")
    assert (tmp_path / "catalogs" / "world-model.json").exists()
    store.close()


def test_source_analysis_extracts_framework_routes_and_client_endpoints(tmp_path):
    (tmp_path / "app.py").write_text("from flask import Flask\napp = Flask(__name__)\n@app.get('/api/orders')\ndef orders(): pass\n")
    (tmp_path / "client.js").write_text("fetch('/api/profile'); const token = localStorage.getItem('jwt')")
    analysis = analyze_source_tree(tmp_path)
    assert "Flask" in analysis.frameworks
    assert any(route.path == "/api/orders" and route.method == "GET" for route in analysis.routes)
    assert "/api/profile" in analysis.client_endpoints
    assert "jwt" in analysis.auth_indicators


def test_har_import_parser_preserves_request_shape_and_session(tmp_path):
    path = tmp_path / "capture.har"
    path.write_text(json.dumps({"log": {"creator": {"name": "Chrome"}, "entries": [{
        "request": {"method": "POST", "url": "https://api.example.com/v1/orders", "headers": [{"name": "Cookie", "value": "sid=abc"}], "postData": {"text": "{\"id\":1}"}},
        "response": {"status": 201, "headers": [{"name": "Server", "value": "nginx"}], "content": {"text": "created"}},
    }]}}), encoding="utf-8")
    capture = parse_har(path)
    assert capture.requests[0].auth_context == "authenticated"
    assert capture.requests[0].response_status == 201
    assert capture.sessions[0].cookies == {"sid": "abc"}


def test_technology_detection_is_evidence_based():
    observations = detect_technology_observations({"server": "nginx/1.25", "x-powered-by": "Express"}, "", "https://example.com/graphql")
    assert {item.name for item in observations} >= {"Nginx", "Express", "GraphQL"}
