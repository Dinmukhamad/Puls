from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_photo_control_frontend_accessibility_and_assets():
    view = (ROOT / "js/src/views/missions/81-mission-photo-control.view.js").read_text("utf-8")
    css = (ROOT / "css/src/views/61-mission-photo-control.css").read_text("utf-8")
    assert 'role="dialog"' in view
    assert 'aria-modal="true"' in view
    assert "trapMissionPreviewFocus" in view
    assert "aria-label" in view
    assert "aria-live" in view
    assert "@media(max-width:767px)" in css
    assert "prefers-reduced-motion" in css
    for filename in (
        "front.webp", "left.webp", "rear.webp", "right.webp",
        "front-seats.webp", "rear-seats.webp", "trunk-open.webp",
    ):
        path = ROOT / "img/missions/photo-control/car" / filename
        assert path.exists()
        assert path.stat().st_size <= 250_000


def test_training_license_is_html_and_clearly_invalid():
    view = (ROOT / "js/src/views/missions/81-mission-photo-control.view.js").read_text("utf-8")
    assert "УЧЕБНЫЙ ОБРАЗЕЦ · НЕ ДОКУМЕНТ" in view
    assert "license_identity" in view
    assert "DEMO-0002" in view
    assert 'type="file"' not in view.lower()
