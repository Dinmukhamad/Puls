from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_learning_world_and_sapar_sources_are_bundled():
    app_bundle = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
    api_bundle = (ROOT / "js" / "api.js").read_text(encoding="utf-8")
    styles = (ROOT / "css" / "styles.css").read_text(encoding="utf-8")
    assert "renderLearningWorldMap" in app_bundle
    assert "renderLearningWorldRoute" in app_bundle
    assert "renderSaparMissionScreen" in app_bundle
    assert "getMissionWorlds" in api_bundle
    assert ".learning-world-grid" in styles
    assert ".sapar-consent" in styles


def test_sapar_simulator_has_no_external_links_or_real_inputs():
    source = (ROOT / "js" / "src" / "views" / "missions" / "82-sapar-mission.view.js").read_text(encoding="utf-8")
    assert "https://" not in source
    assert "window.open" not in source
    assert 'type="file"' not in source
    assert "confirm_consent" in source
    assert "provider_code" in source
