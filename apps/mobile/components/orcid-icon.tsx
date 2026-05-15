/**
 * ORCID iD logo — official brand SVG.
 *
 * Replaces the earlier View+Text approximation now that react-native-svg
 * is installed. Path data matches the web equivalent at
 * apps/web/src/components/orcid-icon.tsx (single source of truth for the
 * brand mark).
 *
 * Source: https://info.orcid.org/brand-guidelines/
 */
import Svg, { Circle, Path } from 'react-native-svg';

interface OrcidIconProps {
  size?: number;
}

const ORCID_GREEN = '#A6CE39';

export function OrcidIcon({ size = 18 }: OrcidIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256">
      {/* Brand-green disc */}
      <Circle cx="128" cy="128" r="128" fill={ORCID_GREEN} />
      {/* The 'i' stem */}
      <Path fill="#FFFFFF" d="M86.3,186.2H70.9V79.1h15.4V186.2z" />
      {/* The 'D' bowl */}
      <Path
        fill="#FFFFFF"
        d="M108.9,79.1h41.6c39.6,0,57,28.3,57,53.6c0,27.5-21.5,53.6-56.8,53.6h-41.8V79.1z M124.3,172.4h24.5c34.9,0,42.9-26.5,42.9-39.7c0-21.5-13.7-39.7-43.7-39.7h-23.7V172.4z"
      />
      {/* The 'i' dot */}
      <Path
        fill="#FFFFFF"
        d="M88.7,56.8c0,5.5-4.5,10.1-10.1,10.1c-5.6,0-10.1-4.6-10.1-10.1c0-5.6,4.5-10.1,10.1-10.1C84.2,46.7,88.7,51.3,88.7,56.8z"
      />
    </Svg>
  );
}
