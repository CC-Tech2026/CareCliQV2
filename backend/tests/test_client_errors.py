"""Crash reports from the web app are logged, rate limited and work signed out."""
from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from backend.app.api import client_errors
from backend.app.main import app


@pytest.fixture(autouse=True)
def reset_rate_limit():
    client_errors._reports.clear()
    yield
    client_errors._reports.clear()


def test_signed_out_report_is_logged(caplog):
    with caplog.at_level(logging.ERROR, logger="carecliq.client_errors"):
        response = TestClient(app).post("/api/client-errors", json={
            "kind": "render", "message": "Cannot read properties of undefined", "url": "/incidents/1",
        })
    assert response.status_code == 204
    assert "Cannot read properties of undefined" in caplog.text
    assert "/incidents/1" in caplog.text


def test_invalid_token_does_not_block_the_report():
    response = TestClient(app).post(
        "/api/client-errors",
        json={"message": "boom"},
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert response.status_code == 204


def test_oversized_fields_are_rejected():
    response = TestClient(app).post("/api/client-errors", json={"message": "x" * 5000})
    assert response.status_code == 422


def test_rate_limited_per_ip():
    client = TestClient(app)
    codes = [client.post("/api/client-errors", json={"message": "boom"}).status_code for _ in range(client_errors._MAX_REPORTS + 1)]
    assert codes[:-1] == [204] * client_errors._MAX_REPORTS
    assert codes[-1] == 429
