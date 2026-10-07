import { useAuth } from "@/app/AuthContext";
import { apiClient, getErrorStatus } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// The backend has no avatar field yet, so avatars live in localStorage only.
// Once it does (PATCH /api/me with { avatar_id }), flip this to false.
const AVATAR_LOCAL_ONLY = true;

/** Map of userId → avatarId (preset id like "avatar3" or a data URL). */
const AVATAR_KEY = "ai_helpdesk_user_avatar";

export const profileKeys = {
  all: ["profile"] as const,
  avatar: (userId: string) => [...profileKeys.all, "avatar", userId] as const,
};

function readAvatarMap(): Record<string, string> {
  const raw = localStorage.getItem(AVATAR_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function fetchAvatar(userId: string): Promise<string | null> {
  if (AVATAR_LOCAL_ONLY) return readAvatarMap()[userId] ?? null;
  const { data } = await apiClient.get<{ avatar_id: string | null }>("/me");
  return data.avatar_id;
}

/** Current user's avatar id, or null when not set. */
export function useUserAvatar() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  return useQuery({
    queryKey: profileKeys.avatar(userId),
    queryFn: () => fetchAvatar(userId),
    enabled: Boolean(userId),
    staleTime: Infinity,
  });
}

export function useUpdateAvatar() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ avatarId }: { avatarId: string }) => {
      if (!user) throw new Error("unauthenticated");
      if (AVATAR_LOCAL_ONLY) {
        // setItem throws QuotaExceededError for oversized images — surfaces as a mutation error.
        localStorage.setItem(AVATAR_KEY, JSON.stringify({ ...readAvatarMap(), [user.id]: avatarId }));
        return avatarId;
      }
      const { data } = await apiClient.patch<{ avatar_id: string }>("/me", { avatar_id: avatarId });
      return data.avatar_id;
    },
    onSuccess: (avatarId) => {
      if (user) qc.setQueryData(profileKeys.avatar(user.id), avatarId);
    },
  });
}

/** Thrown when the server rejects the current password. */
export const WRONG_CURRENT_PASSWORD = "wrong-current-password";

export function usePasswordChange() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      try {
        await apiClient.post("/me/password", {
          current_password: input.currentPassword,
          new_password: input.newPassword,
        });
      } catch (err) {
        if (getErrorStatus(err) === 401) throw new Error(WRONG_CURRENT_PASSWORD);
        throw err;
      }
    },
  });
}
