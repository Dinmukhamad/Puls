from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_missions_navigation_keeps_levels_separate():
    html = _read("index.html")
    shell = _read("js/src/app/00-core-shell.js")
    assert 'data-nav-target="missions"' in html
    assert 'data-nav-target="operator-levels"' in html
    assert "case 'missions': renderMissions();" in shell
    assert "'operator-levels'" in shell
    assert "'missions'" in shell


def test_missions_frontend_has_required_safe_interactions():
    view = _read("js/src/views/missions/80-missions.view.js")
    api = _read("js/src/api/domains/35-missions.api.js")
    assert 'inputmode="tel"' in view
    assert 'inputmode="numeric"' in view
    assert 'aria-live="polite"' in view
    assert "sessionStorage.setItem('puls-mission-attempt'" in view
    assert "masked_phone" in view
    assert "submitMissionCode" in view
    assert "completed_targets" in view
    assert "Idempotency-Key" in api
    assert "listMissionAttempts" in api


def test_missions_styles_cover_themes_breakpoints_and_reduced_motion():
    styles = _read("css/src/views/60-missions.css")
    assert "var(--card-bg)" in styles
    assert "@media (max-width:1199px)" in styles
    assert "@media (max-width:767px)" in styles
    assert "@media (max-width:360px)" in styles
    assert "@media (prefers-reduced-motion:reduce)" in styles
    assert "aspect-ratio:9/19.5" in styles
