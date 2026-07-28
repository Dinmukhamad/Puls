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


def test_mission_map_recovers_from_stale_navigation_and_supports_replay():
    mission_source = (
        ROOT / "js" / "src" / "views" / "missions" / "80-missions.view.js"
    ).read_text(encoding="utf-8")
    world_source = (
        ROOT / "js" / "src" / "views" / "missions" / "80-world-map.view.js"
    ).read_text(encoding="utf-8")

    assert "resetMissionNavigation" in mission_source
    assert "sessionStorage.removeItem('puls-mission-world')" in mission_source
    assert "const disabled = mission.status === 'locked'" in mission_source
    assert "mission.can_replay" in mission_source
    assert "Пройти ещё раз" in mission_source
    assert "await api.getMissions()" in mission_source
    assert world_source.index("await api.getMissionWorld(code)") < world_source.index(
        "sessionStorage.setItem('puls-mission-world', code)"
    )
