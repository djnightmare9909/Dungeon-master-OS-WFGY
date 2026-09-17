// tts.ts — Browser SpeechSynthesis helper for DM OS.
// Uses the browser's built-in TTS engine (no external dependencies).
import { getUISettings } from './state';

let cachedVoices: SpeechSynthesisVoice[] = [];

// --- Per-message playback state (for the play/pause buttons) ---
export type PlaybackState = 'idle' | 'playing' | 'paused';

let activeMsgId: string | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let paused = false;

// --- Screen wake lock: keeps the phone screen on while audio is playing ---
let speechActive = false;
let wakeLock: any = null;

async function acquireWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined' || !(navigator as any).wakeLock || wakeLock) return;
  try {
    const lock = await (navigator as any).wakeLock.request('screen');
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch (e) {
    console.warn('Wake lock request failed:', e);
  }
}

function releaseWakeLock(): void {
  if (wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    try { lock.release(); } catch (e) { /* ignore */ }
  }
}

/** Speaks an utterance while holding the screen wake lock; releases it when speech ends. */
function speakUtterance(u: SpeechSynthesisUtterance, onDone?: () => void): void {
  speechActive = true;
  acquireWakeLock();
  const done = () => {
    speechActive = false;
    releaseWakeLock();
    if (onDone) onDone();
  };
  u.onend = done;
  u.onerror = done;
  window.speechSynthesis.speak(u);
}

// Re-acquire the wake lock if the user returns to the tab while speech is still active
// (browsers auto-release the lock when the page is hidden).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && speechActive) {
      acquireWakeLock();
    }
  });
}

type PlaybackListener = (msgId: string, state: PlaybackState) => void;
const playbackListeners = new Set<PlaybackListener>();

/** Subscribe to playback state changes. Returns an unsubscribe function. */
export function onPlaybackChange(listener: PlaybackListener): () => void {
  playbackListeners.add(listener);
  return () => playbackListeners.delete(listener);
}

function emitPlayback(msgId: string, state: PlaybackState): void {
  playbackListeners.forEach(l => l(msgId, state));
}

function clearActive(): void {
  if (activeMsgId) emitPlayback(activeMsgId, 'idle');
  activeMsgId = null;
  activeUtterance = null;
  paused = false;
}

/** Current playback state for a given message id. */
export function getPlaybackState(msgId: string): PlaybackState {
  if (activeMsgId !== msgId) return 'idle';
  return paused ? 'paused' : 'playing';
}

/** Speaks arbitrary text tied to a message id (used by the per-message buttons). */
export function speakText(text: string, msgId: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  try {
    window.speechSynthesis.cancel();
    releaseWakeLock();
    const u = buildUtterance(clean);
    activeMsgId = msgId;
    activeUtterance = u;
    paused = false;
    speakUtterance(u, () => { if (activeUtterance === u) clearActive(); });
    emitPlayback(msgId, 'playing');
  } catch (e) {
    console.error('TTS error:', e);
    clearActive();
  }
}

/**
 * Play/pause toggle for a message: pauses if it is playing, resumes if paused,
 * otherwise cancels any current speech and plays this message.
 */
export function togglePlayPause(text: string, msgId: string): PlaybackState {
  if (typeof window === 'undefined' || !window.speechSynthesis) return 'idle';
  if (activeMsgId === msgId && !paused) {
    window.speechSynthesis.pause();
    paused = true;
    emitPlayback(msgId, 'paused');
  } else if (activeMsgId === msgId && paused) {
    window.speechSynthesis.resume();
    paused = false;
    emitPlayback(msgId, 'playing');
  } else {
    speakText(text, msgId);
  }
  return getPlaybackState(msgId);
}

/** Returns the browser's available voices, refreshing the cache if needed. */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  if (cachedVoices.length === 0) {
    cachedVoices = window.speechSynthesis.getVoices();
  }
  return cachedVoices;
}

/** Refreshes the voice cache (call on the 'voiceschanged' event). */
export function refreshVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

/** True when TTS is enabled in settings and the browser supports speech synthesis. */
export function isTtsEnabled(): boolean {
  return !!getUISettings().ttsEnabled && typeof window !== 'undefined' && !!window.speechSynthesis;
}

/** Strips markdown/HTML/URLs so the spoken text sounds natural. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')          // code blocks
    .replace(/`([^`]*)`/g, '$1')              // inline code
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // markdown links -> label text
    .replace(/[*_~#>|]/g, ' ')                // markdown symbols
    .replace(/<[^>]+>/g, ' ')                 // html tags
    .replace(/https?:\/\/\S+/g, 'link')       // urls
    .replace(/\s+/g, ' ')
    .trim();
}

/** Builds an utterance from the current TTS settings. */
function buildUtterance(text: string): SpeechSynthesisUtterance {
  const s = getUISettings();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getAvailableVoices().find(v => v.voiceURI === s.ttsVoiceURI);
  if (voice) utterance.voice = voice;
  utterance.rate = s.ttsRate || 1;
  utterance.pitch = s.ttsPitch || 1;
  utterance.volume = 1;
  return utterance;
}

/** Speaks a finished DM message aloud (no-op unless TTS is enabled). */
export function speakModelMessage(text: string): void {
  if (!isTtsEnabled() || !text) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  try {
    clearActive();
    window.speechSynthesis.cancel();
    releaseWakeLock();
    speakUtterance(buildUtterance(clean));
  } catch (e) {
    console.error('TTS error:', e);
  }
}

/** Stops any ongoing speech (e.g., when the user sends a new message). */
export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  speechActive = false;
  releaseWakeLock();
  clearActive();
}

/** Speaks a sample phrase so the user can preview the selected voice/settings. */
export function testTts(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    alert('Speech synthesis is not available in this browser.');
    return;
  }
  try {
    window.speechSynthesis.cancel();
    releaseWakeLock();
    speakUtterance(buildUtterance('Hello adventurer! This is how your Dungeon Master will sound.'));
  } catch (e) {
    console.error('TTS test error:', e);
    alert(`TTS test failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}