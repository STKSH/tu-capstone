"""
Mock STT worker for the local dev scaffold.
CORS enabled, listens on PORT env var.
Text files are served only from the bundled texts/ directory.
"""

import asyncio
import json
import logging
import os
import random
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import httpx
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stt-mock")

SERVICE_NAME = "agent-worker"
SERVICE_VERSION = "dev-scaffold"
TEXT_DIR = Path(__file__).parent / "texts"
DEFAULT_CHUNK_DELAY = 0.1
DEFAULT_WORDS_PER_CHUNK = 15
AUDIO_BYTES_PER_SEGMENT = 32000
LOCAL_DEV_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
DEFAULT_FALLBACK_TEXT = "이것은 목업 음성 인식 서버의 기본 텍스트입니다."
UNSAFE_BUNDLED_TEXT_MARKERS = (
    ".mw-parser-output",
    "{{",
    "&nbsp;",
    "이 문서의 전체 내용은 출처 가 분명하지 않습니다",
    "[출처 필요]",
)
UNSAFE_BUNDLED_TEXT_SCAN_LIMIT = 2048

OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OPENROUTER_MODEL = "openrouter/free"
MAX_CHAT_HISTORY_MESSAGES = 20
MAX_TRANSCRIPT_CHARS = 12000
MAX_QUESTION_CHARS = 2000
MAX_MESSAGE_CHARS = 4000


class LiveChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class LiveChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    transcript: str = Field(default="", max_length=MAX_TRANSCRIPT_CHARS)
    messages: list[LiveChatMessage] = Field(default_factory=list, max_length=MAX_CHAT_HISTORY_MESSAGES)


class LiveChatResponse(BaseModel):
    answer: str
    grounding: Literal["transcript_only", "transcript_and_general_knowledge", "general_knowledge"]
    model: str


def bounded_text(value: str, max_chars: int) -> str:
    text = (value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def build_grounding(transcript: str) -> str:
    if transcript.strip():
        return "transcript_and_general_knowledge"
    return "general_knowledge"




def provider_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
        message = payload.get("error", {}).get("message")
        if isinstance(message, str) and message.strip():
            safe_message = message.split(". Manage it", 1)[0].strip()
            safe_message = re.sub(r"https?://\S+", "[redacted-url]", safe_message)
            return safe_message
    except ValueError:
        pass
    return "OpenRouter chat request failed"




def sse_event(payload: dict, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def get_live_chat_runtime(x_internal_chat_secret: str | None) -> tuple[str, str]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    model = os.environ.get("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL).strip() or DEFAULT_OPENROUTER_MODEL
    expected_secret = os.environ.get("LIVE_CHAT_WORKER_SECRET", "").strip()

    if not expected_secret:
        raise HTTPException(status_code=500, detail="LIVE_CHAT_WORKER_SECRET is missing")

    if x_internal_chat_secret != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid internal chat secret")

    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is missing")

    return api_key, model


def build_live_chat_messages(request: LiveChatRequest) -> list[dict[str, str]]:
    transcript = bounded_text(request.transcript, MAX_TRANSCRIPT_CHARS)
    transcript_block = transcript if transcript else "현재 제공된 강의 전사가 없습니다."

    system_prompt = (
        "당신은 실시간 강의 전사와 동기화된 학습 보조 AI입니다.\n"
        "아래 강의 전사를 최우선 근거로 사용하세요. 전사가 답변을 직접 뒷받침하면 '전사 기반'이라고 밝혀주세요.\n"
        "전사만으로 부족하면 일반 지식으로 보완하되, 반드시 '일반 지식 보충'이라고 구분하세요.\n"
        "한국어 질문에는 한국어로 간결하고 실용적으로 답하세요.\n\n"
        "[현재 강의 전사 스냅샷]\n"
        f"{transcript_block}"
    )

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for message in request.messages[-MAX_CHAT_HISTORY_MESSAGES:]:
        content = message.content.strip()
        if content:
            messages.append({"role": message.role, "content": content})
    messages.append({"role": "user", "content": request.question.strip()})
    return messages


@dataclass
class SessionConfig:
    sample_rate: int = 16000
    language: str = "ko"
    text_file: Optional[str] = None
    text_content: Optional[str] = None
    chunk_delay: float = DEFAULT_CHUNK_DELAY
    words_per_chunk: int = DEFAULT_WORDS_PER_CHUNK
    confidence_base: float = 0.85
    confidence_variance: float = 0.12


@dataclass
class TranscriptionSession:
    config: SessionConfig
    full_text: str = ""
    words: list = field(default_factory=list)
    current_index: int = 0
    audio_bytes_received: int = 0
    is_finished: bool = False


def split_into_sentences(text: str) -> list[str]:
    sentences = re.split(r'(?<=[.!?。！？\n])\s+', text.strip())
    return [s.strip() for s in sentences if len(s.strip()) > 5]


def split_words(text: str) -> list[str]:
    return text.strip().split()


def resolve_text_path(text_file: Optional[str]) -> Optional[Path]:
    if not text_file:
        return None

    candidate = (TEXT_DIR / Path(text_file).name).resolve()
    text_root = TEXT_DIR.resolve()

    try:
        candidate.relative_to(text_root)
    except ValueError:
        return None

    if candidate.suffix != ".txt" or not candidate.exists():
        return None

    if is_unsafe_bundled_text(candidate):
        return None

    return candidate


def is_unsafe_bundled_text(path: Path) -> bool:
    preview = path.read_text(encoding="utf-8")[:UNSAFE_BUNDLED_TEXT_SCAN_LIMIT]
    return any(marker in preview for marker in UNSAFE_BUNDLED_TEXT_MARKERS)


def list_available_text_files() -> list[Path]:
    if not TEXT_DIR.exists():
        return []

    return [path for path in sorted(TEXT_DIR.glob("*.txt")) if not is_unsafe_bundled_text(path)]


def fallback_text() -> str:
    files = list_available_text_files()
    if files:
        return files[0].read_text(encoding="utf-8")
    return DEFAULT_FALLBACK_TEXT


async def reject_invalid_websocket_request(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "message": message})
    await websocket.close(code=1008)


def create_session(config: SessionConfig) -> TranscriptionSession:
    session = TranscriptionSession(config=config)

    if config.text_content:
        session.full_text = config.text_content
    elif config.text_file:
        path = resolve_text_path(config.text_file)
        if path is not None:
            session.full_text = path.read_text(encoding="utf-8")
        else:
            session.full_text = fallback_text()

    if not session.full_text:
        session.full_text = fallback_text()

    session.words = split_words(session.full_text)
    return session


app = FastAPI(title="Mock Streaming STT Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=LOCAL_DEV_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "description": "Mock Streaming STT worker for local dev scaffold",
        "endpoints": {
            "ws": "/stt/stream",
            "ws_simulate": "/stt/simulate",
            "live_chat": "/llm/chat",
            "live_chat_stream": "/llm/chat/stream",
            "health": "/health",
            "texts": "/texts",
        },
    }


@app.get("/health")
async def health():
    return {
        "service": SERVICE_NAME,
        "status": "ok",
        "version": SERVICE_VERSION,
    }


@app.get("/texts")
async def list_texts():
    texts = []
    for f in list_available_text_files():
        content = f.read_text(encoding="utf-8")
        size = f.stat().st_size
        texts.append({"name": f.name, "size": size, "chars": len(content)})
    return {"texts": texts, "directory": str(TEXT_DIR)}


@app.post("/llm/chat", response_model=LiveChatResponse)
async def live_llm_chat(
    request: LiveChatRequest,
    x_internal_chat_secret: str | None = Header(default=None),
):
    api_key, model = get_live_chat_runtime(x_internal_chat_secret)
    messages = build_live_chat_messages(request)
    grounding = build_grounding(request.transcript)

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                OPENROUTER_CHAT_COMPLETIONS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "X-Title": "tu-capstone-live-chat",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.2,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        detail = provider_error_message(exc.response)
        logger.warning("OpenRouter chat request failed status=%s detail=%s", exc.response.status_code, detail)
        raise HTTPException(status_code=502, detail=detail) from exc
    except httpx.HTTPError as exc:
        logger.warning("OpenRouter chat request error: %s", exc.__class__.__name__)
        raise HTTPException(status_code=502, detail="OpenRouter chat request error") from exc

    try:
        answer = payload["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        logger.warning("OpenRouter chat response missing content")
        raise HTTPException(status_code=502, detail="OpenRouter chat response missing content") from exc

    if not answer:
        raise HTTPException(status_code=502, detail="OpenRouter chat response was empty")

    return LiveChatResponse(answer=answer, grounding=grounding, model=model)


async def stream_openrouter_chat(request: LiveChatRequest, api_key: str, model: str):
    messages = build_live_chat_messages(request)
    grounding = build_grounding(request.transcript)
    answer_parts: list[str] = []

    yield sse_event({"grounding": grounding, "model": model}, event="meta")

    try:
        timeout = httpx.Timeout(connect=5.0, write=5.0, pool=5.0, read=None)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                OPENROUTER_CHAT_COMPLETIONS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "X-Title": "tu-capstone-live-chat",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.2,
                    "stream": True,
                },
            ) as response:
                if response.status_code >= 400:
                    detail = provider_error_message(response)
                    logger.warning("OpenRouter stream request failed status=%s detail=%s", response.status_code, detail)
                    yield sse_event({"message": detail}, event="error")
                    return

                async for line in response.aiter_lines():
                    if not line or line.startswith(":"):
                        continue
                    if not line.startswith("data:"):
                        continue

                    data = line.removeprefix("data:").strip()
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    if chunk.get("error"):
                        message = chunk.get("error", {}).get("message") or "OpenRouter stream error"
                        yield sse_event({"message": message}, event="error")
                        return

                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content") or ""
                    if content:
                        answer_parts.append(content)
                        yield sse_event({"delta": content})
    except httpx.HTTPError as exc:
        logger.warning("OpenRouter stream request error: %s", exc.__class__.__name__)
        yield sse_event({"message": "OpenRouter stream request error"}, event="error")
        return

    answer = "".join(answer_parts).strip()
    if not answer:
        yield sse_event({"message": "OpenRouter stream response was empty"}, event="error")
        return

    yield sse_event({"answer": answer, "grounding": grounding, "model": model}, event="done")


@app.post("/llm/chat/stream")
async def live_llm_chat_stream(
    request: LiveChatRequest,
    x_internal_chat_secret: str | None = Header(default=None),
):
    api_key, model = get_live_chat_runtime(x_internal_chat_secret)
    return StreamingResponse(
        stream_openrouter_chat(request, api_key, model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.websocket("/stt/stream")
async def stt_stream(
    websocket: WebSocket,
    text_file: Optional[str] = Query(default=None),
    language: str = Query(default="ko"),
    sample_rate: int = Query(default=16000),
    chunk_delay: float = Query(default=DEFAULT_CHUNK_DELAY),
    words_per_chunk: int = Query(default=DEFAULT_WORDS_PER_CHUNK),
):
    await websocket.accept()

    if words_per_chunk <= 0:
        await reject_invalid_websocket_request(websocket, "words_per_chunk must be greater than 0")
        return

    if chunk_delay < 0:
        await reject_invalid_websocket_request(websocket, "chunk_delay must be greater than or equal to 0")
        return

    config = SessionConfig(
        sample_rate=sample_rate, language=language,
        text_file=text_file, chunk_delay=chunk_delay,
        words_per_chunk=words_per_chunk,
    )
    session = create_session(config)

    await websocket.send_json({
        "type": "listening",
        "sample_rate": config.sample_rate,
        "language": config.language,
        "text_length": len(session.full_text),
    })

    logger.info(f"Stream session: file={text_file}, text={len(session.full_text)} chars")

    try:
        while True:
            data = await websocket.receive()

            if "bytes" in data and data["bytes"]:
                audio_bytes = data["bytes"]
                session.audio_bytes_received += len(audio_bytes)

                if session.current_index < len(session.words):
                    end_idx = min(session.current_index + config.words_per_chunk, len(session.words))
                    chunk_words = session.words[session.current_index:end_idx]
                    chunk_text = " ".join(chunk_words)

                    bytes_per_word = AUDIO_BYTES_PER_SEGMENT / max(config.words_per_chunk, 1)
                    expected_bytes = (session.current_index // config.words_per_chunk + 1) * AUDIO_BYTES_PER_SEGMENT

                    if session.audio_bytes_received >= expected_bytes:
                        confidence = round(config.confidence_base + random.uniform(0, config.confidence_variance), 3)
                        await websocket.send_json({
                            "type": "final", "text": chunk_text.strip(),
                            "index": session.current_index // config.words_per_chunk,
                            "confidence": confidence, "words": len(chunk_words),
                        })
                        session.current_index = end_idx
                    else:
                        await websocket.send_json({
                            "type": "interim", "text": chunk_text.strip(),
                            "index": session.current_index // config.words_per_chunk,
                        })

                    await asyncio.sleep(config.chunk_delay * 0.3)

            elif "text" in data and data["text"]:
                try:
                    msg = json.loads(data["text"])
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                    continue

                if msg.get("type") == "config":
                    if msg.get("text_content"):
                        session.full_text = msg["text_content"]
                        session.words = split_words(session.full_text)
                        session.current_index = 0
                    if "chunk_delay" in msg:
                        chunk_delay = msg["chunk_delay"]
                        if not isinstance(chunk_delay, (int, float)):
                            await websocket.send_json({"type": "error", "message": "chunk_delay must be a number"})
                            continue
                        if chunk_delay < 0:
                            await websocket.send_json({"type": "error", "message": "chunk_delay must be greater than or equal to 0"})
                            continue
                        config.chunk_delay = float(chunk_delay)
                    await websocket.send_json({"type": "config_ack", "config_received": True})

                elif msg.get("type") == "terminate":
                    await websocket.send_json({
                        "type": "speech_ended",
                        "total_index": session.current_index,
                        "total_audio_bytes": session.audio_bytes_received,
                    })
                    await asyncio.sleep(0.05)
                    return

                elif msg.get("type") == "flush":
                    if session.current_index < len(session.words):
                        remaining = " ".join(session.words[session.current_index:])
                        await websocket.send_json({
                            "type": "final", "text": remaining.strip(),
                            "index": session.current_index // config.words_per_chunk,
                            "confidence": round(config.confidence_base + 0.05, 3),
                            "flushed": True,
                        })
                        session.current_index = len(session.words)

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Error: {e}")


@app.websocket("/stt/simulate")
async def stt_simulate(
    websocket: WebSocket,
    text_file: Optional[str] = Query(default=None),
    language: str = Query(default="ko"),
    speed: float = Query(default=1.0),
):
    await websocket.accept()

    if speed <= 0:
        await reject_invalid_websocket_request(websocket, "speed must be greater than 0")
        return

    config = SessionConfig(language=language, text_file=text_file)
    session = create_session(config)

    await websocket.send_json({
        "type": "listening", "mode": "simulate",
        "text_length": len(session.full_text),
    })

    logger.info(f"Simulate session: file={text_file}, text={len(session.full_text)} chars")

    try:
        sentences = split_into_sentences(session.full_text)
        if not sentences:
            sentences = [session.full_text]

        cumulative_text = ""
        for i, sentence in enumerate(sentences):
            words = split_words(sentence)
            interim_words = []
            for j, word in enumerate(words):
                interim_words.append(word)
                if j % 3 == 0 and j > 0:
                    await websocket.send_json({
                        "type": "interim",
                        "text": (cumulative_text + " " + " ".join(interim_words)).strip(),
                        "index": i,
                        "progress": (i * len(words) + j) / (len(sentences) * len(words)) * 100,
                    })
                    # ~0.15s per word at speed=1 ≈ natural Korean speech pace
                    await asyncio.sleep(0.45 / speed)

            cumulative_text = (cumulative_text + " " + sentence).strip()
            await websocket.send_json({
                "type": "final", "text": sentence.strip(), "index": i,
                "confidence": round(0.85 + random.uniform(0, 0.12), 3),
                "cumulative_text": cumulative_text,
                "progress": ((i + 1) / len(sentences)) * 100,
            })
            # Natural pause between sentences
            await asyncio.sleep(0.6 / speed)

        await websocket.send_json({
            "type": "speech_ended",
            "total_index": len(sentences),
            "full_text": cumulative_text,
        })
        await asyncio.sleep(0.05)

    except WebSocketDisconnect:
        logger.info("Simulate client disconnected")
    except Exception as e:
        logger.error(f"Simulate error: {e}")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
