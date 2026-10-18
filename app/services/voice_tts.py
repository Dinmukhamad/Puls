"""Bounded cloud synthesis of server-owned driver utterances, never learner audio.

Providers receive only the fixed preview or saved driver text. Credentials stay
in server settings; upstream response bodies and headers never enter errors/logs.
The in-process cache is temporary and contains generated exercise audio only.
"""

import asyncio
import base64
import binascii
import json
import re
import time
from collections import OrderedDict, deque
from contextlib import aclosing
from dataclasses import dataclass, replace
from typing import Literal
from xml.sax.saxutils import escape, quoteattr

import httpx

from app.core.config import settings
from app.core.errors import DomainError

ProviderId = Literal["yandex", "google", "azure"]
Persona = Literal["calm", "confused", "hurried", "irritated"]
Language = Literal["ru", "kk"]
PREVIEW_TEXT = "Здравствуйте. Мне нужно поменять номер телефона. Подскажите, как это сделать?"
PREVIEW_TEXT_KK = "Сәлеметсіз бе. Маған телефон нөмірін ауыстыру керек. Мұны қалай істеуге болады?"
PREVIEWS = {"ru": PREVIEW_TEXT, "kk": PREVIEW_TEXT_KK}
#: SpeechKit runs in two installations with their own addresses: the global one and the
#: Kazakhstan one (kz.console.yandex.cloud). A key belongs to one of them; the first that
#: accepts it is remembered for the process.
YANDEX_URLS = (
    "https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis",
    "https://tts.api.ml.yandexcloud.kz/tts/v3/utteranceSynthesis",
)
YANDEX_URL = YANDEX_URLS[0]
#: A voice every installation has, asked last when the character's own voice is refused.
YANDEX_FALLBACK_VOICE = {"ru": "ermil", "kk": "madi"}
#: Every character is a different man: his own voice, manner and tempo. Kazakh has one
#: male voice, so there the characters differ by tempo, wording and the line's sound.
YANDEX_VOICES = {
    "ru": {
        "calm": ("alexander", None, 1.0),
        "confused": ("zahar", None, 0.88),
        "hurried": ("anton", None, 1.28),
        "irritated": ("kirill", "strict", 1.12),
    },
    "kk": {
        "calm": ("madi", None, 1.0),
        "confused": ("madi", None, 0.88),
        "hurried": ("madi", None, 1.25),
        "irritated": ("madi", None, 1.12),
    },
}
AZURE_KK_VOICE = "kk-KZ-DauletNeural"
MAX_AUDIO_BYTES = 512 * 1024
MAX_CACHE_BYTES = 8 * 1024 * 1024
MAX_RESPONSE_BYTES = MAX_AUDIO_BYTES * 4 // 3 + 4096
MAX_USERS = 1024
USER_REQUESTS_PER_MINUTE = 12
REQUEST_TIMEOUT = 15
QUEUE_TIMEOUT = 2
MAX_PENDING = 8  # two active requests and at most six waiters


class SpeechUnavailable(DomainError):
    status_code = 503
    code = "voice_speech_unavailable"

    def __init__(self):
        super().__init__(
            "Облачная озвучка сейчас недоступна. Повторите позже или выберите голос браузера."
        )


class SpeechRateLimited(DomainError):
    status_code = 429
    code = "voice_speech_rate_limited"

    def __init__(self):
        super().__init__("Слишком много запросов озвучки. Подождите минуту и повторите.")


@dataclass(frozen=True)
class Provider:
    id: ProviderId
    label: str
    voice: str
    language: Language = "ru"


@dataclass(frozen=True)
class SpeechAudio:
    audio: bytes
    provider: ProviderId
    voice: str

    def data(self):
        return {
            "audio_base64": base64.b64encode(self.audio).decode("ascii"),
            "mime_type": "audio/mpeg",
            "provider": self.provider,
            "voice": self.voice,
        }


def providers() -> list[Provider]:
    result = []
    if settings.YANDEX_SPEECHKIT_API_KEY.get_secret_value().strip():
        result.append(Provider("yandex", "Yandex SpeechKit", "persona-v1"))
    if settings.GOOGLE_TTS_API_KEY.get_secret_value().strip():
        result.append(Provider("google", "Google Cloud", settings.GOOGLE_TTS_VOICE))
    if (
        settings.AZURE_SPEECH_KEY.get_secret_value().strip()
        and settings.AZURE_SPEECH_REGION
        and re.fullmatch(r"[a-z][a-z0-9]{1,40}", settings.AZURE_SPEECH_REGION)
    ):
        result.append(Provider("azure", "Azure Speech", settings.AZURE_TTS_VOICE))
    return result


def configuration():
    available = providers()
    return {
        "default_provider": available[0].id if available else "browser",
        "providers": [
            {"id": provider.id, "label": provider.label, "voice": provider.voice}
            for provider in available
        ],
    }


def normalize_text(text: str) -> str:
    """Pronunciation adjustments apply only to synthesis, never to the transcript."""
    text = re.sub(r"\bSIM\b", "сим", text, flags=re.IGNORECASE)
    text = re.sub(r"\bWhats\s*App\b", "ватсап", text, flags=re.IGNORECASE)
    text = re.sub(r"\bOKTEL\b", "октел", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


yandex_home: dict[str, str | None] = {"url": None}


def _yandex_hints(provider: Provider, persona: Persona) -> list[list[dict]]:
    """The hints to try in order: with the persona's role, without it, then a common voice."""
    voice, role, speed = YANDEX_VOICES[provider.language][persona]
    base = [{"voice": voice}, {"speed": speed}]
    attempts = [[base[0], {"role": role}, base[1]], base] if role else [base]
    fallback = YANDEX_FALLBACK_VOICE[provider.language]
    if fallback != voice:
        attempts.append([{"voice": fallback}, {"speed": speed}])
    return attempts


def _yandex_audio(body: bytes) -> bytes:
    """SpeechKit v3 streams JSON objects, each with a base64 audio chunk."""
    text = body.decode("utf-8")
    try:
        parsed = json.loads(text)
        items = parsed if isinstance(parsed, list) else [parsed]
    except ValueError:
        items = [json.loads(line) for line in text.splitlines() if line.strip()]
    audio = bytearray()
    for item in items:
        data = item["result"]["audioChunk"]["data"]
        audio.extend(base64.b64decode(data, validate=True))
    return bytes(audio)


async def _post(url: str, headers: dict, limit: int, **arguments) -> tuple[int, bytes]:
    """One bounded request; the status and body never reach errors or logs."""
    chunks = bytearray()
    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT, follow_redirects=False
    ) as client, client.stream("POST", url, headers=headers, **arguments) as response:
        if response.status_code != 200:
            return response.status_code, b""
        async with aclosing(response.aiter_bytes(chunk_size=64 * 1024)) as stream:
            async for chunk in stream:
                chunks.extend(chunk)
                if len(chunks) > limit:
                    raise SpeechUnavailable()
    return 200, bytes(chunks)


def _checked_mp3(audio: bytes) -> bytes:
    mp3 = audio.startswith(b"ID3") or (
        len(audio) >= 2 and audio[0] == 0xFF and audio[1] & 0xE0 == 0xE0
    )
    if not mp3 or len(audio) > MAX_AUDIO_BYTES:
        raise SpeechUnavailable()
    return audio


async def _request_yandex(provider: Provider, text: str, persona: Persona) -> bytes:
    headers = {"Authorization": f"Api-Key {settings.YANDEX_SPEECHKIT_API_KEY.get_secret_value()}"}
    if settings.YANDEX_FOLDER_ID:
        headers["x-folder-id"] = settings.YANDEX_FOLDER_ID
    home = yandex_home["url"]
    urls = [home] if home else list(YANDEX_URLS)
    for url in urls:
        # A voice that does not take the persona's role is asked again without it.
        for hints in _yandex_hints(provider, persona):
            payload = {
                "text": text,
                "hints": hints,
                "outputAudioSpec": {"containerAudio": {"containerAudioType": "MP3"}},
                "loudnessNormalizationType": "LUFS",
            }
            status, body = await _post(url, headers, MAX_RESPONSE_BYTES * 2, json=payload)
            if status == 200:
                audio = _checked_mp3(_yandex_audio(body))
                yandex_home["url"] = url
                return audio
            if status != 400:
                break
        # Only a key the installation does not know is tried at the other one.
        if status not in (401, 403):
            break
    raise SpeechUnavailable()


async def _request_audio(provider: Provider, text: str, persona: Persona) -> bytes:
    try:
        if provider.id == "yandex":
            return await _request_yandex(provider, text, persona)
        if provider.id == "google":
            # Chirp 3 HD has no Kazakh voice here; the page then uses its own.
            if provider.language != "ru":
                raise SpeechUnavailable()
            # Chirp 3 HD uses its natural prosody; unsupported rate/pitch/style fields
            # are deliberately omitted. Persona-specific wording is already saved.
            status, body = await _post(
                "https://texttospeech.googleapis.com/v1/text:synthesize",
                {"x-goog-api-key": settings.GOOGLE_TTS_API_KEY.get_secret_value()},
                MAX_RESPONSE_BYTES,
                json={
                    "input": {"text": text},
                    "voice": {"languageCode": "ru-RU", "name": provider.voice},
                    "audioConfig": {"audioEncoding": "MP3"},
                },
            )
            if status != 200:
                raise SpeechUnavailable()
            # Read only the documented audio field. No provider diagnostics leak.
            payload = httpx.Response(200, content=body).json()
            return _checked_mp3(base64.b64decode(payload["audioContent"], validate=True))
        # The region is validated independently of Settings too, so constructing
        # this hostname can never redirect a credential to an arbitrary server.
        region = settings.AZURE_SPEECH_REGION
        if not re.fullmatch(r"[a-z][a-z0-9]{1,40}", region):
            raise SpeechUnavailable()
        rate = {"calm": "-2%", "confused": "-6%", "hurried": "+6%", "irritated": "+2%"}[persona]
        lang, voice = (
            ("kk-KZ", AZURE_KK_VOICE) if provider.language == "kk" else ("ru-RU", provider.voice)
        )
        ssml = (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            f'xml:lang="{lang}"><voice name={quoteattr(voice)}>'
            f'<prosody rate="{rate}">{escape(text)}</prosody></voice></speak>'
        )
        status, body = await _post(
            f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
            {
                "Ocp-Apim-Subscription-Key": settings.AZURE_SPEECH_KEY.get_secret_value(),
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            },
            MAX_RESPONSE_BYTES,
            content=ssml.encode("utf-8"),
        )
        if status != 200:
            raise SpeechUnavailable()
        return _checked_mp3(body)
    except (httpx.HTTPError, ValueError, KeyError, TypeError, binascii.Error):
        raise SpeechUnavailable() from None


class SpeechEngine:
    """One process: bounded LRU, account throttling, and bounded outbound work."""

    def __init__(self):
        self.cache: OrderedDict[tuple, bytes] = OrderedDict()
        self.cache_bytes = 0
        self.accounts: OrderedDict[int, deque[float]] = OrderedDict()
        self.semaphore = asyncio.Semaphore(2)
        self.pending = 0

    def _throttle(self, user_id: int):
        now = time.monotonic()
        timestamps = self.accounts.pop(user_id, deque())
        while timestamps and timestamps[0] <= now - 60:
            timestamps.popleft()
        self.accounts[user_id] = timestamps
        while len(self.accounts) > MAX_USERS:
            self.accounts.popitem(last=False)
        if len(timestamps) >= USER_REQUESTS_PER_MINUTE:
            raise SpeechRateLimited()
        timestamps.append(now)

    def _remember(self, key: tuple, audio: bytes):
        previous = self.cache.pop(key, None)
        if previous is not None:
            self.cache_bytes -= len(previous)
        self.cache[key] = audio
        self.cache_bytes += len(audio)
        while self.cache_bytes > MAX_CACHE_BYTES:
            _, evicted = self.cache.popitem(last=False)
            self.cache_bytes -= len(evicted)

    async def synthesize(
        self, provider_id: ProviderId, text: str, persona: Persona, user_id: int,
        language: Language = "ru",
    ) -> SpeechAudio:
        provider = next((item for item in providers() if item.id == provider_id), None)
        if provider is None:
            raise SpeechUnavailable()
        provider = replace(provider, language=language)
        text = normalize_text(text)
        if not text or len(text.encode("utf-8")) > 4500:
            raise SpeechUnavailable()
        self._throttle(user_id)
        key = (provider.id, provider.voice, text, persona, language)
        if key in self.cache:
            self.cache.move_to_end(key)
            return SpeechAudio(self.cache[key], provider.id, provider.voice)
        if self.pending >= MAX_PENDING:
            raise SpeechUnavailable()
        self.pending += 1
        acquired = False
        try:
            await asyncio.wait_for(self.semaphore.acquire(), timeout=QUEUE_TIMEOUT)
            acquired = True
            # A matching request may have filled the cache while we waited.
            audio = self.cache.get(key)
            if audio is None:
                async with asyncio.timeout(REQUEST_TIMEOUT):
                    audio = await _request_audio(provider, text, persona)
                self._remember(key, audio)
            return SpeechAudio(audio, provider.id, provider.voice)
        except TimeoutError:
            raise SpeechUnavailable() from None
        finally:
            self.pending -= 1
            if acquired:
                self.semaphore.release()


engine = SpeechEngine()
