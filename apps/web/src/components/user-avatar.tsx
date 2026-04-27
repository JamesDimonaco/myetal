'use client';

import { useState } from 'react';

function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
}

interface UserAvatarProps {
  name: string | null;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}

/**
 * Circular avatar. Shows the user's OAuth profile image if available,
 * otherwise falls back to initials on a coloured background.
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = 32,
  className = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const showImage = avatarUrl && !imgError;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-rule ${
        showImage ? '' : 'bg-accent-soft text-accent'
      } ${className}`}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt={name ?? 'User avatar'}
          width={size}
          height={size}
          className="h-full w-full rounded-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span
          className="select-none font-medium leading-none"
          style={{ fontSize: size * 0.4 }}
        >
          {getInitials(name)}
        </span>
      )}
    </span>
  );
}
