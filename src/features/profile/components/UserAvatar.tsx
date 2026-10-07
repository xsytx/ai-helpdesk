import { useAuth } from "@/app/AuthContext";
import { Avatar } from "@/shared/ui/Avatar";
import { useUserAvatar } from "../api";
import { resolveAvatarSrc } from "../avatars";

interface UserAvatarProps {
  /** Author of the content; the saved picture is shown only when it's the current user. */
  userId?: string;
  name: string;
  className?: string;
}

/**
 * Avatar that shows the current user's chosen picture. Other users fall back to
 * initials until the API returns their avatarId alongside posts.
 */
export function UserAvatar({ userId, name, className }: UserAvatarProps) {
  const { user } = useAuth();
  const { data: avatarId } = useUserAvatar();
  const isMe = user != null && (userId === undefined || userId === user.id);
  return <Avatar name={name} src={isMe ? resolveAvatarSrc(avatarId) : undefined} className={className} />;
}
