'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/endpoints';
import { apiFetch } from '@/lib/api';
import localforage from 'localforage';
import {
  Download,
  Mic,
  MicOff,
  PauseCircle,
  PhoneOff,
  Play,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  BookOpen,
} from 'lucide-react';

type LiveLectureRoomProps = {
  onEnd?: () => void;
  resumeId?: number;
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

interface Lecture {
  id: number;
  title: string;
  status: 'RECORDING' | 'PAUSED' | 'COMPLETED';
  createdAt: string;
}

const initialTranscripts: TranscriptSegment[] = [];


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

export default function LiveLectureRoom({ onEnd, resumeId }: LiveLectureRoomProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>(initialTranscripts);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'standby' | 'connecting' | 'recording'>('standby');
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  // New state for lecture creation flow
  const [currentLectureId, setCurrentLectureId] = useState<number | null>(resumeId || null);
  const [lectureTitle, setLectureTitle] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(!resumeId);
  const [isCreating, setIsCreating] = useState(false);

  // Fetch lecture if resuming
  useEffect(() => {
    if (resumeId) {
      const fetchLecture = async () => {
        try {
          const data = await apiFetch<Lecture>(`/api/lectures/${resumeId}`);
          setLectureTitle(data.title);
          
          // Fetch existing messages to populate segments
          const messages = await apiFetch<any[]>(`/api/v1/messages/${resumeId}`);
          const fetchedSegments = messages.map((m, idx) => ({
            id: m.id?.toString() || idx.toString(),
            time: formatElapsed(m.timestamp || 0),
            text: m.content || m.message || ''
          }));
          setSegments(fetchedSegments);
        } catch (err) {
          console.error('Failed to resume lecture', err);
          setError('강의 정보를 불러오지 못했습니다.');
        }
      };
      fetchLecture();
    }
  }, [resumeId]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const isRecording = connectionState === 'recording';
  const isConnecting = connectionState === 'connecting';
  const recordingTime = useMemo(() => formatElapsed(elapsedSeconds), [elapsedSeconds]);

  // Create Lecture API Call
  const handleCreateLecture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lectureTitle.trim()) return;

    setIsCreating(true);
    setError(null);
    try {
      const data = await apiFetch<{ id: number }>('/api/lectures', {
        method: 'POST',
        body: JSON.stringify({ title: lectureTitle }),
      });
      setCurrentLectureId(data.id);
      setShowCreateModal(false);
      console.log(`[Lecture] Created with ID: ${data.id}`);
    } catch (err) {
      console.error('Failed to create lecture', err);
      setError('강의를 생성하지 못했습니다. 다시 시도해주세요.');
    } finally {
      setIsCreating(false);
    }
  };

  // Sync Transcript to Backend (Now Appending to Records)
  const syncTranscriptToBackend = async (text: string) => {
    if (!currentLectureId) return;
    try {
      await apiFetch(`/api/v1/records/${currentLectureId}/transcript`, {
        method: 'POST',
        body: JSON.stringify({ content: text }),
      });
    } catch (err) {
      console.error('Failed to sync transcript to records', err);
    }
  };

  const cleanupAudio = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
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
    mediaRecorderRef.current = null;
  }, []);

  const handlePause = useCallback(async () => {
    if (!currentLectureId) return;
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
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('chunk', audioBlob, `chunk_${Date.now()}.webm`);

        try {
          await apiFetch(`/api/v1/records/${currentLectureId}/chunk`, {
            method: 'POST',
            body: formData,
          });
          await localforage.removeItem(`lecture_${currentLectureId}_chunks`);
          audioChunksRef.current = [];
          console.log('[Sync] Chunk uploaded successfully.');
        } catch (err) {
          console.error('[Sync] Failed to upload chunk', err);
          setError('오디오 임시 저장 실패. 네트워크를 확인하세요.');
        }
      };
      mediaRecorderRef.current.stop();
    }

    cleanupAudio();
    setConnectionState('standby');
    setPartialTranscript('');
  }, [cleanupAudio, currentLectureId]);

  const handleEnd = useCallback(async () => {
    if (!currentLectureId) return;
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

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, `final_${Date.now()}.webm`);
        formData.append('duration', elapsedSeconds.toString());

        try {
          // 1. Final transcript aggregation
          const fullTranscript = segments.map(s => s.text).join(' ');
          if (fullTranscript.trim()) {
            // Also sync to messages table for LangGraph context
            await syncTranscriptToBackend(fullTranscript, true);
            // Include in the final record saving request
            formData.append('transcript', fullTranscript);
          }

          // 2. Audio and Transcript save to Records table
          await apiFetch(`/api/v1/records/${currentLectureId}/save`, {
            method: 'POST',
            body: formData,
          });
          await localforage.removeItem(`lecture_${currentLectureId}_chunks`);
          audioChunksRef.current = [];
          console.log('[Sync] Final record saved.');
          onEnd?.();
        } catch (err) {
          console.error('[Sync] Failed to save final record', err);
          setError('최종 저장 실패.');
        }
      };
      mediaRecorderRef.current.stop();
    } else {
       onEnd?.();
    }

    cleanupAudio();
    setConnectionState('standby');
    setPartialTranscript('');
  }, [cleanupAudio, elapsedSeconds, currentLectureId, onEnd]);


  const start = useCallback(async () => {
    if (connectionState !== 'standby' || !currentLectureId) return;

    setError(null);
    setConnectionState('connecting');
    audioChunksRef.current = [];

    try {
      const tokenEndpoint = `${API_CONFIG.BASE_URL}/api/scribe/token`;
      const tokenResponse = await fetch(tokenEndpoint, {
        method: 'POST',
        credentials: 'include',
      });
      
      let tokenData: TokenResponse = {};
      const tokenText = await tokenResponse.text();
      if (tokenText) {
        try {
          tokenData = JSON.parse(tokenText) as TokenResponse;
        } catch (e) {
          console.error('Failed to parse token response', e);
        }
      }

      if (!tokenResponse.ok) {
        throw new Error(tokenData.error || tokenData.message || 'ElevenLabs token failed');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
          try {
             await localforage.setItem(`lecture_${currentLectureId}_chunks`, audioChunksRef.current);
          } catch(err) {}
        }
      };
      mediaRecorder.start(1000);

      const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
      url.searchParams.set('model_id', 'scribe_v2_realtime');
      url.searchParams.set('token', tokenData.token!);
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
        setConnectionState('recording');
      };

      ws.onmessage = (event) => {
        let data: RealtimeScribeMessage;
        try {
          data = JSON.parse(String(event.data)) as RealtimeScribeMessage;
        } catch { return; }

        if (data.message_type === 'partial_transcript') {
          setPartialTranscript(data.text?.trim() ?? '');
          return;
        }

        if (data.message_type === 'committed_transcript' || data.message_type === 'committed_transcript_with_timestamps') {
          const text = data.text?.trim();
          if (!text) return;

          setSegments((prev) => [
            ...prev,
            { id: `live-${Date.now()}-${prev.length}`, time: formatNowTime(), text },
          ]);
          setPartialTranscript('');
          void syncTranscriptToBackend(text);
          return;
        }

        if (data.message_type?.includes('error')) {
          setError(data.error || 'ElevenLabs error');
        }
      };

      ws.onerror = () => { setError('ElevenLabs WebSocket failed'); };
      ws.onclose = () => { cleanupAudio(); wsRef.current = null; setConnectionState('standby'); };
    } catch (err) {
      cleanupAudio();
      wsRef.current?.close();
      wsRef.current = null;
      setConnectionState('standby');
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
  }, [cleanupAudio, connectionState, currentLectureId]);

  const clearTranscript = () => { setSegments([]); setError(null); };

  useEffect(() => {
    if (!isRecording) return;
    const startedAt = Date.now() - elapsedSeconds * 1000;
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [elapsedSeconds, isRecording]);

  useEffect(() => {
    const checkRecovery = async () => {
       try {
         // Generic check for any unfinished chunks (could be improved to iterate all)
         const keys = await localforage.keys();
         const recoveryKey = keys.find(k => k.startsWith('lecture_') && k.endsWith('_chunks'));
         if (recoveryKey) {
            setShowRecoveryModal(true);
         }
       } catch(err) {}
    };
    void checkRecovery();
    return () => { if (wsRef.current?.readyState === WebSocket.OPEN) handlePause(); };
  }, [handlePause]);

  const handleRecover = async () => {
    setIsRecovering(true);
    try {
      const keys = await localforage.keys();
      const recoveryKey = keys.find(k => k.startsWith('lecture_') && k.endsWith('_chunks'));
      if (recoveryKey) {
        const lectureIdFromKey = parseInt(recoveryKey.split('_')[1]);
        const savedChunks = await localforage.getItem<Blob[]>(recoveryKey);
        if (savedChunks && savedChunks.length > 0) {
          const audioBlob = new Blob(savedChunks, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('chunk', audioBlob, `recovery_${Date.now()}.webm`);
          await apiFetch(`/api/v1/records/${lectureIdFromKey}/chunk`, { method: 'POST', body: formData });
          await localforage.removeItem(recoveryKey);
        }
      }
    } catch (err) {
      console.error(err);
      setError('복구 실패');
    } finally {
      setIsRecovering(false);
      setShowRecoveryModal(false);
    }
  };

  const handleDiscardRecovery = async () => {
    const keys = await localforage.keys();
    for (const key of keys) {
      if (key.startsWith('lecture_') && key.endsWith('_chunks')) {
        await localforage.removeItem(key);
      }
    }
    setShowRecoveryModal(false);
  };

  return (
    <section className="relative flex h-[calc(100vh-5rem)] min-h-[720px] overflow-hidden bg-[#f7f9fb] text-[#191c1e]">
      {/* Recovery Modal */}
      {showRecoveryModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="w-[400px] rounded-3xl bg-white p-8 shadow-2xl">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-[#ffdad6]">
              <Trash2 className="h-6 w-6 text-[#93000a]" />
            </div>
            <h3 className="mb-2 text-xl font-black text-[#091426]">비정상 종료 감지</h3>
            <p className="mb-8 text-sm leading-relaxed text-[#45474c]">이전에 저장되지 못한 녹음 파일이 있습니다. 복구하시겠습니까?</p>
            <div className="flex gap-3">
              <button onClick={handleDiscardRecovery} disabled={isRecovering} className="flex-1 rounded-xl bg-[#f2f4f6] py-3 text-sm font-bold text-[#45474c]">삭제하기</button>
              <button onClick={handleRecover} disabled={isRecovering} className="flex-1 rounded-xl bg-[#006b5f] py-3 text-sm font-bold text-white">{isRecovering ? '복구 중...' : '복구하기'}</button>
            </div>
          </div>
        </div>
      )}

      {/* New Lecture Creation Modal */}
      {showCreateModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/80 backdrop-blur-md">
          <form onSubmit={handleCreateLecture} className="w-[480px] rounded-[40px] border border-[#e0e3e5] bg-white p-12 shadow-[0_32px_120px_-40px_rgba(9,20,38,0.3)]">
            <div className="mb-8 flex h-16 w-12 items-center justify-center rounded-2xl bg-[#f2f4f6]">
              <BookOpen className="h-8 w-8 text-[#091426]" />
            </div>
            <h2 className="mb-2 text-3xl font-black tracking-tight text-[#091426]">새 강의 시작하기</h2>
            <p className="mb-10 text-sm font-medium text-[#75777d]">진행할 강의의 제목을 입력해주세요. 제목은 나중에 수정할 수 있습니다.</p>
            <div className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="title" className="ml-1 text-xs font-black uppercase tracking-widest text-[#75777d]">Lecture Title</label>
                <input
                  id="title"
                  type="text"
                  required
                  value={lectureTitle}
                  onChange={(e) => setLectureTitle(e.target.value)}
                  placeholder="예: 객체지향프로그래밍 1주차"
                  className="w-full rounded-2xl border border-[#c5c6cd] bg-white px-6 py-4 text-lg font-bold outline-none transition focus:border-[#006b5f] focus:ring-4 focus:ring-[#006b5f]/10"
                />
              </div>
              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded-2xl bg-[#091426] py-5 text-lg font-black text-white shadow-xl transition hover:bg-[#1c2a4d] disabled:opacity-50"
              >
                {isCreating ? '강의 생성 중...' : '강의 시작'}
              </button>
            </div>
          </form>
        </div>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-[#e0e3e5]/60 bg-white/70 px-8 backdrop-blur-xl">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#75777d]">Live lecture</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#091426]">
              {lectureTitle || '강의 대기 중'} {currentLectureId ? `- ${currentLectureId}번 세션` : ''}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="rounded-full border border-[#ba1a1a]/20 bg-[#ffdad6] px-3 py-2 text-xs font-bold text-[#93000a]">{error}</span>}
            <div className="flex items-center gap-2 rounded-full border border-[#c5c6cd]/40 bg-white/90 px-4 py-2 shadow-sm">
              <div className="mr-2 flex h-6 w-9 items-center justify-center gap-[3px]">
                {[40, 70, 100, 70, 40].map((h, i) => (
                  <span key={i} className={isRecording ? 'edupulse-gemini-bar w-1 rounded-full bg-[#ba1a1a]' : 'w-1 rounded-full bg-[#75777d]'} style={{ height: `${h}%`, animationDelay: `${-0.4 + i * 0.1}s` }} />
                ))}
              </div>
              <span className={`text-xs font-black uppercase tracking-[0.18em] ${isRecording ? 'text-[#ba1a1a]' : 'text-[#75777d]'}`}>{isRecording ? 'Recording' : isConnecting ? 'Connecting' : 'Standby'}</span>
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
                <button className="rounded-xl p-2 transition hover:bg-[#eceef0]"><Search className="h-5 w-5" /></button>
                <button className="rounded-xl p-2 transition hover:bg-[#eceef0]"><Download className="h-5 w-5" /></button>
                <button onClick={clearTranscript} className="rounded-xl p-2 transition hover:bg-[#eceef0]"><Trash2 className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-10 overflow-y-auto p-8 lg:p-10">
              {segments.length === 0 && !partialTranscript && (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-3xl border border-dashed border-[#c5c6cd] bg-[#f7f9fb] px-8 text-center">
                  <Mic className="mb-4 h-10 w-10 text-[#75777d]" />
                  <p className="text-lg font-black text-[#091426]">강의를 시작하면 전사가 표시됩니다</p>
                </div>
              )}
              {segments.map((item) => (
                <div key={item.id} className="group flex gap-8">
                  <div className="w-14 shrink-0 pt-1.5"><span className="text-xs font-black tracking-wider text-[#75777d]">{item.time}</span></div>
                  <p className="max-w-5xl text-[18px] leading-[1.75] text-[#191c1e] lg:text-[19px]">{item.text}</p>
                </div>
              ))}
              <div className="relative py-4">
                <div className="absolute bottom-0 left-[-10px] top-0 w-1 rounded-full bg-[#006b5f]" />
                <div className="flex gap-8">
                  <div className="w-14 shrink-0 pt-1.5"><span className="text-xs font-black tracking-wider text-[#006b5f]">LIVE</span></div>
                  <p className="text-[19px] italic leading-[1.75] text-[#191c1e]/80">
                    {partialTranscript || (isRecording ? '말씀하시면 표시됩니다' : '마이크 대기 중...')}
                    <span className="ml-1 inline-block h-[1.1em] w-[3px] animate-pulse bg-[#006b5f] align-middle" />
                  </p>
                </div>
              </div>
            </div>
          </article>

          <aside className="hidden w-[400px] shrink-0 flex-col overflow-hidden rounded-3xl border border-[#e0e3e5]/80 bg-white shadow-2xl xl:flex 2xl:w-[440px]">
            <div className="flex items-center justify-between border-b border-[#e0e3e5]/70 bg-[#f2f4f6] px-6 py-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-[#006b5f]" />
                <h3 className="text-lg font-black text-[#091426]">AI 질의응답</h3>
              </div>
            </div>
            <div className="flex-1 p-6 text-center text-sm text-[#75777d]">강의가 시작되면 AI 튜터와 대화할 수 있습니다.</div>
          </aside>
        </div>

        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-slate-950/90 px-6 py-2 shadow-2xl backdrop-blur-2xl">
          <button onClick={handleEnd} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ba1a1a] text-white transition hover:bg-[#a01515]"><PhoneOff className="h-5 w-5" /></button>
          <button onClick={handlePause} disabled={!isRecording} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 disabled:opacity-40"><PauseCircle className="h-6 w-6" /></button>
          <button onClick={isRecording ? handlePause : start} disabled={isConnecting || !currentLectureId} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 disabled:opacity-40">
            {isRecording ? <MicOff className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </button>
        </div>
      </main>
    </section>
  );
}
