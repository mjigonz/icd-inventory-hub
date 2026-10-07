import React, { useEffect, useRef, useState } from 'react';
import { X, Flashlight, FlashlightOff, Camera, AlertCircle } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [torchAvailable, setTorchAvailable] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isScanningRef = useRef<boolean>(false);

  // Play subtle feedback beep
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch {}

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([60]);
      } catch {}
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    let localStream: MediaStream | null = null;
    isScanningRef.current = true;
    setErrorMsg(null);

    async function initCamera() {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        localStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play();
        }

        // Check if torch/flashlight is supported
        const track = mediaStream.getVideoTracks()[0];
        if (track) {
          const capabilities = (track as any).getCapabilities?.() || {};
          if (capabilities.torch) {
            setTorchAvailable(true);
          }
        }

        // Initialize ZXing Browser Multi-Format Reader
        const codeReader = new BrowserMultiFormatReader();
        zxingReaderRef.current = codeReader;

        // Continuous scanning loop
        const scanLoop = async () => {
          if (!isScanningRef.current) return;

          if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
            try {
              const result = await codeReader.decodeOnceFromVideoElement(videoRef.current);
              if (result && result.getText()) {
                const scannedText = result.getText().trim();
                playBeep();
                onScan(scannedText);
                onClose();
                return;
              }
            } catch (err: any) {
              // NotFoundException is expected per frame when no barcode is in view
            }
          }

          if (isScanningRef.current) {
            animationFrameRef.current = requestAnimationFrame(scanLoop);
          }
        };

        animationFrameRef.current = requestAnimationFrame(scanLoop);
      } catch (err: any) {
        console.error('Camera init error:', err);
        setErrorMsg(
          err.name === 'NotAllowedError'
            ? 'Camera access denied. Please grant camera permissions in your browser settings.'
            : 'Unable to start camera. Please verify your device has a working camera.'
        );
      }
    }

    initCamera();

    return () => {
      isScanningRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (zxingReaderRef.current) {
        zxingReaderRef.current = null;
      }
    };
  }, [isOpen, onScan, onClose]);

  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextState = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch (e) {
      console.warn('Torch constraint error:', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-between p-4 animate-in fade-in duration-200">
      {/* Top Header Bar */}
      <div className="w-full max-w-md flex items-center justify-between text-white py-2 z-10">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-blue-400" />
          <span className="font-bold text-sm">Scan Barcode</span>
        </div>

        <div className="flex items-center gap-3">
          {torchAvailable && (
            <button
              onClick={toggleTorch}
              className={`p-2.5 rounded-full transition cursor-pointer ${
                torchOn ? 'bg-blue-600 text-white font-bold' : 'bg-slate-800 text-white'
              }`}
              title="Toggle Flashlight"
            >
              {torchOn ? <Flashlight className="w-5 h-5" /> : <FlashlightOff className="w-5 h-5" />}
            </button>
          )}

          <button
            onClick={onClose}
            className="p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-white transition active:scale-95 cursor-pointer"
            title="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Camera Viewfinder & Aiming Frame */}
      <div className="relative w-full max-w-md flex-1 my-2 rounded-3xl overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-800">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />

        {errorMsg ? (
          <div className="relative z-10 p-6 text-center text-rose-300 bg-rose-950/80 rounded-2xl border border-rose-800 m-4">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
            <p className="text-xs leading-relaxed">{errorMsg}</p>
          </div>
        ) : (
          <div className="relative z-10 flex flex-col items-center">
            {/* Viewfinder Rect */}
            <div className="relative w-64 h-48 sm:w-72 sm:h-52 border-2 border-blue-500/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
              {/* Corner Accents */}
              <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />

              {/* Animated Laser Scanning Line */}
              <div className="absolute left-2 right-2 h-0.5 bg-blue-500 shadow-[0_0_8px_#3b82f6] animate-bounce" />
            </div>

            <p className="mt-6 text-xs text-white/90 font-medium px-4 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-xs border border-white/10 shadow-sm">
              Align retail barcode inside the frame
            </p>
          </div>
        )}
      </div>

      {/* Bottom Hint */}
      <div className="w-full max-w-md text-center py-2 text-slate-400 text-xs">
        <p>Supports EAN-13, UPC-A, Code 128 &amp; standard retail codes</p>
      </div>
    </div>
  );
};
