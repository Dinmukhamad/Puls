import { useState } from "react";

export function AvatarImage({ src }: { src: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return src === failed ? null : <img className="avatar__photo" src={src} alt="" draggable={false} onError={() => setFailed(src)} />;
}
