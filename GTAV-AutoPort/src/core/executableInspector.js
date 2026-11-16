const MAX_PROGRAM_HEADERS = 256;
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const SCE_MAGIC = [0x53, 0x43, 0x45, 0x00];
const SELF_MAGIC = [0x4f, 0x15, 0x3d, 0x1d];

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function hasMagic(bytes, magic) {
  return bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte);
}

function elfMachine(machine) {
  return ({ 3: "x86", 40: "ARM", 62: "x86-64", 183: "AArch64" })[machine] || "unknown";
}

function inspectElf(bytes) {
  if (bytes.length < 52) return { format: "elf", status: "truncated", error: "ELF header is shorter than the minimum 32-bit header." };
  const elfClass = bytes[4];
  const dataEncoding = bytes[5];
  if (![1, 2].includes(elfClass) || ![1, 2].includes(dataEncoding) || bytes[6] !== 1) {
    return { format: "elf", status: "invalid-header", error: "ELF class, byte order, or header version is unsupported." };
  }
  const is64 = elfClass === 2;
  const headerSize = is64 ? 64 : 52;
  if (bytes.length < headerSize) return { format: "elf", status: "truncated", error: "ELF header is truncated for its declared class." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = dataEncoding === 1;
  const type = view.getUint16(16, littleEndian);
  const machine = view.getUint16(18, littleEndian);
  const version = view.getUint32(20, littleEndian);
  const entryPoint = is64 ? Number(view.getBigUint64(24, littleEndian)) : view.getUint32(24, littleEndian);
  const programHeaderOffset = is64 ? Number(view.getBigUint64(32, littleEndian)) : view.getUint32(28, littleEndian);
  const sectionHeaderOffset = is64 ? Number(view.getBigUint64(40, littleEndian)) : view.getUint32(32, littleEndian);
  const flags = view.getUint32(is64 ? 48 : 36, littleEndian);
  const declaredHeaderSize = view.getUint16(is64 ? 52 : 40, littleEndian);
  const programHeaderEntrySize = view.getUint16(is64 ? 54 : 42, littleEndian);
  const programHeaderCount = view.getUint16(is64 ? 56 : 44, littleEndian);
  const sectionHeaderEntrySize = view.getUint16(is64 ? 58 : 46, littleEndian);
  const sectionHeaderCount = view.getUint16(is64 ? 60 : 48, littleEndian);
  if (version !== 1 || declaredHeaderSize < headerSize) return { format: "elf", status: "invalid-header", error: "ELF version or declared header size is invalid." };
  if (programHeaderCount > MAX_PROGRAM_HEADERS) return { format: "elf", status: "unsupported-header-table", error: "ELF program-header count exceeds the inspection limit." };
  const minimumProgramHeaderSize = is64 ? 56 : 32;
  if (programHeaderCount && programHeaderEntrySize < minimumProgramHeaderSize) {
    return { format: "elf", status: "invalid-header", error: "ELF program-header entry size is too small." };
  }
  const programHeaders = [];
  if (programHeaderCount) {
    const tableBytes = programHeaderEntrySize * programHeaderCount;
    if (!Number.isSafeInteger(programHeaderOffset) || programHeaderOffset < headerSize
      || !Number.isSafeInteger(tableBytes) || programHeaderOffset + tableBytes > bytes.length) {
      return { format: "elf", status: "header-only", error: "Program-header table is outside the supplied inspection bytes." };
    }
    for (let index = 0; index < programHeaderCount; index++) {
      const at = programHeaderOffset + index * programHeaderEntrySize;
      const segmentType = view.getUint32(at, littleEndian);
      const offset = is64 ? Number(view.getBigUint64(at + 8, littleEndian)) : view.getUint32(at + 4, littleEndian);
      const fileSize = is64 ? Number(view.getBigUint64(at + 32, littleEndian)) : view.getUint32(at + 16, littleEndian);
      const memorySize = is64 ? Number(view.getBigUint64(at + 40, littleEndian)) : view.getUint32(at + 20, littleEndian);
      const segmentFlags = is64 ? view.getUint32(at + 4, littleEndian) : view.getUint32(at + 24, littleEndian);
      if (![offset, fileSize, memorySize].every(Number.isSafeInteger) || offset < 0 || fileSize < 0 || memorySize < fileSize) {
        return { format: "elf", status: "invalid-program-header", error: "ELF segment contains an invalid size or offset." };
      }
      if (offset + fileSize < offset) return { format: "elf", status: "invalid-program-header", error: "ELF segment range overflows." };
      programHeaders.push({ type: segmentType, offset, fileSize, memorySize, flags: segmentFlags });
    }
  }
  const loadSegments = programHeaders.filter((segment) => segment.type === 1);
  const loadSegmentsWithinSuppliedBytes = loadSegments.filter((segment) => segment.offset + segment.fileSize <= bytes.length).length;
  const machineName = elfMachine(machine);
  const architectureCompatibleWithPs4Cpu = is64 && littleEndian && machine === 62;
  return {
    format: "elf",
    status: "header-inspected",
    class: is64 ? 64 : 32,
    byteOrder: littleEndian ? "little-endian" : "big-endian",
    osAbi: bytes[7],
    abiVersion: bytes[8],
    type,
    typeName: ({ 1: "relocatable", 2: "executable", 3: "shared-object", 4: "core" })[type] || "unknown",
    machine,
    machineName,
    architectureCompatibleWithPs4Cpu,
    entryPoint,
    flags,
    programHeaderCount,
    sectionHeaderOffset,
    sectionHeaderEntrySize,
    sectionHeaderCount,
    loadSegmentCount: loadSegments.length,
    loadSegmentsWithinSuppliedBytes,
    programHeaders,
    platform: "unverified",
    targetCompatibility: "unverified",
    warnings: [
      architectureCompatibleWithPs4Cpu
        ? "ELF64 little-endian x86-64 matches the PS4 CPU architecture, but this does not establish Orbis ABI, SELF/PRX packaging, imports, GoldHEN compatibility, title ID or game-update compatibility."
        : "ELF class, byte order or machine does not match the expected PS4 x86-64 architecture.",
      "A readable ELF header is not proof that this binary is a valid PS4 PRX/SPRX."
    ]
  };
}

function inspectPe(bytes) {
  if (bytes.length < 64) return { format: "pe", status: "truncated", error: "DOS header is truncated." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset < 64 || peOffset + 24 > bytes.length) {
    return { format: "pe", status: "header-only", error: "PE header offset is outside the supplied inspection bytes." };
  }
  if (view.getUint32(peOffset, true) !== 0x00004550) {
    return { format: "pe", status: "invalid-header", error: "MZ signature is present but PE signature is missing." };
  }
  const machine = view.getUint16(peOffset + 4, true);
  const sectionCount = view.getUint16(peOffset + 6, true);
  const optionalHeaderSize = view.getUint16(peOffset + 20, true);
  const characteristics = view.getUint16(peOffset + 22, true);
  const optionalOffset = peOffset + 24;
  if (optionalHeaderSize && optionalOffset + optionalHeaderSize > bytes.length) {
    return { format: "pe", status: "header-only", error: "Optional PE header is outside the supplied inspection bytes." };
  }
  const optionalMagic = optionalHeaderSize >= 2 ? view.getUint16(optionalOffset, true) : 0;
  const subsystem = optionalHeaderSize >= 70 ? view.getUint16(optionalOffset + 68, true) : null;
  return {
    format: "pe",
    status: "header-inspected",
    machine,
    machineName: ({ 0x014c: "x86", 0x8664: "x86-64", 0xaa64: "ARM64" })[machine] || "unknown",
    sectionCount,
    optionalHeaderMagic: optionalMagic,
    optionalHeaderBits: optionalMagic === 0x20b ? 64 : optionalMagic === 0x10b ? 32 : null,
    subsystem,
    isDll: Boolean(characteristics & 0x2000),
    isExecutable: Boolean(characteristics & 0x0002),
    platform: "windows-pe",
    targetCompatibility: "not-a-PS4-native-module",
    warnings: ["This is a Windows PE image, not an Orbis PRX/SPRX. Renaming it cannot make it load on GoldHEN."]
  };
}

export function inspectExecutableHeader(file) {
  const bytes = bytesOf(file?.bytes ?? file);
  if (!bytes) return { format: "unknown", status: "unavailable", error: "Executable inspection requires byte data." };
  if (hasMagic(bytes, SELF_MAGIC)) {\n    return {\n      format: "self-container",\n      status: "opaque-console-container",\n      magic: "4f153d1d",\n      platform: "playstation-self-container",\n      targetCompatibility: "unverified",\n      warnings: ["PlayStation SELF container signature detected. This bounded inspector does not decrypt or validate signatures, embedded ELF, imports, title ID or game-update compatibility."]\n    };\n  }\n  if (hasMagic(bytes, SCE_MAGIC)) {
    return {
      format: "sce-container",
      status: "opaque-console-container",
      magic: "SCE\\0",
      platform: "console-native-container",
      targetCompatibility: "unverified",
      warnings: ["Sony SCE container detected. This bounded inspector does not decrypt or validate SELF/SPRX signatures, imports, title ID or game-update compatibility."]
    };
  }
  if (hasMagic(bytes, ELF_MAGIC)) return inspectElf(bytes);
  if (hasMagic(bytes, [0x4d, 0x5a])) return inspectPe(bytes);
  return { format: "unknown", status: "unrecognized", error: "No supported PE, ELF or Sony SCE executable signature was found." };
}
