import {
  AsrApiCode,
  AsrLangType,
  type AsrRecognizeData,
} from '../../shared/asr/constants';
import { i18nService } from './i18n';

const TARGET_SAMPLE_RATE = 16000;
export const ASR_MAX_RECORDING_MS = 60_000;

type AudioContextConstructor = typeof AudioContext;

export class AsrClientError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
    this.name = 'AsrClientError';
  }
}

export interface VoiceRecordingSession {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

const resolveAudioContext = (): AudioContextConstructor | null => {
  const windowWithWebkit = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? windowWithWebkit.webkitAudioContext ?? null;
};

const mergeAudioChunks = (chunks: Float32Array[]): Float32Array => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
};

const resampleLinear = (
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array => {
  if (sourceSampleRate === targetSampleRate) {
    return input;
  }
  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = sourceIndex - leftIndex;
    const left = input[leftIndex] ?? 0;
    const right = input[rightIndex] ?? left;
    output[i] = left + (right - left) * fraction;
  }
  return output;
};

const writeString = (view: DataView, offset: number, value: string): void => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};

const encodePcm16Wav = (samples: Float32Array, sampleRate: number): Blob => {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const startVoiceRecording = async (): Promise<VoiceRecordingSession> => {
  const AudioContextImpl = resolveAudioContext();
  if (!AudioContextImpl || !navigator.mediaDevices?.getUserMedia) {
    throw new AsrClientError(i18nService.t('voiceInputMicrophoneUnavailable'));
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioContext = new AudioContextImpl();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const mutedOutput = audioContext.createGain();
  mutedOutput.gain.value = 0;
  const chunks: Float32Array[] = [];
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(mutedOutput);
  mutedOutput.connect(audioContext.destination);

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    processor.disconnect();
    source.disconnect();
    mutedOutput.disconnect();
    stream.getTracks().forEach((track) => track.stop());
  };

  return {
    stop: async () => {
      cleanup();
      await audioContext.close();
      const merged = mergeAudioChunks(chunks);
      if (merged.length === 0) {
        throw new AsrClientError(i18nService.t('voiceInputNoAudioCaptured'));
      }
      const resampled = resampleLinear(merged, audioContext.sampleRate, TARGET_SAMPLE_RATE);
      return encodePcm16Wav(resampled, TARGET_SAMPLE_RATE);
    },
    cancel: () => {
      cleanup();
      void audioContext.close();
    },
  };
};

const getFallbackAsrErrorMessage = (code?: number): string => {
  switch (code) {
    case AsrApiCode.Unauthorized:
      return i18nService.t('voiceInputLoginRequired');
    case AsrApiCode.AudioInvalid:
      return i18nService.t('voiceInputAudioInvalid');
    case AsrApiCode.AudioTooLarge:
      return i18nService.t('voiceInputAudioTooLarge');
    case AsrApiCode.AudioTooLong:
      return i18nService.t('voiceInputAudioTooLong');
    case AsrApiCode.DailyLimitExceeded:
      return i18nService.t('voiceInputDailyLimitExceeded');
    case AsrApiCode.UpstreamRateLimited:
      return i18nService.t('voiceInputRateLimited');
    case AsrApiCode.RecognitionFailed:
      return i18nService.t('voiceInputRecognitionFailed');
    case AsrApiCode.ConfigInvalid:
    case AsrApiCode.UpstreamAuthFailed:
    case AsrApiCode.UpstreamError:
    case AsrApiCode.UpstreamBalanceInsufficient:
    case AsrApiCode.UpstreamInvalidParams:
      return i18nService.t('voiceInputServiceUnavailable');
    default:
      return i18nService.t('voiceInputFailed');
  }
};

export const getAsrErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return i18nService.t('voiceInputMicrophoneDenied');
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return i18nService.t('voiceInputMicrophoneUnavailable');
  }
  if (error instanceof AsrClientError) {
    return error.message || getFallbackAsrErrorMessage(error.code);
  }
  return i18nService.t('voiceInputFailed');
};

export const recognizeVoiceInput = async (wavBlob: Blob): Promise<AsrRecognizeData> => {
  const audioBase64 = await blobToBase64(wavBlob);
  const result = await window.electron.asr.recognize({
    audioBase64,
    fileName: 'voice-input.wav',
    // TODO: The current product is China-first. Revisit langType selection for international releases.
    langType: AsrLangType.ZhChs,
  });
  if (!result.success) {
    throw new AsrClientError(
      result.message || result.error || getFallbackAsrErrorMessage(result.code),
      result.code,
    );
  }
  if (!result.data.text.trim()) {
    throw new AsrClientError(getFallbackAsrErrorMessage(AsrApiCode.RecognitionFailed), AsrApiCode.RecognitionFailed);
  }
  return result.data;
};
