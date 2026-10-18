"""Cloud speech boundaries use mocked transports; no credentials or paid calls."""

import asyncio
import base64
import json
import time

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings, settings
from app.models.voice_training import VoiceTrainingAttempt
from app.services import voice_tts
from tests.conftest import auth, login, make_user

pytestmark = pytest.mark.asyncio
BASE = "/api/v1/learning/voice"
MP3 = b"ID3\x04\x00\x00fixture-audio"
HTTP_CLIENT = httpx.AsyncClient


@pytest.fixture(autouse=True)
def clean_speech(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_TTS_API_KEY", SecretStr(""))
    monkeypatch.setattr(settings, "AZURE_SPEECH_KEY", SecretStr(""))
    monkeypatch.setattr(settings, "AZURE_SPEECH_REGION", "")
    monkeypatch.setattr(voice_tts, "engine", voice_tts.SpeechEngine())


def google(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_TTS_API_KEY", SecretStr("fixture-google-key"))


def transport(monkeypatch, handler):
    monkeypatch.setattr(
        voice_tts.httpx,
        "AsyncClient",
        lambda **kwargs: HTTP_CLIENT(transport=httpx.MockTransport(handler), **kwargs),
    )


async def test_configuration_authentication_and_secret_free_defaults(client, operator, monkeypatch):
    response = await client.get(BASE + "/speech/config")
    assert response.status_code == 401
    assert response.headers["cache-control"] == "private, no-store"
    headers = auth(await login(client, operator.login))
    response = await client.get(BASE + "/speech/config", headers=headers)
    assert response.json() == {"default_provider": "browser", "providers": []}
    assert response.headers["cache-control"] == "private, no-store"
    google(monkeypatch)
    monkeypatch.setattr(settings, "AZURE_SPEECH_KEY", SecretStr("fixture-azure-key"))
    monkeypatch.setattr(settings, "AZURE_SPEECH_REGION", "westeurope")
    response = await client.get(BASE + "/speech/config", headers=headers)
    assert response.json() == {
        "default_provider": "google",
        "providers": [
            {"id": "google", "label": "Google Cloud", "voice": "ru-RU-Chirp3-HD-Charon"},
            {"id": "azure", "label": "Azure Speech", "voice": "ru-RU-DmitryNeural"},
        ],
    }
    assert "key" not in response.text and "westeurope" not in response.text
    monkeypatch.setattr(settings, "GOOGLE_TTS_API_KEY", SecretStr(""))
    assert voice_tts.configuration()["default_provider"] == "azure"


async def test_preview_is_fixed_and_extra_text_is_rejected(client, operator, monkeypatch):
    google(monkeypatch)
    calls = []

    async def audio(provider, text, persona):
        calls.append((provider.id, text, persona))
        return MP3

    monkeypatch.setattr(voice_tts, "_request_audio", audio)
    headers = auth(await login(client, operator.login))
    response = await client.post(
        BASE + "/speech/preview", headers=headers,
        json={"provider": "google", "persona": "hurried", "text": "Посторонний текст"},
    )
    assert response.status_code == 422
    assert response.headers["cache-control"] == "private, no-store"
    assert not calls
    response = await client.post(
        BASE + "/speech/preview", headers=headers,
        json={"provider": "google", "persona": "hurried"},
    )
    assert response.status_code == 200
    assert calls == [("google", voice_tts.PREVIEW_TEXT, "hurried")]
    assert response.json() == {
        "audio_base64": base64.b64encode(MP3).decode(),
        "mime_type": "audio/mpeg", "provider": "google", "voice": settings.GOOGLE_TTS_VOICE,
    }
    assert response.headers["cache-control"] == "private, no-store"


async def test_saved_driver_turn_ownership_and_no_operator_text(
    client, session, operator, monkeypatch
):
    google(monkeypatch)
    calls = []

    async def audio(provider, text, persona):
        calls.append(text)
        return MP3

    monkeypatch.setattr(voice_tts, "_request_audio", audio)
    headers = auth(await login(client, operator.login))
    started = await client.post(
        BASE + "/start", headers=headers,
        json={"scenario_key": "phone_change", "persona": "calm"},
    )
    attempt = started.json()
    row = await session.get(VoiceTrainingAttempt, attempt["id"])
    row.transcript = [
        *row.transcript,
        {"role": "operator", "turn": 1, "text": "Личная информация оператора"},
    ]
    await session.commit()
    endpoint = BASE + f"/attempts/{attempt['id']}/speech"
    other = await make_user(session, login="voice-speech-other")
    foreign = auth(await login(client, other.login))
    for request_headers, body, expected in [
        ({}, {"provider": "google", "turn": 0}, 401),
        (foreign, {"provider": "google", "turn": 0}, 404),
        (headers, {"provider": "google", "turn": 1}, 404),
        (headers, {"provider": "google", "turn": 99}, 404),
        (headers, {"provider": "google", "turn": 0, "text": "Произвольный"}, 422),
    ]:
        response = await client.post(endpoint, headers=request_headers, json=body)
        assert response.status_code == expected, response.text
        assert response.headers["cache-control"] == "private, no-store"
    assert not calls
    response = await client.post(endpoint, headers=headers, json={"provider": "google", "turn": 0})
    assert response.status_code == 200
    assert calls == [attempt["transcript"][0]["text"]]


async def test_unconfigured_provider_returns_safe_retryable_error(client, operator):
    headers = auth(await login(client, operator.login))
    response = await client.post(
        BASE + "/speech/preview", headers=headers, json={"provider": "google"}
    )
    assert response.status_code == 503
    assert response.json()["code"] == "voice_speech_unavailable"
    assert response.headers["cache-control"] == "private, no-store"


async def test_google_header_payload_and_pronunciation_do_not_modify_source(monkeypatch):
    google(monkeypatch)
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"audioContent": base64.b64encode(MP3).decode()})

    transport(monkeypatch, respond)
    source = "SIM-карты нет. WhatsApp или OKTEL?"
    result = await voice_tts.engine.synthesize("google", source, "irritated", 1)
    assert result.audio == MP3
    request = requests[0]
    assert str(request.url) == "https://texttospeech.googleapis.com/v1/text:synthesize"
    assert request.headers["x-goog-api-key"] == "fixture-google-key"
    assert not request.url.query
    payload = json.loads(request.content)
    assert payload == {
        "input": {"text": "сим-карты нет. ватсап или октел?"},
        "voice": {"languageCode": "ru-RU", "name": "ru-RU-Chirp3-HD-Charon"},
        "audioConfig": {"audioEncoding": "MP3"},
    }
    assert source == "SIM-карты нет. WhatsApp или OKTEL?"


async def test_azure_fixed_endpoint_escaped_ssml_and_supported_tempo(monkeypatch):
    monkeypatch.setattr(settings, "AZURE_SPEECH_KEY", SecretStr("fixture-azure-key"))
    monkeypatch.setattr(settings, "AZURE_SPEECH_REGION", "westeurope")
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, content=MP3)

    transport(monkeypatch, respond)
    await voice_tts.engine.synthesize("azure", "Номер <новый> & старый", "hurried", 1)
    request = requests[0]
    assert str(request.url) == "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1"
    assert request.headers["Ocp-Apim-Subscription-Key"] == "fixture-azure-key"
    assert request.headers["X-Microsoft-OutputFormat"] == "audio-24khz-48kbitrate-mono-mp3"
    ssml = request.content.decode()
    assert 'rate="+6%"' in ssml
    assert "&lt;новый&gt; &amp; старый" in ssml
    assert "express-as" not in ssml


@pytest.mark.parametrize(
    "region", ["https://evil.test", "eastus/../../", "eastus.evil.test", "x@evil"]
)
async def test_azure_region_cannot_inject_endpoint(region, monkeypatch):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, AZURE_SPEECH_REGION=region)
    monkeypatch.setattr(settings, "AZURE_SPEECH_KEY", SecretStr("fixture-azure-key"))
    monkeypatch.setattr(settings, "AZURE_SPEECH_REGION", region)
    assert not voice_tts.providers()
    with pytest.raises(voice_tts.SpeechUnavailable):
        await voice_tts.engine.synthesize("azure", "Текст", "calm", 1)


@pytest.mark.parametrize("status", [301, 401, 403, 429, 500])
async def test_upstream_errors_hide_diagnostics_and_credentials(status, monkeypatch):
    google(monkeypatch)
    transport(monkeypatch, lambda _: httpx.Response(
        status, json={"error": "private upstream body"}
    ))
    with pytest.raises(voice_tts.SpeechUnavailable) as error:
        await voice_tts.engine.synthesize("google", "Текст", "calm", 1)
    assert "private" not in str(error.value) and "fixture-google-key" not in str(error.value)
    assert not voice_tts.engine.cache
    assert voice_tts.engine.pending == 0


@pytest.mark.parametrize("payload", [
    {}, {"audioContent": "!invalid!"}, {"audioContent": ""},
    {"audioContent": base64.b64encode(b"<html>not mp3</html>").decode()},
])
async def test_invalid_google_audio_is_not_cached(payload, monkeypatch):
    google(monkeypatch)
    transport(monkeypatch, lambda _: httpx.Response(200, json=payload))
    with pytest.raises(voice_tts.SpeechUnavailable):
        await voice_tts.engine.synthesize("google", "Текст", "calm", 1)
    assert not voice_tts.engine.cache


async def test_provider_timeout_is_safe_and_releases_slot(monkeypatch):
    google(monkeypatch)

    def fail(request):
        raise httpx.ReadTimeout("sensitive provider diagnostics", request=request)

    transport(monkeypatch, fail)
    with pytest.raises(voice_tts.SpeechUnavailable) as error:
        await voice_tts.engine.synthesize("google", "Текст", "calm", 1)
    assert "sensitive" not in str(error.value)
    assert voice_tts.engine.pending == 0 and voice_tts.engine.semaphore._value == 2


async def test_audio_and_response_size_are_bounded(monkeypatch):
    google(monkeypatch)
    audio = b"a" * (voice_tts.MAX_AUDIO_BYTES + 1)
    transport(monkeypatch, lambda _: httpx.Response(
        200, json={"audioContent": base64.b64encode(audio).decode()}
    ))
    with pytest.raises(voice_tts.SpeechUnavailable):
        await voice_tts.engine.synthesize("google", "Текст", "calm", 1)
    assert not voice_tts.engine.cache
    transport(monkeypatch, lambda _: httpx.Response(
        200, content=b"x" * (voice_tts.MAX_RESPONSE_BYTES + 1)
    ))
    with pytest.raises(voice_tts.SpeechUnavailable):
        await voice_tts.engine.synthesize("google", "Другой текст", "calm", 1)


async def test_cache_reuses_normalized_text_across_accounts_but_tracks_voice(monkeypatch):
    google(monkeypatch)
    calls = []

    async def audio(provider, text, persona):
        calls.append((provider.voice, text, persona))
        return MP3

    monkeypatch.setattr(voice_tts, "_request_audio", audio)
    for user in (1, 2):
        await voice_tts.engine.synthesize("google", " WhatsApp  ", "calm", user)
    assert len(calls) == 1 and calls[0][1] == "ватсап"
    await voice_tts.engine.synthesize("google", "WhatsApp", "hurried", 1)
    monkeypatch.setattr(settings, "GOOGLE_TTS_VOICE", "ru-RU-Chirp3-HD-Puck")
    await voice_tts.engine.synthesize("google", "WhatsApp", "calm", 1)
    assert len(calls) == 3


async def test_cache_lru_and_account_memory_are_bounded(monkeypatch):
    google(monkeypatch)
    monkeypatch.setattr(voice_tts, "MAX_CACHE_BYTES", len(MP3) * 2)

    async def audio(*_):
        return MP3

    monkeypatch.setattr(voice_tts, "_request_audio", audio)
    for text in ("Один", "Два", "Три"):
        await voice_tts.engine.synthesize("google", text, "calm", 1)
    assert voice_tts.engine.cache_bytes == len(MP3) * 2
    assert len(voice_tts.engine.cache) == 2
    assert not any(key[2] == "Один" for key in voice_tts.engine.cache)
    for account in range(voice_tts.MAX_USERS + 5):
        voice_tts.engine._throttle(account)
    assert len(voice_tts.engine.accounts) == voice_tts.MAX_USERS


async def test_account_rate_limit_returns_429_and_later_expires(client, operator, monkeypatch):
    google(monkeypatch)

    async def audio(*_):
        return MP3

    monkeypatch.setattr(voice_tts, "_request_audio", audio)
    headers = auth(await login(client, operator.login))
    for _ in range(voice_tts.USER_REQUESTS_PER_MINUTE):
        response = await client.post(
            BASE + "/speech/preview", headers=headers, json={"provider": "google"}
        )
        assert response.status_code == 200
    response = await client.post(
        BASE + "/speech/preview", headers=headers, json={"provider": "google"}
    )
    assert response.status_code == 429
    assert response.json()["code"] == "voice_speech_rate_limited"
    assert response.headers["retry-after"] == "60"
    assert response.headers["cache-control"] == "private, no-store"
    for index in range(len(voice_tts.engine.accounts[operator.id])):
        voice_tts.engine.accounts[operator.id][index] = time.monotonic() - 61
    response = await client.post(
        BASE + "/speech/preview", headers=headers, json={"provider": "google"}
    )
    assert response.status_code == 200


async def test_concurrency_queue_and_cancellation_release_all_slots(monkeypatch):
    google(monkeypatch)
    entered = asyncio.Event()
    release = asyncio.Event()
    active = 0
    peak = 0

    async def audio(*_):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == 2:
            entered.set()
        try:
            await release.wait()
            return MP3
        finally:
            active -= 1

    monkeypatch.setattr(voice_tts, "_request_audio", audio)
    tasks = [asyncio.create_task(
        voice_tts.engine.synthesize("google", f"Реплика {index}", "calm", index)
    ) for index in range(voice_tts.MAX_PENDING)]
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        assert voice_tts.engine.pending == voice_tts.MAX_PENDING
        with pytest.raises(voice_tts.SpeechUnavailable):
            await voice_tts.engine.synthesize("google", "Лишняя реплика", "calm", 99)
        assert peak == 2
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    assert voice_tts.engine.pending == 0 and voice_tts.engine.semaphore._value == 2
