'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_CONFIG, ENDPOINTS } from '@/lib/endpoints';
import {
  ArrowUp,
  Bot,
  Download,
  Maximize2,
  Mic,
  MicOff,
  PauseCircle,
  PhoneOff,
  Play,
  Search,
  Settings2,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';

type LiveLectureRoomProps = {
  onEnd?: () => void;
};

type TokenResponse = {
  token?: string;
  error?: string;
  message?: string;
};

type TranscriptSegment = {
  id: string;
  time: string;
  text: string;
};

type RealtimeScribeMessage = {
  message_type?: string;
  text?: string;
  error?: string;
};

type LiveChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  grounding?: 'transcript_only' | 'transcript_and_general_knowledge' | 'general_knowledge';
  model?: string;
};

type LiveChatStreamPayload = {
  delta?: string;
  answer?: string;
  grounding?: LiveChatMessage['grounding'];
  model?: string;
  message?: string;
};

const initialTranscripts: TranscriptSegment[] = [];
const TRANSCRIPT_CONTEXT_SEGMENT_LIMIT = 20;


function downsampleToPcm16(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (inputSampleRate === outputSampleRate) {
    return floatToPcm16(input);
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;

    for (let j = start; j < end; j += 1) {
      sum += input[j];
    }

    output[i] = sum / Math.max(1, end - start);
  }

  return floatToPcm16(output);
}

function floatToPcm16(input: Float32Array) {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

function pcm16ToBase64(pcm16: Int16Array) {
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function formatNowTime() {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

export default function LiveLectureRoom({ onEnd }: LiveLectureRoomProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>(initialTranscripts);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'standby' | 'connecting' | 'recording'>('standby');
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatPending, setIsChatPending] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  const isRecording = connectionState === 'recording';
  const isConnecting = connectionState === 'connecting';
  const recordingTime = useMemo(() => formatElapsed(elapsedSeconds), [elapsedSeconds]);


  const buildTranscriptContext = useCallback(() => {
    const recentSegments = segments.slice(-TRANSCRIPT_CONTEXT_SEGMENT_LIMIT);
    const committed = recentSegments.map((segment) => `[${segment.time}] ${segment.text}`);
    const partial = partialTranscript.trim();

    if (partial) {
      committed.push(`[LIVE] ${partial}`);
    }

    return committed.join('\n');
  }, [partialTranscript, segments]);

  const handleChatSubmit = useCallback(async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const question = chatInput.trim();
    if (!question || isChatPending) return;

    const now = Date.now();
    const assistantId = `chat-assistant-${now}`;
    const userMessage: LiveChatMessage = {
      id: `chat-user-${now}`,
      role: 'user',
      content: question,
      createdAt: formatNowTime(),
    };
    const assistantMessage: LiveChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: formatNowTime(),
    };
    const previousMessages = chatMessages
      .slice(-TRANSCRIPT_CONTEXT_SEGMENT_LIMIT)
      .map(({ role, content }) => ({ role, content }));
    const transcript = buildTranscriptContext();

    setChatMessages((prev) => [...prev, userMessage, assistantMessage]);
    setChatInput('');
    setChatError(null);
    setIsChatPending(true);

    const appendAssistantDelta = (delta: string) => {
      setChatMessages((prev) => prev.map((message) => (
        message.id === assistantId
          ? { ...message, content: `${message.content}${delta}` }
          : message
      )));
    };

    const updateAssistantMeta = (payload: LiveChatStreamPayload) => {
      setChatMessages((prev) => prev.map((message) => (
        message.id === assistantId
          ? {
              ...message,
              content: payload.answer ?? message.content,
              grounding: payload.grounding ?? message.grounding,
              model: payload.model ?? message.model,
            }
          : message
      )));
    };

    const requestStream = () => fetch(`${API_CONFIG.BASE_URL}${ENDPOINTS.CHAT.LIVE_STREAM}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        transcript,
        messages: previousMessages,
      }),
    });

    const processSseBlock = (block: string) => {
      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }

      const rawData = dataLines.join('\n').trim();
      if (!rawData) return;

      const payload = JSON.parse(rawData) as LiveChatStreamPayload;
      if (eventName === 'error') {
        throw new Error(payload.message || 'AI 스트리밍 응답에 실패했습니다.');
      }
      if (eventName === 'meta' || eventName === 'done') {
        updateAssistantMeta(payload);
        return;
      }
      if (payload.delta) {
        appendAssistantDelta(payload.delta);
      }
    };

    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[LiveChat] streaming question', {
          messageCount: previousMessages.length,
          transcriptChars: transcript.length,
          transcriptSegments: Math.min(segments.length, TRANSCRIPT_CONTEXT_SEGMENT_LIMIT),
          hasPartialTranscript: Boolean(partialTranscript.trim()),
        });
      }

      let response = await requestStream();
      if (response.status === 401) {
        const refreshResponse = await fetch(`${API_CONFIG.BASE_URL}${ENDPOINTS.AUTH.REFRESH}`, {
          method: 'POST',
          credentials: 'include',
        });
        if (refreshResponse.ok) {
          response = await requestStream();
        } else {
          window.location.href = '/login?error=session_expired';
          return;
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'AI 스트리밍 요청에 실패했습니다.' }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('브라우저가 스트리밍 응답을 지원하지 않습니다.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          processSseBlock(block);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        processSseBlock(buffer);
      }
    } catch (err) {
      setChatMessages((prev) => prev.filter((message) => !(message.id === assistantId && !message.content.trim())));
      setChatError(err instanceof Error ? err.message : 'AI 답변을 가져오지 못했습니다.');
    } finally {
      setIsChatPending(false);
    }
  }, [buildTranscriptContext, chatInput, chatMessages, isChatPending, partialTranscript, segments.length]);

  const cleanupAudio = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();

    processorRef.current = null;
    sourceRef.current = null;
    silentGainRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }, []);

  const stop = useCallback(() => {
    setError(null);

    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: '',
        commit: true,
        sample_rate: 16000,
      }));
      ws.close(1000, 'user stopped recording');
    } else {
      ws?.close();
    }

    wsRef.current = null;
    cleanupAudio();
    setConnectionState('standby');
    setPartialTranscript('');
  }, [cleanupAudio]);

  const start = useCallback(async () => {
    if (connectionState !== 'standby') return;

    setError(null);
    setConnectionState('connecting');

    try {
      const tokenEndpoint = `${API_CONFIG.BASE_URL}/api/scribe/token`;
      const tokenResponse = await fetch(tokenEndpoint, {
        method: 'POST',
        credentials: 'include',
      });
      const tokenData = (await tokenResponse.json().catch(() => ({}))) as TokenResponse;

      if (!tokenResponse.ok) {
        console.error('[ElevenLabs] Spring token auth failed', {
          endpoint: tokenEndpoint,
          status: tokenResponse.status,
          error: tokenData.error || tokenData.message || tokenResponse.statusText,
        });
        throw new Error(tokenData.error || tokenData.message || 'Failed to create ElevenLabs token');
      }

      if (!tokenData.token) {
        console.error('[ElevenLabs] Spring token response missing token', {
          endpoint: tokenEndpoint,
          status: tokenResponse.status,
        });
        throw new Error('Token response did not include token');
      }

      console.log('[ElevenLabs] Spring token auth success', {
        endpoint: tokenEndpoint,
        status: tokenResponse.status,
        tokenPrefix: tokenData.token.slice(0, 8),
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
      url.searchParams.set('model_id', 'scribe_v2_realtime');
      url.searchParams.set('token', tokenData.token);
      url.searchParams.set('commit_strategy', 'vad');
      url.searchParams.set('language_code', 'ko');

      const ws = new WebSocket(url.toString());
      wsRef.current = ws;

      ws.onopen = async () => {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        audioContextRef.current = audioContext;
        sourceRef.current = source;
        processorRef.current = processor;
        silentGainRef.current = silentGain;

        processor.onaudioprocess = (event) => {
          const socket = wsRef.current;
          if (!socket || socket.readyState !== WebSocket.OPEN) return;

          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = downsampleToPcm16(input, audioContext.sampleRate, 16000);
          const audioBase64 = pcm16ToBase64(pcm16);

          socket.send(JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: audioBase64,
            commit: false,
            sample_rate: 16000,
          }));
        };

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        console.log('[ElevenLabs] WebSocket auth success', {
          modelId: 'scribe_v2_realtime',
          languageCode: 'ko',
        });
        setConnectionState('recording');
      };

      ws.onmessage = (event) => {
        let data: RealtimeScribeMessage;

        try {
          data = JSON.parse(String(event.data)) as RealtimeScribeMessage;
        } catch {
          setError('ElevenLabs WebSocket에서 해석할 수 없는 응답을 받았습니다.');
          return;
        }

        if (data.message_type === 'partial_transcript') {
          setPartialTranscript(data.text?.trim() ?? '');
          return;
        }

        if (
          data.message_type === 'committed_transcript' ||
          data.message_type === 'committed_transcript_with_timestamps'
        ) {
          const text = data.text?.trim();
          if (!text) return;

          setSegments((prev) => [
            ...prev,
            {
              id: `live-${Date.now()}-${prev.length}`,
              time: formatNowTime(),
              text,
            },
          ]);
          setPartialTranscript('');
          return;
        }

        if (data.message_type?.includes('error')) {
          setError(data.error || 'ElevenLabs realtime transcription error');
        }
      };

      ws.onerror = () => {
        setError('ElevenLabs WebSocket 연결에 실패했습니다. 네트워크, 계정 권한, 또는 브라우저 마이크 권한을 확인하세요.');
      };

      ws.onclose = (event) => {
        cleanupAudio();
        wsRef.current = null;
        setConnectionState('standby');

        if (!event.wasClean && event.code !== 1000) {
          setError(`ElevenLabs WebSocket 연결이 종료되었습니다. code=${event.code}${event.reason ? `, reason=${event.reason}` : ''}`);
        }
      };
    } catch (err) {
      cleanupAudio();
      wsRef.current?.close();
      wsRef.current = null;
      setConnectionState('standby');
      setError(err instanceof Error ? err.message : 'Failed to start realtime dictation');
    }
  }, [cleanupAudio, connectionState]);

  const clearTranscript = () => {
    setSegments([]);
    setError(null);
  };

  const handleEnd = () => {
    stop();
    onEnd?.();
  };

  useEffect(() => {
    if (!isRecording) return;

    const startedAt = Date.now() - elapsedSeconds * 1000;
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [elapsedSeconds, isRecording]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);
  return (
    <section className="relative flex h-[calc(100vh-5rem)] min-h-[720px] overflow-hidden bg-[#f7f9fb] text-[#191c1e]">
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-[#e0e3e5]/60 bg-white/70 px-8 backdrop-blur-xl">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#75777d]">Live lecture</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#091426]">고급 기계학습론 - 5주차</h2>
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <span className="max-w-[360px] truncate rounded-full border border-[#ba1a1a]/20 bg-[#ffdad6] px-3 py-2 text-xs font-bold text-[#93000a]" title={error}>
                {error}
              </span>
            )}
            <div className="flex items-center gap-2 rounded-full border border-[#c5c6cd]/40 bg-white/90 px-4 py-2 shadow-sm">
              <div className="mr-2 flex h-6 w-9 items-center justify-center gap-[3px]">
                {[40, 70, 100, 70, 40].map((height, index) => (
                  <span
                    key={`recording-bar-${height}-${index}`}
                    className={isRecording ? 'edupulse-gemini-bar w-1 rounded-full bg-[#ba1a1a]' : `w-1 rounded-full ${isConnecting ? 'bg-[#006b5f]' : 'bg-[#75777d]'}`}
                    style={{ height: `${height}%`, animationDelay: `${-0.4 + index * 0.1}s` }}
                  />
                ))}
              </div>
              <span className={`text-xs font-black uppercase tracking-[0.18em] ${isRecording ? 'text-[#ba1a1a]' : 'text-[#75777d]'}`}>
                {isRecording ? 'Recording' : isConnecting ? 'Connecting' : 'Standby'}
              </span>
              <span className="ml-2 text-sm font-bold text-[#45474c]">{recordingTime}</span>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 gap-6 overflow-hidden px-6 pb-24 pt-6 2xl:gap-8 2xl:px-8">
          <article className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-[#e0e3e5]/80 bg-white shadow-[0_24px_80px_-56px_rgba(9,20,38,0.65)]">
            <div className="flex items-center justify-between border-b border-[#e0e3e5]/70 bg-white/90 px-8 py-5">
              <div className="flex items-center gap-3">
                <StickyNote className="h-6 w-6 text-[#091426]" />
                <h3 className="text-lg font-black text-[#091426]">실시간 전사</h3>
              </div>
              <div className="flex items-center gap-2 text-[#45474c]">
                <button className="rounded-xl p-2 transition hover:bg-[#eceef0]" aria-label="전사 검색">
                  <Search className="h-5 w-5" />
                </button>
                <button className="rounded-xl p-2 transition hover:bg-[#eceef0]" aria-label="전사 다운로드">
                  <Download className="h-5 w-5" />
                </button>
                <button onClick={clearTranscript} className="rounded-xl p-2 transition hover:bg-[#eceef0]" aria-label="전사 지우기">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-10 overflow-y-auto p-8 lg:p-10">
              {segments.length === 0 && !partialTranscript && (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-3xl border border-dashed border-[#c5c6cd] bg-[#f7f9fb] px-8 text-center">
                  <Mic className="mb-4 h-10 w-10 text-[#75777d]" />
                  <p className="text-lg font-black text-[#091426]">마이크 전사를 시작하세요</p>
                  <p className="mt-2 text-sm font-medium text-[#75777d]">하단 마이크 버튼을 누르고 브라우저 마이크 권한을 허용하면 ElevenLabs Scribe WebSocket으로 실시간 전사가 표시됩니다.</p>
                </div>
              )}

              {segments.map((item) => (
                <div key={item.id} className="group flex gap-8">
                  <div className="w-14 shrink-0 pt-1.5">
                    <span className="text-xs font-black tracking-wider text-[#75777d]">{item.time}</span>
                  </div>
                  <p className="max-w-5xl text-[18px] leading-[1.75] text-[#191c1e] lg:text-[19px]">{item.text}</p>
                </div>
              ))}

              <div className="relative py-4">
                <div className="absolute bottom-0 left-[-10px] top-0 w-1 rounded-full bg-[#006b5f]" />
                <div className="flex gap-8">
                  <div className="w-14 shrink-0 pt-1.5">
                    <span className="text-xs font-black tracking-wider text-[#006b5f]">LIVE</span>
                  </div>
                  <p className="text-[19px] italic leading-[1.75] text-[#191c1e]/80">
                    {partialTranscript || (isRecording ? '말씀하시면 여기에 실시간으로 표시됩니다' : isConnecting ? 'ElevenLabs WebSocket에 연결하는 중입니다...' : '하단 마이크 버튼을 눌러 ElevenLabs 실시간 전사를 시작하세요')}
                    <span className="ml-1 inline-block h-[1.1em] w-[3px] animate-pulse bg-[#006b5f] align-middle" />
                  </p>
                </div>
              </div>
            </div>
          </article>

          <aside className="hidden w-[400px] shrink-0 flex-col overflow-hidden rounded-3xl border border-[#e0e3e5]/80 bg-white shadow-[0_24px_80px_-56px_rgba(9,20,38,0.65)] xl:flex 2xl:w-[440px]">
            <div className="flex items-center justify-between border-b border-[#e0e3e5]/70 bg-[#f2f4f6] px-6 py-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-6 w-6 fill-[#006b5f]/20 text-[#006b5f]" />
                <div>
                  <h3 className="text-lg font-black text-[#091426]">AI 질의응답</h3>
                  <p className="mt-0.5 text-xs font-bold text-[#75777d]">전송 시점의 최신 전사 window로 답변</p>
                </div>
              </div>
              <button className="rounded-xl p-2 text-[#45474c] transition hover:bg-[#eceef0]" aria-label="AI 패널 확대">
                <Maximize2 className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
              <div className="flex justify-center">
                <span className="rounded-full bg-[#eceef0] px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-[#75777d]">
                  Transcript window: last {TRANSCRIPT_CONTEXT_SEGMENT_LIMIT}
                </span>
              </div>

              {chatMessages.length === 0 && (
                <div className="rounded-3xl border border-dashed border-[#c5c6cd] bg-[#f7f9fb] px-5 py-8 text-center">
                  <Bot className="mx-auto mb-3 h-9 w-9 text-[#006b5f]" />
                  <p className="text-sm font-black text-[#091426]">강의 전사 기반으로 질문하세요</p>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-[#75777d]">
                    질문을 보내면 현재 전사 스냅샷과 이 채팅의 이전 대화만 함께 전송됩니다.
                  </p>
                </div>
              )}

              {chatMessages.map((message) => (
                <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex items-start gap-3'}>
                  {message.role === 'assistant' && (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#62fae3] shadow-sm">
                      <Bot className="h-5 w-5 text-[#00201c]" />
                    </div>
                  )}
                  <div className={message.role === 'user'
                    ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-none bg-[#091426] px-5 py-3.5 text-sm leading-relaxed text-white shadow-sm'
                    : 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-none border border-[#c5c6cd]/30 bg-[#f2f4f6] px-5 py-4 text-sm leading-relaxed text-[#191c1e] shadow-sm'}>
                    {message.content || (message.role === 'assistant' && isChatPending ? '답변 작성 중...' : '')}
                    {message.role === 'assistant' && isChatPending && !message.content && (
                      <span className="ml-1 inline-block h-[1em] w-[3px] animate-pulse bg-[#006b5f] align-middle" />
                    )}
                    {message.role === 'assistant' && (message.grounding || message.model) && (
                      <div className="mt-3 border-t border-[#c5c6cd]/30 pt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#75777d]">
                        {message.grounding ?? 'grounding_unknown'} · {message.model ?? 'model_unknown'}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {chatError && (
                <div className="rounded-2xl border border-[#ba1a1a]/20 bg-[#ffdad6] px-4 py-3 text-sm font-bold text-[#93000a]">
                  {chatError}
                </div>
              )}
            </div>

            <div className="border-t border-[#e0e3e5]/70 bg-white p-6">
              <form onSubmit={handleChatSubmit} className="relative flex items-center">
                <input
                  className="w-full rounded-2xl border border-[#c5c6cd]/60 bg-white py-4 pl-5 pr-14 text-sm text-[#191c1e] outline-none transition placeholder:text-[#75777d] focus:border-[#006b5f] focus:ring-4 focus:ring-[#006b5f]/10 disabled:bg-[#f2f4f6]"
                  placeholder="강의 내용에 대해 질문하세요..."
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  disabled={isChatPending}
                />
                <button
                  type="submit"
                  disabled={isChatPending || !chatInput.trim()}
                  className="absolute right-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#091426] text-white shadow-sm transition hover:bg-[#091426]/90 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="질문 전송"
                >
                  <ArrowUp className="h-5 w-5" />
                </button>
              </form>
            </div>
          </aside>
        </div>

        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <div className="flex items-center gap-4 rounded-full border border-white/10 bg-slate-950/90 px-6 py-2 shadow-2xl backdrop-blur-2xl">
            <button
              onClick={handleEnd}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ba1a1a] text-white shadow-sm transition hover:bg-[#a01515]"
              aria-label="강의 종료"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
            <button onClick={stop} disabled={!isRecording} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" aria-label="일시 정지">
              <PauseCircle className="h-6 w-6" />
            </button>
            <button onClick={isRecording ? stop : start} disabled={isConnecting} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" aria-label={isRecording ? '마이크 끄기' : '마이크 켜기'}>
              {isRecording ? <MicOff className="h-6 w-6" /> : <Play className="h-6 w-6" />}
            </button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white" aria-label="음성 설정">
              <Settings2 className="h-6 w-6" />
            </button>
          </div>
          <div className="h-1 w-12 rounded-full bg-[#191c1e]/20" />
        </div>
      </main>
    </section>
  );
}
