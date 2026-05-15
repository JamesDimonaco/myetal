import { ImageResponse } from 'next/og';

export const alt = 'MyEtAl — share your research with a QR';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
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
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 32,
              color: '#6B6B6B',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            MyEtAl
          </div>
          <div
            style={{
              marginTop: '32px',
              fontSize: 88,
              fontWeight: 700,
              color: '#1A1A1A',
              lineHeight: 1.05,
              maxWidth: '960px',
            }}
          >
            Share your research with a QR.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              fontSize: 26,
              color: '#6B6B6B',
              maxWidth: '780px',
              lineHeight: 1.4,
            }}
          >
            A paper. A reading list. A poster. One QR code that resolves to a
            clean, shareable page.
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
