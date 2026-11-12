import Svg, { Circle, Path } from 'react-native-svg';

type IconProps = { size?: number; color?: string };

export function EyeIcon({ size = 26, color = '#5C5C5C', crossed = false }: IconProps & { crossed?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
      {crossed ? <Path d="M3 3l18 18" /> : null}
    </Svg>
  );
}

export function ArrowIcon({ size = 22, color = '#111111', direction }: IconProps & { direction: 'in' | 'out' }) {
  // "in" points down-left (money arriving), "out" points up-right (money leaving).
  const d = direction === 'out' ? 'M7 17L17 7M9 7h8v8' : 'M17 7L7 17M15 17H7V9';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}
