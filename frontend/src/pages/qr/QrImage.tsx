import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export function QrImage({ payload }: { payload: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (canvas.current) void QRCode.toCanvas(canvas.current, payload, {
      width: 320, margin: 4, errorCorrectionLevel: "M", color: { dark: "#12172D", light: "#FFFFFF" },
    }).catch(() => setFailed(true));
  }, [payload]);
  return failed ? <p role="alert">Не удалось нарисовать QR. Передайте код сотруднику через ручной ввод.</p> : <canvas ref={canvas} className="qr-image" role="img" aria-label="QR-код для подтверждения доступа к Рабочим сайтам" />;
}
