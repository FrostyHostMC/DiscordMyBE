import {
  BINARY_RULES,
  callMolangFunction,
  getMockMolangValue,
  tokenizeMolang,
  type MockEntityState,
} from '@/utils/molangSandboxHelpers';

class MolangParser {
  private readonly tokens: string[];
  private cursor = 0;

  constructor(source: string, private readonly state: MockEntityState) {
    this.tokens = tokenizeMolang(source);
  }

  parse(): number {
    if (!this.tokens.length) throw new Error('Enter a Molang expression to test.');
    const result = this.expression();
    if (this.cursor !== this.tokens.length) throw new Error(`Unexpected token “${this.peek()}”.`);
    if (!Number.isFinite(result)) throw new Error('The expression produced a non-finite number.');
    return result;
  }

  private expression(minimum = 0): number {
    let left = this.unary();
    while (this.cursor < this.tokens.length) {
      if (this.peek() === '?' && minimum === 0) {
        this.cursor += 1;
        const yes = this.expression();
        this.expect(':');
        const no = this.expression();
        left = left !== 0 ? yes : no;
        continue;
      }
      const operator = this.peek() ?? '';
      const rule = Object.prototype.hasOwnProperty.call(BINARY_RULES, operator)
        ? BINARY_RULES[operator]
        : undefined;
      if (!rule || rule.precedence < minimum) break;
      this.cursor += 1;
      const right = this.expression(rule.precedence + (operator === '^' ? 0 : 1));
      left = rule.apply(left, right);
    }
    return left;
  }

  private unary(): number {
    if (this.accept('-')) return -this.unary();
    if (this.accept('+')) return this.unary();
    if (this.accept('!')) return Number(this.unary() === 0);
    return this.primary();
  }

  private primary(): number {
    const token = this.peek();
    if (!token) throw new Error('Expression ended unexpectedly.');
    if (this.accept('(')) {
      const value = this.expression();
      this.expect(')');
      return value;
    }
    if (/^(?:\d|\.)/.test(token)) {
      this.cursor += 1;
      return Number(token);
    }
    this.cursor += 1;
    if (!this.accept('(')) return getMockMolangValue(token, this.state);
    const args: number[] = [];
    if (!this.accept(')')) {
      do args.push(this.expression()); while (this.accept(','));
      this.expect(')');
    }
    return callMolangFunction(token, args);
  }

  private peek(): string | undefined {
    return this.tokens[this.cursor];
  }

  private accept(token: string): boolean {
    if (this.peek() !== token) return false;
    this.cursor += 1;
    return true;
  }

  private expect(token: string): void {
    if (!this.accept(token)) throw new Error(`Expected “${token}” in this expression.`);
  }
}

export function evaluateMolangExpression(source: string, state: MockEntityState): number {
  return new MolangParser(source, state).parse();
}