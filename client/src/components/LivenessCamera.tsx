/**
 * LivenessCamera — WebRTC camera capture component for biometric verification.
 *
 * Features:
 *   - Live camera preview via getUserMedia
 *   - Single-frame capture (passive liveness)
 *   - Multi-frame capture (active liveness with challenges)
 *   - Countdown timer for guided capture
 *   - Face overlay guide (oval outline)
 *   - Flip/mirror control
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleDot, RotateCcw, Video, VideoOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LivenessCameraProps {
  /** Called with a single base64 frame (for passive liveness) */
  onCapture?: (base64: string) => void;
  /** Called with multiple base64 frames (for active liveness) */
  onMultiCapture?: (frames: string[]) => void;
  /** Active liveness mode — captures a sequence of frames */
  activeMode?: boolean;
  /** Number of frames to capture in active mode */
  frameCount?: number;
  /** Interval between frames in ms */
  frameInterval?: number;
  /** Show face guide overlay */
  showGuide?: boolean;
  /** Challenge instruction to display */
  challenge?: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Camera facing mode */
  facingMode?: "user" | "environment";
}

export function LivenessCamera({
  onCapture,
  onMultiCapture,
  activeMode = false,
  frameCount = 30,
  frameInterval = 200,
  showGuide = true,
  challenge,
  disabled = false,
  facingMode = "user",
}: LivenessCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mirrored, setMirrored] = useState(facingMode === "user");

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsStreaming(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      setError(msg);
    }
  }, [facingMode]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // Capture a single frame as base64
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isStreaming) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    if (mirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    if (mirrored) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  }, [isStreaming, mirrored]);

  // Single capture (passive mode)
  const handleSingleCapture = useCallback(() => {
    const frame = captureFrame();
    if (frame && onCapture) {
      onCapture(frame);
    }
  }, [captureFrame, onCapture]);

  // Multi-frame capture (active mode)
  const handleActiveCapture = useCallback(async () => {
    if (!isStreaming || isCapturing) return;
    setIsCapturing(true);
    setCapturedFrames(0);

    const frames: string[] = [];
    for (let i = 0; i < frameCount; i++) {
      const frame = captureFrame();
      if (frame) {
        frames.push(frame);
        setCapturedFrames(i + 1);
      }
      await new Promise((r) => setTimeout(r, frameInterval));
    }

    setIsCapturing(false);
    setCapturedFrames(0);
    if (onMultiCapture) {
      onMultiCapture(frames);
    }
  }, [isStreaming, isCapturing, frameCount, frameInterval, captureFrame, onMultiCapture]);

  return (
    <div className="relative w-full max-w-lg mx-auto">
      {/* Camera feed */}
      <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${mirrored ? "scale-x-[-1]" : ""}`}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Face guide overlay */}
        {showGuide && isStreaming && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-64 border-2 border-dashed border-white/60 rounded-[50%]" />
          </div>
        )}

        {/* Challenge instruction */}
        {challenge && isStreaming && (
          <div className="absolute top-4 left-0 right-0 text-center">
            <span className="bg-black/70 text-white px-4 py-2 rounded-full text-sm font-medium">
              {challenge}
            </span>
          </div>
        )}

        {/* Capture progress (active mode) */}
        {isCapturing && (
          <div className="absolute bottom-4 left-4 right-4">
            <div className="bg-black/70 rounded-full h-2 overflow-hidden">
              <div
                className="bg-green-500 h-full transition-all duration-200"
                style={{ width: `${(capturedFrames / frameCount) * 100}%` }}
              />
            </div>
            <p className="text-white text-xs text-center mt-1">
              Capturing... {capturedFrames}/{frameCount}
            </p>
          </div>
        )}

        {/* Recording indicator */}
        {isCapturing && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <CircleDot className="w-4 h-4 text-red-500 animate-pulse" />
            <span className="text-white text-xs font-medium">REC</span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center p-4">
              <AlertTriangle className="w-10 h-10 text-yellow-400 mx-auto mb-2" />
              <p className="text-white text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={startCamera} className="mt-3">
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Camera off state */}
        {!isStreaming && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <VideoOff className="w-12 h-12 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 mt-4">
        {!activeMode ? (
          <Button
            onClick={handleSingleCapture}
            disabled={!isStreaming || disabled}
            className="gap-2"
          >
            <Camera className="w-4 h-4" />
            Capture Photo
          </Button>
        ) : (
          <Button
            onClick={handleActiveCapture}
            disabled={!isStreaming || isCapturing || disabled}
            className="gap-2"
            variant={isCapturing ? "destructive" : "default"}
          >
            <Video className="w-4 h-4" />
            {isCapturing ? "Recording..." : "Start Liveness Check"}
          </Button>
        )}

        <Button
          variant="outline"
          size="icon"
          onClick={() => setMirrored(!mirrored)}
          title="Flip camera"
          aria-label="Flip camera"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={isStreaming ? stopCamera : startCamera}
          title={isStreaming ? "Stop camera" : "Start camera"}
          aria-label={isStreaming ? "Stop camera" : "Start camera"}
        >
          {isStreaming ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
