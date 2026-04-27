import { ImageResponse } from 'next/og';

import { api, ApiError } from '@/lib/api';
import type { PublicShareResponse } from '@/types/share';

export const alt = 'MyEtAl collection';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  let title = 'Collection';
  let ownerName: string | null = null;
  let itemCount = 0;

  try {
    const share = await api<PublicShareResponse>(
      `/public/c/${encodeURIComponent(code)}`,
      { next: { revalidate: 300 } },
    );
    title = share.name;
    ownerName = share.owner_name;
    itemCount = share.items.length;
  } catch (err) {
    if (err instanceof ApiError && (err.isNotFound || err.status === 410)) {
      title = 'Collection not found';
    }
  }

  const itemLabel = itemCount === 1 ? '1 paper' : `${itemCount} papers`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#FAFAF7',
          padding: '60px 72px',
        }}
      >
        {/* Top section: title + author */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: '#1A1A1A',
              lineHeight: 1.2,
              maxWidth: '900px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
          {ownerName ? (
            <div
              style={{
                marginTop: '20px',
                fontSize: 28,
                color: '#6B6B6B',
              }}
            >
              by {ownerName}
            </div>
          ) : null}
        </div>

        {/* Bottom section: count + branding */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              fontSize: 24,
              color: '#6B6B6B',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {itemLabel}
          </div>
          <div
            style={{
              fontSize: 24,
              color: '#1A1A1A',
              fontWeight: 600,
            }}
          >
            myetal.app
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
