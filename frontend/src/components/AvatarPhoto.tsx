import { useQuery } from "@tanstack/react-query";
import { avatarQueryKey, avatars } from "../api/avatars";
import { AvatarImage } from "./AvatarImage";

export function AvatarPhoto({ viewerId, userId }: { viewerId: number; userId: number }) {
  const photo = useQuery({
    queryKey: avatarQueryKey(viewerId, userId),
    queryFn: ({ signal }) => avatars.get(userId, signal),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return photo.data?.image ? <AvatarImage src={photo.data.image} /> : null;
}
