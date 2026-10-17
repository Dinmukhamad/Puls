import { createContext, type ReactNode } from "react";

// Standalone Avatar renders (including public pages) keep the initials fallback.
export const AvatarViewerContext = createContext<((userId: number) => ReactNode) | null>(null);
