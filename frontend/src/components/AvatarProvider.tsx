import { useMemo, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { AvatarViewerContext } from "./avatarContext";
import { AvatarPhoto } from "./AvatarPhoto";

export function AvatarProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const viewerId = user?.id;
  const photo = useMemo(() => viewerId === undefined ? null : (userId: number) => <AvatarPhoto viewerId={viewerId} userId={userId} />, [viewerId]);
  return <AvatarViewerContext.Provider value={photo}>{children}</AvatarViewerContext.Provider>;
}
