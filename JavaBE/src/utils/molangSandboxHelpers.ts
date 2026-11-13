export interface MockEntityState {
  health: number;
  velocity: number;
  time: number;
}

export interface BinaryRule {
  precedence: number;
  apply: (left: number, right: number) => number;
}

export const TOKEN_PATTERN = /\s*(\d+(?:\.\d*)?|\.\d+|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|&&|\|\||==|!=|<=|>=|[()+\-*/%^<>,?:!])/y;
export const BINARY_RULES: Record<string, BinaryRule> = {
  '||': { precedence: 1, apply: (a, b) => Number(a !== 0 || b !== 0) },
  '&&': { precedence: 2, apply: (a, b) => Number(a !== 0 && b !== 0) },
  '==': { precedence: 3, apply: (a, b) => Number(a === b) },
  '!=': { precedence: 3, apply: (a, b) => Number(a !== b) },
  '<': { precedence: 3, apply: (a, b) => Number(a < b) },
  '<=': { precedence: 3, apply: (a, b) => Number(a <= b) },
  '>': { precedence: 3, apply: (a, b) => Number(a > b) },
  '>=': { precedence: 3, apply: (a, b) => Number(a >= b) },
  '+': { precedence: 4, apply: (a, b) => a + b },
  '-': { precedence: 4, apply: (a, b) => a - b },
  '*': { precedence: 5, apply: (a, b) => a * b },
  '/': { precedence: 5, apply: (a, b) => a / b },
  '%': { precedence: 5, apply: (a, b) => a % b },
  '^': { precedence: 6, apply: (a, b) => Math.pow(a, b) },
};

export function tokenizeMolang(source: string): string[] {
  if (source.length > 240) throw new Error('Keep expressions under 240 characters.');
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length && source.slice(index).trim()) {
    TOKEN_PATTERN.lastIndex = index;
    const match = TOKEN_PATTERN.exec(source);
    if (!match) throw new Error(`Unexpected character near “${source.slice(index, index + 12)}”.`);
    tokens.push(match[1]);
    index = TOKEN_PATTERN.lastIndex;
    if (tokens.length > 128) throw new Error('Expression is too complex for this sandbox.');
  }
  return tokens;
}

export function getMockMolangValue(name: string, state: MockEntityState): number {
  const values: Record<string, number> = {
    'query.health': state.health,
    'query.velocity': state.velocity,
    'query.ground_speed': state.velocity,
    'query.movement_speed': state.velocity,
    'query.time': state.time,
    'query.life_time': state.time,
    'query.time_stamp': state.time,
    'query.is_alive': Number(state.health > 0),
    'variable.health': state.health,
    'variable.velocity': state.velocity,
    'variable.time': state.time,
  };
  if (!Object.prototype.hasOwnProperty.call(values, name)) {
    throw new Error(`Unknown mock value “${name}”. Try query.health, query.velocity, or query.time.`);
  }
  return values[name];
}

export function callMolangFunction(name: string, args: number[]): number {
  const [a = 0, b = 0, c = 0] = args;
  const unary: Record<string, (value: number) => number> = {
    'math.abs': Math.abs,
    'math.ceil': Math.ceil,
    'math.cos': (value) => Math.cos(value * Math.PI / 180),
    'math.floor': Math.floor,
    'math.round': Math.round,
    'math.sin': (value) => Math.sin(value * Math.PI / 180),
    'math.sqrt': Math.sqrt,
    'math.trunc': Math.trunc,
  };
  if (Object.prototype.hasOwnProperty.call(unary, name) && args.length === 1) return unary[name](a);
  if (name === 'math.pow' && args.length === 2) return Math.pow(a, b);
  if (name === 'math.min' && args.length > 0) return Math.min(...args);
  if (name === 'math.max' && args.length > 0) return Math.max(...args);
  if (name === 'math.mod' && args.length === 2) return a % b;
  if (name === 'math.clamp' && args.length === 3) return Math.max(b, Math.min(c, a));
  throw new Error(`Unsupported function or argument count: “${name}”.`);
}