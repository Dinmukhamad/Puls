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
    monkeypatch.setattr(settings, "YANDEX_SPEECHKIT_API_KEY", SecretStr(""))
    monkeypatch.setattr(settings, "YANDEX_FOLDER_ID", "")
    monkeypatch.setattr(voice_tts, "yandex_home", {"url": None})
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


def yandex(monkeypatch):
    monkeypatch.setattr(settings, "YANDEX_SPEECHKIT_API_KEY", SecretStr("fixture-yandex-key"))


def yandex_stream(audio: bytes, parts: int = 2) -> bytes:
    """SpeechKit v3 answers with one JSON object per line, each carrying an audio chunk."""
    size = -(-len(audio) // parts)
    chunks = [audio[index:index + size] for index in range(0, len(audio), size)]
    return "\n".join(
        json.dumps({"result": {"audioChunk": {"data": base64.b64encode(chunk).decode()},
                               "textChunk": {"text": "…"}}})
        for chunk in chunks
    ).encode()


async def test_yandex_comes_first_and_hides_its_key(client, operator, monkeypatch):
    yandex(monkeypatch)
    google(monkeypatch)
    headers = auth(await login(client, operator.login))
    response = await client.get(BASE + "/speech/config", headers=headers)
    assert response.json()["default_provider"] == "yandex"
    assert response.json()["providers"][0] == {
        "id": "yandex", "label": "Yandex SpeechKit", "voice": "persona-v1",
    }
    assert "fixture-yandex-key" not in response.text


@pytest.mark.parametrize(
    ("persona", "voice", "role", "speed"),
    [
        ("calm", "alexander", None, 1.0),
        ("confused", "zahar", None, 0.88),
        ("hurried", "anton", None, 1.28),
        ("irritated", "kirill", "strict", 1.12),
    ],
)
async def test_yandex_gives_every_character_his_own_voice(persona, voice, role, speed, monkeypatch):
    yandex(monkeypatch)
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, content=yandex_stream(MP3))

    transport(monkeypatch, respond)
    result = await voice_tts.engine.synthesize("yandex", "SIM-карты нет. WhatsApp?", persona, 1)
    assert result.audio == MP3 and result.provider == "yandex"
    request = requests[0]
    assert str(request.url) == voice_tts.YANDEX_URL
    assert request.headers["Authorization"] == "Api-Key fixture-yandex-key"
    assert "x-folder-id" not in request.headers
    payload = json.loads(request.content)
    expected = [{"voice": voice}, *([{"role": role}] if role else []), {"speed": speed}]
    assert payload == {
        "text": "сим-карты нет. ватсап?",
        "hints": expected,
        "outputAudioSpec": {"containerAudio": {"containerAudioType": "MP3"}},
        "loudnessNormalizationType": "LUFS",
    }


async def test_yandex_kazakh_uses_the_kazakh_voice_and_folder_when_set(monkeypatch):
    yandex(monkeypatch)
    monkeypatch.setattr(settings, "YANDEX_FOLDER_ID", "b1gfolder")
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, content=yandex_stream(MP3, parts=3))

    transport(monkeypatch, respond)
    await voice_tts.engine.synthesize("yandex", voice_tts.PREVIEW_TEXT_KK, "hurried", 1, "kk")
    payload = json.loads(requests[0].content)
    assert payload["hints"] == [{"voice": "madi"}, {"speed": 1.25}]
    assert requests[0].headers["x-folder-id"] == "b1gfolder"
    # The same text in another language is another clip.
    await voice_tts.engine.synthesize("yandex", voice_tts.PREVIEW_TEXT_KK, "hurried", 1, "ru")
    assert len(requests) == 2


async def test_yandex_retries_without_a_role_the_voice_does_not_take(monkeypatch):
    yandex(monkeypatch)
    requests = []

    def respond(request):
        requests.append(json.loads(request.content)["hints"])
        if len(requests) == 1:
            return httpx.Response(400, json={"error": "role is not supported"})
        return httpx.Response(200, content=yandex_stream(MP3))

    transport(monkeypatch, respond)
    result = await voice_tts.engine.synthesize("yandex", "Сколько можно!", "irritated", 1)
    assert result.audio == MP3
    assert requests == [
        [{"voice": "kirill"}, {"role": "strict"}, {"speed": 1.12}],
        [{"voice": "kirill"}, {"speed": 1.12}],
    ]


@pytest.mark.parametrize(("status", "installations"), [(401, 2), (403, 2), (429, 1), (500, 1)])
async def test_yandex_errors_are_not_retried_and_hide_diagnostics(
    status, installations, monkeypatch
):
    yandex(monkeypatch)
    calls = []

    def respond(request):
        calls.append(str(request.url))
        return httpx.Response(status, text="fixture-yandex-key upstream details")

    transport(monkeypatch, respond)
    with pytest.raises(voice_tts.SpeechUnavailable) as error:
        await voice_tts.engine.synthesize("yandex", "Сколько можно!", "irritated", 1)
    # An unknown key is asked once at each installation; other errors end at once.
    assert calls == list(voice_tts.YANDEX_URLS[:installations])
    assert voice_tts.yandex_home["url"] is None
    assert "fixture" not in str(error.value) and "upstream" not in str(error.value)


async def test_a_kazakhstan_key_is_sent_to_its_installation_and_remembered(monkeypatch):
    yandex(monkeypatch)
    calls = []

    def respond(request):
        calls.append(str(request.url))
        if "yandexcloud.kz" not in str(request.url):
            return httpx.Response(401, json={"error": "unknown api key"})
        return httpx.Response(200, content=yandex_stream(MP3))

    transport(monkeypatch, respond)
    await voice_tts.engine.synthesize("yandex", "Первая реплика", "calm", 1)
    assert calls == list(voice_tts.YANDEX_URLS)
    assert voice_tts.yandex_home["url"] == "https://tts.api.ml.yandexcloud.kz/tts/v3/utteranceSynthesis"
    await voice_tts.engine.synthesize("yandex", "Вторая реплика", "calm", 1)
    assert calls[2:] == [voice_tts.YANDEX_URLS[1]]


async def test_a_refused_character_voice_falls_back_to_a_common_one(monkeypatch):
    yandex(monkeypatch)
    hints = []

    def respond(request):
        hints.append(json.loads(request.content)["hints"])
        if hints[-1][0]["voice"] != "ermil":
            return httpx.Response(400, json={"error": "unknown voice"})
        return httpx.Response(200, content=yandex_stream(MP3))

    transport(monkeypatch, respond)
    await voice_tts.engine.synthesize("yandex", "Сколько можно!", "irritated", 1)
    assert hints == [
        [{"voice": "kirill"}, {"role": "strict"}, {"speed": 1.12}],
        [{"voice": "kirill"}, {"speed": 1.12}],
        [{"voice": "ermil"}, {"speed": 1.12}],
    ]


@pytest.mark.parametrize(
    "body",
    [b"not json", json.dumps({"result": {}}).encode(), yandex_stream(b"not-mp3")],
)
async def test_yandex_malformed_audio_is_unavailable(body, monkeypatch):
    yandex(monkeypatch)
    transport(monkeypatch, lambda _: httpx.Response(200, content=body))
    with pytest.raises(voice_tts.SpeechUnavailable):
        await voice_tts.engine.synthesize("yandex", "Текст", "calm", 1)
    assert not voice_tts.engine.cache


async def test_google_has_no_kazakh_voice_and_azure_uses_a_kazakh_one(monkeypatch):
    google(monkeypatch)
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, content=MP3)

    transport(monkeypatch, respond)
    with pytest.raises(voice_tts.SpeechUnavailable):
        await voice_tts.engine.synthesize("google", voice_tts.PREVIEW_TEXT_KK, "calm", 1, "kk")
    assert not calls
    monkeypatch.setattr(settings, "AZURE_SPEECH_KEY", SecretStr("fixture-azure-key"))
    monkeypatch.setattr(settings, "AZURE_SPEECH_REGION", "westeurope")
    await voice_tts.engine.synthesize("azure", voice_tts.PREVIEW_TEXT_KK, "calm", 1, "kk")
    ssml = calls[0].content.decode()
    assert 'xml:lang="kk-KZ"' in ssml and voice_tts.AZURE_KK_VOICE in ssml


async def test_turn_speech_follows_the_call_language(client, session, operator, monkeypatch):
    yandex(monkeypatch)
    calls = []

    async def audio(provider, text, persona):
        calls.append((provider.language, text, persona))
        return MP3

    monkeypatch.setattr(voice_tts, "_request_audio", audio)
    headers = auth(await login(client, operator.login))
    started = (await client.post(
        BASE + "/start", headers=headers,
        json={"scenario_key": "phone_change", "persona": "confused", "language": "kk"},
    )).json()
    response = await client.post(
        BASE + f"/attempts/{started['id']}/speech", headers=headers,
        json={"provider": "yandex", "turn": 0},
    )
    assert response.status_code == 200, response.text
    assert calls == [("kk", started["transcript"][0]["text"], "confused")]
    response = await client.post(
        BASE + "/speech/preview", headers=headers,
        json={"provider": "yandex", "persona": "calm", "language": "kk"},
    )
    assert response.status_code == 200
    assert calls[-1] == ("kk", voice_tts.PREVIEW_TEXT_KK, "calm")
