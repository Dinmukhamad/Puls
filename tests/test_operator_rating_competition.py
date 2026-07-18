"""Frontend acceptance checks for the focused operator rating dashboard."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEW = ROOT / "js/src/views/rating/zz-operator-rating-competition.view.js"
STYLES = ROOT / "css/src/views/zz-operator-rating-competition.css"


def test_operator_rating_focuses_on_rivals_groups_and_progress() -> None:
    source = VIEW.read_text("utf-8")

    assert "Ближайшая цель" in source
    assert "Ближайшие соперники" in source
    assert "Догоняет вас" in source
    assert "Командная гонка" in source
    assert "Как растут мои показатели" in source
    assert "/api/rating/operator-dynamics?mode=points&limit=8" in source
    assert "/api/rating/operator-dynamics?mode=rank&limit=8" in source
    assert "api.getRatingRace({ mode: 'all' })" in source

    # Operators receive an infographic dashboard, not another dense data table.
    assert "<table" not in source
    assert "rc-trend-chart" in source
    assert "rc-target-progress" in source


def test_management_rating_is_preserved() -> None:
    source = VIEW.read_text("utf-8")

    assert "const rcManagementRating = window.renderRating" in source
    assert "if (!STATE.user?.operator_id)" in source
    assert "return rcManagementRating()" in source
    assert "window.renderRating = rcRatingEntry" in source


def test_operator_rating_has_mobile_layout_and_accessible_graphics() -> None:
    source = VIEW.read_text("utf-8")
    styles = STYLES.read_text("utf-8")

    assert 'role="progressbar"' in source
    assert 'role="img"' in source
    assert 'aria-label="Динамика личных баллов' in source
    assert "@media (max-width: 620px)" in styles
    assert "@media (max-width: 430px)" in styles
    assert ".rc-rival-lane { grid-template-columns: 1fr; }" in styles
    assert ".rc-insight-grid { grid-template-columns: 1fr; }" in styles


def test_bundles_contain_the_operator_rating_redesign() -> None:
    app_bundle = (ROOT / "js/app.js").read_text("utf-8")
    css_bundle = (ROOT / "css/styles.css").read_text("utf-8")

    assert "Operator rating v4: a focused competition dashboard" in app_bundle
    assert "window.renderRating = rcRatingEntry" in app_bundle
    assert "Operator rating v4 — focused rivalry dashboard" in css_bundle
    assert ".rc-hero-card" in css_bundle
