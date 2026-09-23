import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "../../components/ui";

export function QrScanner({ onRead }: { onRead: (payload: string) => void }) {
  const video = useRef<HTMLVideoElement>(null), reader = useRef(onRead);
  reader.current = onRead;
  const [failure, setFailure] = useState(""), [ready, setReady] = useState(false), [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => { const change = () => setVisible(!document.hidden); document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false, stream: MediaStream | undefined, timer = 0;
    setFailure(""); setReady(false);
    const release = () => { stream?.getTracks().forEach(track => track.stop()); if (video.current && video.current.srcObject === stream) video.current.srcObject = null; };
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d", { willReadFrequently: true });
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (cancelled || !video.current) { release(); return; }
        video.current.srcObject = stream; await video.current.play();
        if (cancelled) { release(); return; }
        setReady(true);
        const scan = () => {
          if (cancelled) return;
          const source = video.current;
          if (context && source && source.readyState >= 2 && source.videoWidth) {
            const scale = Math.min(1, 1280 / Math.max(source.videoWidth, source.videoHeight));
            canvas.width = Math.round(source.videoWidth * scale); canvas.height = Math.round(source.videoHeight * scale);
            context.drawImage(source, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
            if (qr) { release(); reader.current(qr.data); return; }
          }
          timer = window.setTimeout(scan, 300);
        };
        scan();
      } catch (error) {
        release();
        if (!cancelled) setFailure(error instanceof DOMException && error.name === "NotAllowedError" ? "Камера недоступна. Разрешите доступ к ней в настройках браузера или используйте ручной ввод кода." : "Не удалось включить камеру. Проверьте подключение камеры или используйте ручной ввод.");
      }
    }
    void start();
    return () => { cancelled = true; window.clearTimeout(timer); release(); };
  }, [attempt, visible]);
  return <div className="qr-camera"><video ref={video} autoPlay playsInline muted aria-label="Сканер QR-кода" /><div className="qr-camera-frame" aria-hidden="true" />
    {failure ? <div className="qr-camera-message" role="alert"><p>{failure}</p><Button onClick={() => setAttempt(n => n + 1)}>Повторить</Button></div> : <p className="qr-camera-hint" role="status">{ready ? "Наведите камеру на QR-код оператора" : "Включаем камеру…"}</p>}
  </div>;
}
