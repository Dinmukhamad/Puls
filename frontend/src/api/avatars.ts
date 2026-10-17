import { request } from "./client";

export interface AvatarData { image: string | null }

// Scope photos to the signed-in account; never reuse cached images after a switch.
export const avatarQueryKey = (viewerId: number, userId: number) => ["user-avatar", viewerId, userId] as const;

export const avatars = {
  get: (userId: number, signal?: AbortSignal) => request<AvatarData>(`/api/v1/auth/avatars/${userId}`, { signal }),
  save: (userId: number | null, file: File) => {
    const multipart = new FormData();
    multipart.append("file", file);
    return request<AvatarData>(userId === null ? "/api/v1/auth/avatar" : `/api/v1/admin/users/${userId}/avatar`, { method: "PUT", multipart, timeoutMs: 30000 });
  },
  remove: (userId: number | null) => request<AvatarData>(userId === null ? "/api/v1/auth/avatar" : `/api/v1/admin/users/${userId}/avatar`, { method: "DELETE" }),
};
