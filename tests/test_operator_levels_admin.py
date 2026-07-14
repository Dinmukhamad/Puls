from __future__ import annotations


def test_admin_levels_include_clear_progression_metadata(client):
    response = client.get("/api/admin/operator-levels")

    assert response.status_code == 200, response.text
    levels = response.json()
    assert levels
    assert [level["stage_number"] for level in levels] == list(range(1, len(levels) + 1))

    for level in levels:
        assert level["rules_count"] == len(level["rules"])
        assert level["reward_label"]
        for rule in level["rules"]:
            assert rule["metric_label"]
            assert rule["operator_label"]
            assert rule["condition_text"]
            assert ">=" not in rule["condition_text"]
            assert "<=" not in rule["condition_text"]


def test_admin_level_rule_rejects_unknown_metric(client):
    levels = client.get("/api/admin/operator-levels").json()
    response = client.post(
        f"/api/admin/operator-levels/{levels[0]['id']}/rules",
        json={
            "metric_code": "mystery_score",
            "operator": "gte",
            "value_min": 10,
            "is_required": True,
        },
    )

    assert response.status_code == 422
