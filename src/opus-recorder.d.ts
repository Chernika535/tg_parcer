declare module "opus-recorder" {
  interface RecorderConfig {
    encoderPath?: string;
    numberOfChannels?: number;
    encoderApplication?: number;
    encoderSampleRate?: number;
    streamPages?: boolean;
    recordingGain?: number;
  }
  export default class Recorder {
    constructor(config?: RecorderConfig);
    audioContext: AudioContext;
    sourceNode: MediaStreamAudioSourceNode;
    stream: MediaStream;
    ondataavailable: (data: Uint8Array) => void;
    start(): Promise<void>;
    stop(): Promise<void>;
    pause(): void;
    resume(): void;
    close(): void;
    static isRecordingSupported(): boolean;
  }
}
