import type { ExtractedZipEntry } from '@/utils/zip';
import { yieldToUi } from '@/utils/archiveScale';

export interface JvmConstantReference {
  index: number;
  tag: number;
  kind: string;
  owner?: string;
  name?: string;
  descriptor?: string;
  value?: string | number | bigint;
  referenceKind?: number;
  reference?: JvmConstantReference;
  bootstrapIndex?: number;
  bootstrapMethod?: JvmBootstrapMethod;
}

export interface JvmBootstrapMethod {
  methodReference: JvmConstantReference | undefined;
  arguments: JvmConstantReference[];
}

export interface JvmInstruction {
  offset: number;
  opcode: number;
  mnemonic: string;
  size: number;
  operands: number[];
  constant?: JvmConstantReference;
  branchTargets: number[];
}

export interface JvmBasicBlock {
  start: number;
  end: number;
  instructionOffsets: number[];
  successors: number[];
  exceptionalSuccessors: number[];
}

export interface JvmFieldIR {
  name: string;
  descriptor: string;
  access: number;
  constant?: JvmConstantReference;
}

export interface JvmMethodIR {
  name: string;
  descriptor: string;
  access: number;
  maxStack: number;
  maxLocals: number;
  instructions: JvmInstruction[];
  blocks: JvmBasicBlock[];
  calls: JvmConstantReference[];
  fieldAccesses: JvmConstantReference[];
  localVariables: Array<{ name: string; descriptor: string; index: number; start: number; length: number }>;
  exceptionHandlers: Array<{ start: number; end: number; handler: number; catchType?: string }>;
  codeLength: number;
  decodeWarnings: string[];
}

export interface JvmClassIR {
  path: string;
  name: string;
  superName?: string;
  interfaces: string[];
  access: number;
  majorVersion: number;
  minorVersion: number;
  fields: JvmFieldIR[];
  methods: JvmMethodIR[];
  references: JvmConstantReference[];
  bootstrapMethods: JvmBootstrapMethod[];
  decodeWarnings: string[];
}

export interface JvmArchiveAnalysisReport {
  classes: JvmClassIR[];
  totals: {
    classFiles: number;
    parsedClasses: number;
    malformedClasses: number;
    methods: number;
    methodsWithCode: number;
    instructions: number;
    basicBlocks: number;
    methodCalls: number;
    fieldAccesses: number;
    exceptionHandlers: number;
    dynamicCallSites: number;
    bootstrapMethods: number;
  };
  unresolvedClassFiles: string[];
  warnings: string[];
  complete: boolean;
}

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array, readonly view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)) {}
  need(n: number): void {
    if (!Number.isInteger(n) || n < 0 || this.offset + n > this.bytes.length) throw new Error('Unexpected end of class file');
  }
  u1(): number { this.need(1); return this.view.getUint8(this.offset++); }
  u2(): number { this.need(2); const n = this.view.getUint16(this.offset, false); this.offset += 2; return n; }
  u4(): number { this.need(4); const n = this.view.getUint32(this.offset, false); this.offset += 4; return n; }
  s2(): number { this.need(2); const n = this.view.getInt16(this.offset, false); this.offset += 2; return n; }
  s4(): number { this.need(4); const n = this.view.getInt32(this.offset, false); this.offset += 4; return n; }
  take(n: number): Uint8Array { this.need(n); const b = this.bytes.subarray(this.offset, this.offset + n); this.offset += n; return b; }
  skip(n: number): void { this.need(n); this.offset += n; }
  utf8(n: number): string {
    const raw = this.take(n);
    // CONSTANT_Utf8 uses modified UTF-8, not standard UTF-8: NUL is C0 80 and
    // supplementary characters are encoded as two UTF-16 surrogate code units.
    // Decode code units directly so Java identifiers/string constants survive intact.
    const units: number[] = [];
    for (let i = 0; i < raw.length;) {
      const a = raw[i++];
      if (a === 0) throw new Error('Invalid zero byte in modified UTF-8 constant');
      if (a < 0x80) units.push(a);
      else if ((a & 0xe0) === 0xc0) {
        if (i >= raw.length) throw new Error('Truncated modified UTF-8 sequence');
        const b = raw[i++];
        if ((b & 0xc0) !== 0x80) throw new Error('Invalid modified UTF-8 continuation');
        const value = ((a & 0x1f) << 6) | (b & 0x3f);
        if (value !== 0 && value < 0x80) throw new Error('Overlong modified UTF-8 sequence');
        units.push(value);
      } else if ((a & 0xf0) === 0xe0) {
        if (i + 1 >= raw.length) throw new Error('Truncated modified UTF-8 sequence');
        const b = raw[i++], c = raw[i++];
        if ((b & 0xc0) !== 0x80 || (c & 0xc0) !== 0x80) throw new Error('Invalid modified UTF-8 continuation');
        const value = ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f);
        if (value < 0x800) throw new Error('Overlong modified UTF-8 sequence');
        units.push(value);
      } else throw new Error('Invalid modified UTF-8 leading byte');
    }
    let output = '';
    for (let i = 0; i < units.length; i += 4096) output += String.fromCharCode(...units.slice(i, i + 4096));
    return output;
  }
}

type Cp = { tag: number; a?: number; b?: number; value?: string | number | bigint };

const TAG_NAMES: Record<number, string> = {
  1: 'Utf8', 3: 'Integer', 4: 'Float', 5: 'Long', 6: 'Double', 7: 'Class',
  8: 'String', 9: 'Fieldref', 10: 'Methodref', 11: 'InterfaceMethodref',
  12: 'NameAndType', 15: 'MethodHandle', 16: 'MethodType', 17: 'Dynamic',
  18: 'InvokeDynamic', 19: 'Module', 20: 'Package',
};

const OPCODES = [
  'nop','aconst_null','iconst_m1','iconst_0','iconst_1','iconst_2','iconst_3','iconst_4','iconst_5',
  'lconst_0','lconst_1','fconst_0','fconst_1','fconst_2','dconst_0','dconst_1','bipush','sipush','ldc',
  'ldc_w','ldc2_w','iload','lload','fload','dload','aload','iload_0','iload_1','iload_2','iload_3',
  'lload_0','lload_1','lload_2','lload_3','fload_0','fload_1','fload_2','fload_3','dload_0','dload_1',
  'dload_2','dload_3','aload_0','aload_1','aload_2','aload_3','iaload','laload','faload','daload',
  'aaload','baload','caload','saload','istore','lstore','fstore','dstore','astore','istore_0','istore_1',
  'istore_2','istore_3','lstore_0','lstore_1','lstore_2','lstore_3','fstore_0','fstore_1','fstore_2',
  'fstore_3','dstore_0','dstore_1','dstore_2','dstore_3','astore_0','astore_1','astore_2','astore_3',
  'iastore','lastore','fastore','dastore','aastore','bastore','castore','sastore','pop','pop2','dup',
  'dup_x1','dup_x2','dup2','dup2_x1','dup2_x2','swap','iadd','ladd','fadd','dadd','isub','lsub','fsub',
  'dsub','imul','lmul','fmul','dmul','idiv','ldiv','fdiv','ddiv','irem','lrem','frem','drem','ineg',
  'lneg','fneg','dneg','ishl','lshl','ishr','lshr','iushr','lushr','iand','land','ior','lor','ixor',
  'lxor','iinc','i2l','i2f','i2d','l2i','l2f','l2d','f2i','f2l','f2d','d2i','d2l','d2f','i2b','i2c',
  'i2s','lcmp','fcmpl','fcmpg','dcmpl','dcmpg','ifeq','ifne','iflt','ifge','ifgt','ifle','if_icmpeq',
  'if_icmpne','if_icmplt','if_icmpge','if_icmpgt','if_icmple','if_acmpeq','if_acmpne','goto','jsr',
  'ret','tableswitch','lookupswitch','ireturn','lreturn','freturn','dreturn','areturn','return',
  'getstatic','putstatic','getfield','putfield','invokevirtual','invokespecial','invokestatic',
  'invokeinterface','invokedynamic','new','newarray','anewarray','arraylength','athrow','checkcast',
  'instanceof','monitorenter','monitorexit','wide','multianewarray','ifnull','ifnonnull','goto_w','jsr_w',
];

function cpUtf8(cp: Cp[], index: number): string {
  const item = cp[index];
  return item?.tag === 1 ? String(item.value ?? '') : '';
}

function cpClass(cp: Cp[], index: number): string {
  const item = cp[index];
  return item?.tag === 7 ? cpUtf8(cp, item.a ?? 0).replace(/\//g, '.') : '';
}

function cpRef(cp: Cp[], index: number): JvmConstantReference | undefined {
  const item = cp[index];
  if (!item) return undefined;
  const result: JvmConstantReference = { index, tag: item.tag, kind: TAG_NAMES[item.tag] ?? 'Unknown' };
  if (item.tag === 7) result.value = cpClass(cp, index);
  else if (item.tag === 8) result.value = cpUtf8(cp, item.a ?? 0);
  else if (item.tag === 9 || item.tag === 10 || item.tag === 11 || item.tag === 17 || item.tag === 18) {
    const nt = cp[item.b ?? 0];
    result.owner = item.tag === 17 || item.tag === 18 ? undefined : cpClass(cp, item.a ?? 0);
    if (item.tag === 17 || item.tag === 18) result.bootstrapIndex = item.a;
    if (nt?.tag === 12) {
      result.name = cpUtf8(cp, nt.a ?? 0);
      result.descriptor = cpUtf8(cp, nt.b ?? 0);
    }
  } else if (item.tag === 1 || item.tag === 3 || item.tag === 4 || item.tag === 5 || item.tag === 6) {
    result.value = item.value;
  } else if (item.tag === 15) {
    result.referenceKind = item.a ?? 0;
    result.reference = cpRef(cp, item.b ?? 0);
  } else if (item.tag === 16) {
    result.descriptor = cpUtf8(cp, item.a ?? 0);
  }
  return result;
}

function instructionSize(op: number): number {
  if (op === 0xaa || op === 0xab || op === 0xc4) return 0;
  if ([0x10,0x12,0x15,0x16,0x17,0x18,0x19,0x36,0x37,0x38,0x39,0x3a,0xa9,0xbc].includes(op)) return 2;
  if ([0x11,0x13,0x14,0x84].includes(op) || (op >= 0x99 && op <= 0xa8) ||
      (op >= 0xb2 && op <= 0xb8) || [0xbb,0xbd,0xc0,0xc1,0xc6,0xc7].includes(op)) return 3;
  if ([0xb9,0xba,0xc8,0xc9].includes(op)) return 5;
  if (op === 0xc5) return 4;
  return 1;
}

function decodeCode(code: Uint8Array, cp: Cp[], handlers: JvmMethodIR['exceptionHandlers']): {
  instructions: JvmInstruction[]; blocks: JvmBasicBlock[]; calls: JvmConstantReference[];
  fields: JvmConstantReference[]; warnings: string[];
} {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const instructions: JvmInstruction[] = [];
  const calls: JvmConstantReference[] = [];
  const fields: JvmConstantReference[] = [];
  const warnings: string[] = [];
  let pc = 0;
  const signed = (offset: number) => view.getInt32(offset, false);
  while (pc < code.length) {
    const start = pc, op = code[pc];
    if (op === undefined || op >= OPCODES.length) { warnings.push(`Unknown opcode 0x${(op ?? 0).toString(16)} at ${pc}`); break; }
    const mnemonic = OPCODES[op];
    let size = instructionSize(op);
    const operands: number[] = [];
    const targets: number[] = [];
    let constant: JvmConstantReference | undefined;
    try {
      if (op === 0xaa || op === 0xab) {
        const pad = (4 - ((pc + 1) & 3)) & 3;
        const base = pc + 1 + pad;
        if (op === 0xaa) {
          if (base + 12 > code.length) throw new Error('Truncated tableswitch');
          const def = signed(base), low = signed(base + 4), high = signed(base + 8);
          if (high < low || high - low > code.length) throw new Error('Invalid tableswitch bounds');
          size = 1 + pad + 12 + (high - low + 1) * 4;
          targets.push(start + def);
          for (let i = 0; i <= high - low; i++) targets.push(start + signed(base + 12 + i * 4));
          operands.push(low, high);
        } else {
          if (base + 8 > code.length) throw new Error('Truncated lookupswitch');
          const def = signed(base), pairs = signed(base + 4);
          if (pairs < 0 || pairs > code.length / 8) throw new Error('Invalid lookupswitch pair count');
          size = 1 + pad + 8 + pairs * 8;
          targets.push(start + def);
          for (let i = 0; i < pairs; i++) {
            operands.push(signed(base + 8 + i * 8));
            targets.push(start + signed(base + 12 + i * 8));
          }
        }
      } else if (op === 0xc4) {
        if (pc + 2 > code.length) throw new Error('Truncated wide');
        const widened = code[pc + 1];
        size = widened === 0x84 ? 6 : 4;
        if (pc + size > code.length) throw new Error('Truncated wide operands');
        operands.push(widened, view.getUint16(pc + 2, false));
        if (widened === 0x84) operands.push(view.getInt16(pc + 4, false));
      } else {
        if (pc + size > code.length) throw new Error('Truncated instruction');
        if (size === 2) operands.push(op === 0x10 ? view.getInt8(pc + 1) : code[pc + 1]);
        if (size === 3) {
          if (op === 0x84) operands.push(code[pc + 1], view.getInt8(pc + 2));
          else operands.push(op === 0x11 || (op >= 0x99 && op <= 0xa8) || op === 0xc6 || op === 0xc7
            ? view.getInt16(pc + 1, false) : view.getUint16(pc + 1, false));
        }
        if (size === 4) operands.push(view.getUint16(pc + 1, false), code[pc + 3]);
        if (size === 5) operands.push(view.getUint16(pc + 1, false), code[pc + 3], code[pc + 4]);
        if ((op >= 0x99 && op <= 0xa8) || op === 0xc6 || op === 0xc7) targets.push(start + operands[0]);
        if (op === 0xc8 || op === 0xc9) targets.push(start + signed(pc + 1));
      }
      if ([0x12,0x13,0x14,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xbb,0xbd,0xc0,0xc1,0xc5].includes(op)) {
        const index = op === 0x12 ? operands[0] : operands[0];
        constant = cpRef(cp, index);
        if (op >= 0xb6 && op <= 0xba && constant) calls.push(constant);
        if (op >= 0xb2 && op <= 0xb5 && constant) fields.push(constant);
      }
      if (size < 1 || start + size > code.length) throw new Error('Invalid instruction size');
    } catch (error) {
      warnings.push(`${mnemonic} decode failed at ${start}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    instructions.push({ offset: start, opcode: op, mnemonic, size, operands, constant, branchTargets: targets });
    pc += size;
  }

  const byOffset = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
  const leaders = new Set<number>(instructions.length ? [instructions[0].offset] : []);
  for (let i = 0; i < instructions.length; i++) {
    const ins = instructions[i], next = ins.offset + ins.size;
    for (const target of ins.branchTargets) if (byOffset.has(target)) leaders.add(target);
    const conditional = (ins.opcode >= 0x99 && ins.opcode <= 0xa7) || ins.opcode === 0xc6 || ins.opcode === 0xc7 || ins.opcode === 0xaa || ins.opcode === 0xab;
    const terminal = (ins.opcode >= 0xac && ins.opcode <= 0xb1) || ins.opcode === 0xbf || ins.opcode === 0xa7 || ins.opcode === 0xa8 || ins.opcode === 0xc8 || ins.opcode === 0xc9;
    if ((conditional || terminal) && byOffset.has(next)) leaders.add(next);
  }
  for (const handler of handlers) if (byOffset.has(handler.handler)) leaders.add(handler.handler);
  const starts = [...leaders].sort((a,b) => a-b);
  const blocks: JvmBasicBlock[] = starts.map((start, index) => {
    const end = (starts[index + 1] ?? code.length);
    const slice = instructions.filter((instruction) => instruction.offset >= start && instruction.offset < end);
    const last = slice[slice.length - 1];
    const successors = new Set<number>();
    if (last) {
      for (const target of last.branchTargets) if (byOffset.has(target)) successors.add(target);
      const unconditional = [0xa7,0xa8,0xaa,0xab,0xbf,0xc8,0xc9].includes(last.opcode);
      const returns = last.opcode >= 0xac && last.opcode <= 0xb1;
      if (!unconditional && !returns && end < code.length && byOffset.has(end)) successors.add(end);
    }
    const exceptionalSuccessors = handlers.filter((h) => start < h.end && end > h.start).map((h) => h.handler);
    return { start, end, instructionOffsets: slice.map((item) => item.offset), successors: [...successors], exceptionalSuccessors: [...new Set(exceptionalSuccessors)] };
  });
  return { instructions, blocks, calls, fields, warnings };
}

function parseClass(entry: ExtractedZipEntry): JvmClassIR {
  const r = new Reader(entry.data);
  if (r.u4() !== 0xcafebabe) throw new Error('Invalid class magic');
  const minorVersion = r.u2(), majorVersion = r.u2(), cpCount = r.u2();
  const cp: Cp[] = new Array(cpCount);
  for (let i = 1; i < cpCount; i++) {
    const tag = r.u1();
    switch (tag) {
      case 1: cp[i] = { tag, value: r.utf8(r.u2()) }; break;
      case 3: cp[i] = { tag, value: r.s4() }; break;
      case 4: { const bits = r.u4(); const b = new ArrayBuffer(4); new DataView(b).setUint32(0,bits,false); cp[i] = { tag, value: new DataView(b).getFloat32(0,false) }; break; }
      case 5: { const hi = BigInt(r.u4()), lo = BigInt(r.u4()); cp[i] = { tag, value: BigInt.asIntN(64, (hi << 32n) | lo) }; i++; break; }
      case 6: { const hi = r.u4(), lo = r.u4(); const b = new ArrayBuffer(8); const v = new DataView(b); v.setUint32(0,hi,false); v.setUint32(4,lo,false); cp[i] = { tag, value: v.getFloat64(0,false) }; i++; break; }
      case 7: case 8: case 16: case 19: case 20: cp[i] = { tag, a: r.u2() }; break;
      case 9: case 10: case 11: case 12: case 17: case 18: cp[i] = { tag, a: r.u2(), b: r.u2() }; break;
      case 15: cp[i] = { tag, a: r.u1(), b: r.u2() }; break;
      default: throw new Error(`Unsupported constant-pool tag ${tag}`);
    }
  }
  const access = r.u2(), thisClass = r.u2(), superClass = r.u2();
  const name = cpClass(cp, thisClass), superName = superClass ? cpClass(cp, superClass) : undefined;
  const interfaces = Array.from({ length: r.u2() }, () => cpClass(cp, r.u2()));
  const fields: JvmFieldIR[] = [];
  for (let i = 0, count = r.u2(); i < count; i++) {
    const fieldAccess = r.u2(), fieldName = cpUtf8(cp, r.u2()), descriptor = cpUtf8(cp, r.u2());
    let constant: JvmConstantReference | undefined;
    for (let a = 0, ac = r.u2(); a < ac; a++) {
      const attributeName = cpUtf8(cp, r.u2()), length = r.u4(), end = r.offset + length;
      if (attributeName === 'ConstantValue' && length === 2) constant = cpRef(cp, r.u2());
      r.offset = end;
    }
    fields.push({ name: fieldName, descriptor, access: fieldAccess, constant });
  }
  const methods: JvmMethodIR[] = [];
  for (let i = 0, count = r.u2(); i < count; i++) {
    const methodAccess = r.u2(), methodName = cpUtf8(cp, r.u2()), descriptor = cpUtf8(cp, r.u2());
    let maxStack = 0, maxLocals = 0, code = new Uint8Array(0), codeLength = 0;
    const exceptionHandlers: JvmMethodIR['exceptionHandlers'] = [];
    const localVariables: JvmMethodIR['localVariables'] = [];
    for (let a = 0, ac = r.u2(); a < ac; a++) {
      const attributeName = cpUtf8(cp, r.u2()), length = r.u4(), end = r.offset + length;
      if (attributeName === 'Code') {
        maxStack = r.u2(); maxLocals = r.u2(); codeLength = r.u4(); code = r.take(codeLength);
        for (let h = 0, hc = r.u2(); h < hc; h++) {
          const start = r.u2(), finish = r.u2(), handler = r.u2(), catchIndex = r.u2();
          exceptionHandlers.push({ start, end: finish, handler, catchType: catchIndex ? cpClass(cp, catchIndex) : undefined });
        }
        for (let nested = 0, nc = r.u2(); nested < nc; nested++) {
          const nestedName = cpUtf8(cp, r.u2()), nestedLength = r.u4(), nestedEnd = r.offset + nestedLength;
          if (nestedName === 'LocalVariableTable') {
            for (let l = 0, lc = r.u2(); l < lc; l++) {
              const start = r.u2(), scopeLength = r.u2(), variableName = cpUtf8(cp, r.u2());
              const variableDescriptor = cpUtf8(cp, r.u2()), index = r.u2();
              localVariables.push({ name: variableName, descriptor: variableDescriptor, index, start, length: scopeLength });
            }
          }
          r.offset = nestedEnd;
        }
      }
      r.offset = end;
    }
    const decoded = decodeCode(code, cp, exceptionHandlers);
    methods.push({
      name: methodName, descriptor, access: methodAccess, maxStack, maxLocals,
      instructions: decoded.instructions, blocks: decoded.blocks, calls: decoded.calls,
      fieldAccesses: decoded.fields, localVariables, exceptionHandlers, codeLength,
      decodeWarnings: decoded.warnings,
    });
  }
  // Resolve BootstrapMethods so invokedynamic sites (lambdas, method references and
  // string-concat factories) retain the linkage handles and static bootstrap arguments.
  const bootstrapMethods: JvmBootstrapMethod[] = [];
  for (let i = 0, count = r.u2(); i < count; i++) {
    const attributeName = cpUtf8(cp, r.u2()), length = r.u4(), end = r.offset + length;
    if (attributeName === 'BootstrapMethods') {
      const bootstrapCount = r.u2();
      for (let index = 0; index < bootstrapCount; index++) {
        const methodReference = cpRef(cp, r.u2());
        const argumentCount = r.u2();
        const args = Array.from({ length: argumentCount }, () => cpRef(cp, r.u2())).filter((value): value is JvmConstantReference => Boolean(value));
        bootstrapMethods.push({ methodReference, arguments: args });
      }
    }
    if (r.offset > end) throw new Error('Class attribute exceeded its declared length');
    r.offset = end;
  }
  const references = cp.map((_, index) => cpRef(cp, index)).filter((value): value is JvmConstantReference => Boolean(value));
  const attachBootstrap = (reference: JvmConstantReference | undefined) => {
    if (reference?.bootstrapIndex !== undefined) reference.bootstrapMethod = bootstrapMethods[reference.bootstrapIndex];
  };
  for (const reference of references) attachBootstrap(reference);
  for (const method of methods) {
    for (const call of method.calls) attachBootstrap(call);
    for (const instruction of method.instructions) attachBootstrap(instruction.constant);
  }
  return {
    path: entry.path, name, superName, interfaces, access, majorVersion, minorVersion,
    fields, methods, references, bootstrapMethods,
    decodeWarnings: methods.flatMap((method) => method.decodeWarnings),
  };
}

/** Parses every class file and yields between chunks so mobile Discord clients can keep rendering. */
export async function analyzeJvmArchive(
  entries: ExtractedZipEntry[],
  options?: { chunkSize?: number; onProgress?: (done: number, total: number) => void },
): Promise<JvmArchiveAnalysisReport> {
  const classEntries = entries.filter((entry) => !entry.isDirectory && entry.path.toLowerCase().endsWith('.class'));
  const classes: JvmClassIR[] = [], unresolvedClassFiles: string[] = [], warnings: string[] = [];
  const totals = {
    classFiles: classEntries.length, parsedClasses: 0, malformedClasses: 0, methods: 0,
    methodsWithCode: 0, instructions: 0, basicBlocks: 0, methodCalls: 0,
    fieldAccesses: 0, exceptionHandlers: 0, dynamicCallSites: 0, bootstrapMethods: 0,
  };
  const chunkSize = Math.max(1, options?.chunkSize ?? 16);
  for (let start = 0; start < classEntries.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, classEntries.length);
    for (let i = start; i < end; i++) {
      const entry = classEntries[i];
      try {
        const parsed = parseClass(entry);
        classes.push(parsed);
        totals.parsedClasses++;
        totals.bootstrapMethods += parsed.bootstrapMethods.length;
        for (const method of parsed.methods) {
          totals.methods++;
          if (method.codeLength > 0) totals.methodsWithCode++;
          totals.instructions += method.instructions.length;
          totals.basicBlocks += method.blocks.length;
          totals.methodCalls += method.calls.length;
          totals.fieldAccesses += method.fieldAccesses.length;
          totals.exceptionHandlers += method.exceptionHandlers.length;
          totals.dynamicCallSites += method.calls.filter((call) => call.kind === 'InvokeDynamic' || call.kind === 'Dynamic').length;
          if (method.decodeWarnings.length) warnings.push(...method.decodeWarnings.slice(0, 3).map((warning) => `${parsed.name}.${method.name}: ${warning}`));
        }
      } catch (error) {
        totals.malformedClasses++;
        unresolvedClassFiles.push(entry.path);
        warnings.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    options?.onProgress?.(end, classEntries.length);
    if (end < classEntries.length) await yieldToUi();
  }
  return { classes, totals, unresolvedClassFiles, warnings: warnings.slice(0, 2000), complete: unresolvedClassFiles.length === 0 && warnings.length === 0 };
}
