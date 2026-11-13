export function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    const versioned = letter === 'x' ? value : (value & 3) | 8;
    return versioned.toString(16);
  });
}

export function safeFileId(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return id || 'bedrock_starter';
}

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/**
 * Computes deterministic, high-contrast, vanilla-accurate two-tone spawn egg colors
 * so Bedrock spawn eggs never render as pure black (#000000) or murky dark silhouettes in the hotbar.
 */
export function generateEggColors(mobId: string): { base: string; overlay: string } {
  const cleanId = mobId.toLowerCase().replace(/_(spawn_)?egg$/, '').replace(/[^a-z0-9]+/g, '_');
  let hash = 0;
  for (let i = 0; i < cleanId.length; i++) {
    hash = (hash * 31 + cleanId.charCodeAt(i)) & 0xffffff;
  }
  const low = cleanId;
  if (low.includes('fire') || low.includes('hell') || low.includes('magma') || low.includes('flame') || low.includes('scorch') || low.includes('doom') || low.includes('pyro')) {
    return { base: '#EA580C', overlay: '#FDE047' };
  }
  if (low.includes('ice') || low.includes('frost') || low.includes('cold') || low.includes('snow') || low.includes('crystal')) {
    return { base: '#0284C7', overlay: '#E0F2FE' };
  }
  if (low.includes('poison') || low.includes('acid') || low.includes('toxic') || low.includes('ooze') || low.includes('slime')) {
    return { base: '#16A34A', overlay: '#BEF264' };
  }
  if (low.includes('demon') || low.includes('boss') || low.includes('asylum') || low.includes('capra')) {
    return { base: '#DC2626', overlay: '#FDE047' };
  }
  if (low.includes('pinwheel')) {
    return { base: '#B91C1C', overlay: '#F8FAFC' };
  }
  if (low.includes('titanite') || low.includes('golem')) {
    return { base: '#0284C7', overlay: '#F0FDF4' };
  }
  if (low.includes('artorias') || low.includes('abyss')) {
    return { base: '#4338CA', overlay: '#A5B4FC' };
  }
  if (low.includes('butterfly') || low.includes('moonlight')) {
    return { base: '#7C3AED', overlay: '#93C5FD' };
  }
  if (low.includes('gargoyle')) {
    return { base: '#64748B', overlay: '#38BDF8' };
  }
  if (low.includes('undead') || low.includes('skeleton') || low.includes('hollow')) {
    return { base: '#2563EB', overlay: '#93C5FD' };
  }
  if (low.includes('knight') || low.includes('soldier') || low.includes('warrior') || low.includes('balder')) {
    return { base: '#0369A1', overlay: '#FBBF24' };
  }
  if (low.includes('bee') || low.includes('honey') || low.includes('wasp')) {
    return { base: '#EAB308', overlay: '#78350F' };
  }
  if (low.includes('copter') || low.includes('plane') || low.includes('machine') || low.includes('tank') || low.includes('drone')) {
    return { base: '#0284C7', overlay: '#38BDF8' };
  }
  if (low.includes('rat') || low.includes('rodent') || low.includes('hog') || low.includes('mouflon')) {
    return { base: '#D97706', overlay: '#FEF3C7' };
  }
  if (low.includes('lizard') || low.includes('serpent')) {
    return { base: '#059669', overlay: '#6EE7B7' };
  }
  if (low.includes('mushroom')) {
    return { base: '#C2410C', overlay: '#FDE047' };
  }
  const baseHue = Math.abs(hash) % 360;
  const overlayHue = (baseHue + 75 + (Math.abs(hash >> 8) % 50)) % 360;
  return {
    base: hslToHex(baseHue, 80, 50),
    overlay: hslToHex(overlayHue, 95, 78),
  };
}