'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { clientApi } from '@/lib/client-api';
import type {
  AdminActionResponse,
  AdminUserDetail,
} from '@/types/admin';

/**
 * Right-rail action panel on the user-detail page.
 *
 * Each button confirms via a Dialog before posting. On success we toast
 * + refresh the route (Next.js re-renders the server component, which
 * re-fetches the detail payload with the new audit row included).
 *
 * Self-toggle and self-soft-delete are disabled at the UI here AND
 * rejected at the API — defence in depth.
 */
export function UserActions({
  detail,
  isSelf,
}: {
  detail: AdminUserDetail;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState<ActionKind | null>(null);
  const [pending, setPending] = useState(false);

  const run = async (kind: ActionKind) => {
    setPending(true);
    try {
      let path = `/admin/users/${detail.id}/`;
      let extra = '';
      switch (kind) {
        case 'sign_out':
          path += 'sign-out';
          break;
        case 'toggle_admin':
          path += 'admin';
          extra = `?value=${!detail.is_admin}`;
          break;
        case 'verify_email':
          path += 'verify-email';
          break;
        case 'soft_delete':
          path += 'soft-delete';
          break;
        case 'send_reset':
          path += 'send-password-reset';
          break;
      }
      const result = await clientApi<AdminActionResponse>(`${path}${extra}`, {
        method: 'POST',
      });
      toast.success(result.message);
      setActive(null);
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Something went wrong; please retry.';
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  const alreadyDeleted = detail.deleted_at !== null;

  return (
    <div className="rounded-md border border-rule bg-paper p-4">
      <h2 className="text-sm font-medium text-ink">Actions</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Every action is recorded in the audit log.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActive('sign_out')}
          disabled={pending || alreadyDeleted}
        >
          Force sign-out
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActive('toggle_admin')}
          disabled={pending || isSelf || alreadyDeleted}
          title={isSelf ? 'You cannot toggle your own admin status' : undefined}
        >
          {detail.is_admin ? 'Revoke admin' : 'Grant admin'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActive('verify_email')}
          disabled={pending || detail.email_verified || alreadyDeleted}
        >
          Force email-verify
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setActive('send_reset')}
          disabled={pending || !detail.email || alreadyDeleted}
        >
          Send password reset
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => setActive('soft_delete')}
          disabled={pending || isSelf || alreadyDeleted}
          title={
            isSelf ? 'You cannot soft-delete yourself' : undefined
          }
        >
          Soft-delete
        </Button>
      </div>

      <ConfirmDialog
        action={active}
        detail={detail}
        pending={pending}
        onClose={() => (pending ? null : setActive(null))}
        onConfirm={() => active && run(active)}
      />
    </div>
  );
}

type ActionKind =
  | 'sign_out'
  | 'toggle_admin'
  | 'verify_email'
  | 'send_reset'
  | 'soft_delete';

function ConfirmDialog({
  action,
  detail,
  pending,
  onClose,
  onConfirm,
}: {
  action: ActionKind | null;
  detail: AdminUserDetail;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (action === null) return null;

  const who = detail.name || detail.email || 'this user';
  const copy: Record<ActionKind, { title: string; body: string; cta: string }> = {
    sign_out: {
      title: 'Force sign-out?',
      body: `Revoke every active session for ${who}. Existing JWTs remain valid until expiry (≤15 min).`,
      cta: 'Sign out',
    },
    toggle_admin: {
      title: detail.is_admin ? 'Revoke admin?' : 'Grant admin?',
      body: detail.is_admin
        ? `${who} will lose access to /dashboard/admin/*.`
        : `${who} will gain full admin access immediately.`,
      cta: detail.is_admin ? 'Revoke admin' : 'Grant admin',
    },
    verify_email: {
      title: 'Mark email verified?',
      body: `Force email_verified=true for ${who}. Use only if the user is stuck on a bouncing email.`,
      cta: 'Mark verified',
    },
    send_reset: {
      title: 'Send password reset?',
      body: `Trigger Better Auth's password-reset flow to ${detail.email}. The user receives a 1-hour reset link.`,
      cta: 'Send email',
    },
    soft_delete: {
      title: 'Soft-delete user?',
      body: `Mark ${who} as deleted and tombstone all their shares. Reversible by an admin via SQL — there is no UI to undo this yet.`,
      cta: 'Soft-delete',
    },
  };
  const meta = copy[action];

  return (
    <Dialog open={action !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <div className="space-y-2">
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.body}</DialogDescription>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={action === 'soft_delete' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Working…' : meta.cta}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
