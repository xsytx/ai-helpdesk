import { useAuth } from "@/app/AuthContext";
import { Avatar } from "@/shared/ui/Avatar";
import { resolveAvatarSrc } from "../avatars";

interface UserAvatarProps {
  /** Who it is; without it (or for the current user) the signed-in user's own avatar is shown. */
  userId?: string;
  name: string;
  /** The person's avatar as the server sent it with the post ("" = initials). */
  avatar?: string;
  className?: string;
}

/** A person's picture: their avatar, or their initials. */
export function UserAvatar({ userId, name, avatar, className }: UserAvatarProps) {
  const { user } = useAuth();
  const isMe = user != null && (userId === undefined || userId === user.id);
  // For yourself the freshest value is your own account (just changed in Settings).
  const value = isMe ? user.avatar : avatar;
  return <Avatar name={name} src={resolveAvatarSrc(value)} className={className} />;
}
