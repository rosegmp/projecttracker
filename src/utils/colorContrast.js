const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#000000';

function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) return null;

  const expanded = hex.length <= 4
    ? hex.slice(0, 3).split('').map((channel) => `${channel}${channel}`)
    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];

  return expanded.map((channel) => Number.parseInt(channel, 16));
}

function linearizeChannel(channel) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function getRelativeLuminance(color) {
  const rgb = parseHexColor(color);
  if (!rgb) return null;
  const [red, green, blue] = rgb.map(linearizeChannel);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

export function getContrastRatio(firstColor, secondColor) {
  const first = getRelativeLuminance(firstColor);
  const second = getRelativeLuminance(secondColor);
  if (first === null || second === null) return null;
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getReadableTextColor(backgroundColor) {
  const lightContrast = getContrastRatio(backgroundColor, LIGHT_TEXT);
  const darkContrast = getContrastRatio(backgroundColor, DARK_TEXT);
  if (lightContrast === null || darkContrast === null) return LIGHT_TEXT;
  return darkContrast >= lightContrast ? DARK_TEXT : LIGHT_TEXT;
}
