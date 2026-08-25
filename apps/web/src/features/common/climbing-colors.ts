export const climbingColorOptions = [
  { value: 'BLACK', label: '黑色', css: '#202623' },
  { value: 'WHITE', label: '白色', css: '#F7F7F2' },
  { value: 'GRAY', label: '灰色', css: '#8A918D' },
  { value: 'RED', label: '红色', css: '#E34A4A' },
  { value: 'ORANGE', label: '橙色', css: '#F28C28' },
  { value: 'YELLOW', label: '黄色', css: '#E3B91F' },
  { value: 'GREEN', label: '绿色', css: '#2EAD68' },
  { value: 'BLUE', label: '蓝色', css: '#3478D4' },
  { value: 'PURPLE', label: '紫色', css: '#7654C6' },
  { value: 'PINK', label: '粉色', css: '#E66D9C' },
  { value: 'BROWN', label: '棕色', css: '#8A5A3B' },
] as const;

export type ClimbingColor = (typeof climbingColorOptions)[number]['value'];

const labels = Object.fromEntries(
  climbingColorOptions.map(({ value, label }) => [value, label]),
) as Record<ClimbingColor, string>;

const cssColors = Object.fromEntries(
  climbingColorOptions.map(({ value, css }) => [value, css]),
) as Record<ClimbingColor, string>;

export const climbingColorLabel = (color: ClimbingColor) => labels[color];
export const climbingColorCss = (color: ClimbingColor) => cssColors[color];
