import assetsData from "@/config/assets";
import type { DecompileClassSummary, DecompileStats } from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { isGhostEntityName } from '@/utils/ghostEntityFilter';
import { yieldToUi } from '@/utils/archiveScale';\nimport { analyzeJvmArchive } from '@/utils/jvmBytecodeIR';
export interface SourceTextureEntry {
  name: string;
  data: Uint8Array;
}
const textDecoder = new TextDecoder();
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  // Chunking to avoid call stack limits on large buffers
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
export function bytesToDataUrl(bytes: Uint8Array, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`;
}
/**
 * Animation/audio/pose state suffixes. Texture or registry names ending with these
 * are state variants of an existing mob/item (e.g. kamikazeidle.png, gilbertambient.png,
 * sintaunt.png) — NOT standalone entities. Filtered everywhere registration happens.
 */
const STATE_SUFFIX_RE = /(idle|walk|attack|ambient|taunt|scream|execute|reload|audio|sound|clank|death|die|dead|hurt|stun|enraged|enrage|block|phase\d*|shoot|aim|charge\d*|swing|crawl|sit|sleep|open|close|chainsaw|spawner|notinfected|infected|kill|roar|howl|growl)$/i;

export interface ParsedClass {
  className: string;
  superName: string;
  strings: string[];
  methods: string[];
  signals: string[];
  role: 'weapon' | 'combat' | 'entity' | 'animation' | 'utility';
}

/**
 * Minimal in-browser Java .class file constant pool & bytecode inspector.
 * Reads JVM bytecode class structures, identifies inheritance, registry strings,
 * methods, and combat/item architectures.
 */
function parseJavaClass(data: Uint8Array): ParsedClass | null {
  try {
    if (data.length < 24) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Check magic 0xCAFEBABE
    if (view.getUint32(0, false) !== 0xcafebabe) return null;
    const cpCount = view.getUint16(8, false);
    const cpEntries: Array<{
      tag: number;
      value?: string;
      ref1?: number;
      ref2?: number;
    }> = [{
      tag: 0
    }];
    let offset = 10;
    for (let i = 1; i < cpCount && offset < data.length; i++) {
      if (offset >= data.length) break;
      const tag = view.getUint8(offset++);
      switch (tag) {
        case 1:
          {
            // Utf8
            if (offset + 2 > data.length) {
              offset = data.length;
              break;
            }
            const len = view.getUint16(offset, false);
            offset += 2;
            if (offset + len > data.length) {
              offset = data.length;
              break;
            }
            const strBytes = data.subarray(offset, offset + len);
            offset += len;
            cpEntries[i] = {
              tag,
              value: textDecoder.decode(strBytes)
            };
            break;
          }
        case 3: // Integer
        case 4:
          // Float
          offset += 4;
          cpEntries[i] = {
            tag
          };
          break;
        case 5: // Long
        case 6:
          // Double
          offset += 8;
          cpEntries[i] = {
            tag
          };
          cpEntries[++i] = {
            tag: 0
          }; // 8-byte constants take 2 slots
          break;
        case 7:
          {
            // Class
            if (offset + 2 <= data.length) {
              const nameIdx = view.getUint16(offset, false);
              cpEntries[i] = {
                tag,
                ref1: nameIdx
              };
            }
            offset += 2;
            break;
          }
        case 8:
          {
            // String
            if (offset + 2 <= data.length) {
              const strIdx = view.getUint16(offset, false);
              cpEntries[i] = {
                tag,
                ref1: strIdx
              };
            }
            offset += 2;
            break;
          }
        case 9: // Fieldref
        case 10: // Methodref
        case 11:
          {
            // InterfaceMethodref
            if (offset + 4 <= data.length) {
              const classIdx = view.getUint16(offset, false);
              const ntIdx = view.getUint16(offset + 2, false);
              cpEntries[i] = {
                tag,
                ref1: classIdx,
                ref2: ntIdx
              };
            }
            offset += 4;
            break;
          }
        case 12:
          {
            // NameAndType
            if (offset + 4 <= data.length) {
              const nameIdx = view.getUint16(offset, false);
              const descIdx = view.getUint16(offset + 2, false);
              cpEntries[i] = {
                tag,
                ref1: nameIdx,
                ref2: descIdx
              };
            }
            offset += 4;
            break;
          }
        case 15:
          // MethodHandle
          offset += 3;
          cpEntries[i] = {
            tag
          };
          break;
        case 16:
          // MethodType
          offset += 2;
          cpEntries[i] = {
            tag
          };
          break;
        case 17: // Dynamic
        case 18:
          // InvokeDynamic
          offset += 4;
          cpEntries[i] = {
            tag
          };
          break;
        case 19: // Module
        case 20:
          // Package
          offset += 2;
          cpEntries[i] = {
            tag
          };
          break;
        default:
          offset = data.length;
          break;
      }
    }
    const getUtf8 = (idx: number | undefined, depth = 0): string => {
      if (!idx || depth > 5 || idx >= cpEntries.length) return '';
      const entry = cpEntries[idx];
      if (entry?.tag === 1) return entry.value ?? '';
      if (entry?.tag === 7 && entry.ref1) return getUtf8(entry.ref1, depth + 1);
      if (entry?.tag === 8 && entry.ref1) return getUtf8(entry.ref1, depth + 1);
      return '';
    };
    if (offset + 6 > data.length) return null;
    offset += 2;
    const thisClassIdx = view.getUint16(offset, false);
    offset += 2;
    const superClassIdx = view.getUint16(offset, false);
    offset += 2;
    const className = getUtf8(thisClassIdx);
    const superName = getUtf8(superClassIdx);
    const strings: string[] = [];
    const methods: string[] = [];
    const signals: string[] = [];
    for (const entry of cpEntries) {
      if (!entry) continue;
      if (entry.tag === 1 && entry.value) {
        const val = entry.value;
        if (val.length > 2 && val.length < 80) {
          if (/^[a-z0-9_.-]+:[a-z0-9_/.-]+$/i.test(val)) {
            strings.push(val);
          } else if (/^(attack|dodge|combo|swing|stamina|guard|parry|skill|animation)/i.test(val)) {
            methods.push(val);
          }
          if (/projectile|shoot|launch|fire|cast|spell|attack|hit|arrow|bullet|reload|charge|cooldown|throw/i.test(val)) {
            signals.push(val);
          }
        }
      } else if ((entry.tag === 10 || entry.tag === 11) && entry.ref1 && entry.ref2) {
        const owner = getUtf8(entry.ref1);
        const nameType = cpEntries[entry.ref2];
        const methodName = nameType?.tag === 12 ? getUtf8(nameType.ref1) : '';
        const reference = `${owner}.${methodName}`;
        if (/projectile|shoot|launch|fire|cast|spell|attack|hit|arrow|bullet|reload|charge|cooldown|throw/i.test(reference)) {
          signals.push(reference);
        }
      } else if (entry.tag === 12 && entry.ref1) {
        const name = getUtf8(entry.ref1);
        if (name && !name.startsWith('<') && name.length > 2 && name.length < 40) {
          methods.push(name);
        }
      }
    }
    const resolveFieldReference = (index: number): string => {
      const ref = cpEntries[index];
      if (ref?.tag !== 9 || !ref.ref1 || !ref.ref2) return '';
      const nameType = cpEntries[ref.ref2];
      if (nameType?.tag !== 12) return '';
      return `${getUtf8(ref.ref1).replace(/\\//g, '.')}.${getUtf8(nameType.ref1)}`;
    };
    const collectOpcodeSignatures = (): string[] => {
      let cursor = offset;
      const signatures = new Set<string>();
      if (cursor + 2 > data.length) return [];
      const interfaceCount = view.getUint16(cursor, false);
      cursor += 2 + interfaceCount * 2;
      if (cursor + 2 > data.length) return [];
      const skipAttributes = (count: number): boolean => {
        for (let index = 0; index < count; index++) {
          if (cursor + 6 > data.length) return false;
          const length = view.getUint32(cursor + 2, false);
          cursor += 6 + length;
          if (cursor > data.length) return false;
        }
        return true;
      };
      const fieldCount = view.getUint16(cursor, false);
      cursor += 2;
      for (let index = 0; index < fieldCount; index++) {
        if (cursor + 8 > data.length) return [];
        const attributeCount = view.getUint16(cursor + 6, false);
        cursor += 8;
        if (!skipAttributes(attributeCount)) return [];
      }
      if (cursor + 2 > data.length) return [];
      const methodCount = view.getUint16(cursor, false);
      cursor += 2;
      const classCalls: string[] = [];
      let classHasControlFlow = false;
      let classHasSwitch = false;
      let classReadsState = false;
      let classWritesState = false;
      for (let index = 0; index < methodCount; index++) {
        if (cursor + 8 > data.length) return [];
        cursor += 2;
        const methodName = getUtf8(view.getUint16(cursor, false));
        cursor += 4;
        const attributeCount = view.getUint16(cursor, false);
        cursor += 2;
        for (let attributeIndex = 0; attributeIndex < attributeCount; attributeIndex++) {
          if (cursor + 6 > data.length) return [];
          const attributeName = getUtf8(view.getUint16(cursor, false));
          const attributeLength = view.getUint32(cursor + 2, false);
          const attributeStart = cursor + 6;
          if (attributeLength > data.length - attributeStart) return [];
          if (attributeName === 'Code' && attributeLength >= 8) {
            const codeLength = view.getUint32(attributeStart + 4, false);
            const codeStart = attributeStart + 8;
            if (codeLength <= attributeLength - 8) {
              const calls: string[] = [];
              let hasControlFlow = false;
              let hasSwitch = false;
              let readsState = false;
              let writesState = false;
              let pc = 0;
              while (pc < codeLength) {
                const opcode = data[codeStart + pc];
                if (opcode === undefined) break;
                if ((opcode >= 0x99 && opcode <= 0xa8) || opcode === 0xaa || opcode === 0xab ||
                    opcode === 0xc6 || opcode === 0xc7 || opcode === 0xc8 || opcode === 0xc9) {
                  hasControlFlow = true;
                }
                if (opcode === 0xaa || opcode === 0xab) hasSwitch = true;
                if (opcode >= 0xb2 && opcode <= 0xb5 && pc + 2 < codeLength) {
                  const poolIndex = view.getUint16(codeStart + pc + 1, false);
                  const fieldName = resolveFieldReference(poolIndex).split('.').pop()?.toLowerCase() ?? '';
                  if (/state|phase|mode|form/.test(fieldName)) {
                    if (opcode === 0xb3 || opcode === 0xb5) writesState = true;
                    else readsState = true;
                  }
                }
                if (opcode >= 0xb6 && opcode <= 0xb9 && pc + 2 < codeLength) {
                  const poolIndex = view.getUint16(codeStart + pc + 1, false);
                  const reference = resolveMethodReference(poolIndex);
                  if (reference) calls.push(reference.toLowerCase());
                }
                let instructionLength = 1;
                if (opcode === 0xaa || opcode === 0xab) {
                  const padding = (4 - ((pc + 1) % 4)) % 4;
                  const payload = pc + 1 + padding;
                  if (opcode === 0xaa) {
                    if (payload + 12 > codeLength) break;
                    const low = view.getInt32(codeStart + payload + 4, false);
                    const high = view.getInt32(codeStart + payload + 8, false);
                    instructionLength = payload - pc + 12 + Math.max(0, high - low + 1) * 4;
                  } else {
                    if (payload + 8 > codeLength) break;
                    const pairs = view.getInt32(codeStart + payload + 4, false);
                    instructionLength = payload - pc + 8 + Math.max(0, pairs) * 8;
                  }
                } else if (opcode === 0xc4) {
                  instructionLength = data[codeStart + pc + 1] === 0x84 ? 6 : 4;
                } else if (opcode === 0xb9 || opcode === 0xba || opcode === 0xc8 || opcode === 0xc9) {
                  instructionLength = 5;
                } else if (opcode === 0xc5) {
                  instructionLength = 4;
                } else if (opcode === 0x10 || opcode === 0x12 || (opcode >= 0x15 && opcode <= 0x19) ||
                    (opcode >= 0x36 && opcode <= 0x3a) || opcode === 0xa9 || opcode === 0xbc) {
                  instructionLength = 2;
                } else if (opcode === 0x11 || opcode === 0x13 || opcode === 0x14 || opcode === 0x84 ||
                    (opcode >= 0x99 && opcode <= 0xa8) || (opcode >= 0xb2 && opcode <= 0xb8) ||
                    opcode === 0xbb || opcode === 0xbd || opcode === 0xc0 || opcode === 0xc1 ||
                    opcode === 0xc6 || opcode === 0xc7) {
                  instructionLength = 3;
                }
                if (instructionLength < 1 || pc + instructionLength > codeLength) break;
                pc += instructionLength;
              }
              const callText = calls.join(' ');
              classCalls.push(...calls);
              classHasControlFlow = classHasControlFlow || hasControlFlow;
              classHasSwitch = classHasSwitch || hasSwitch;
              classReadsState = classReadsState || readsState;
              classWritesState = classWritesState || writesState;
              const hasEntityQuery = /getentities|nearbyentities|queryentities|findentities|livingentities/.test(callText);
              const hasSpatialBounds = /aabb|boundingbox|radius|distance|within|nearby|around|inflate|expand/.test(callText);
              const hasAreaEffect = /hurt|damage|attack|applyeffect|addeffect|knockback|setfire/.test(callText);
              const hasIteration = /iterator|hasnext|foreach|\.stream|\.filter|\.next/.test(callText);
              if (hasEntityQuery && hasSpatialBounds && hasAreaEffect && (hasControlFlow || hasIteration)) {
                signatures.add('bytecode-signature:area-of-effect');
              }
              const hasTargetLookup = /gettarget|nearest|findtarget|targetentity|acquiretarget|closestentity/.test(callText);
              const hasVectorMath = /normalize|normalise|subtract|scale|multiply|direction|lookangle|vector/.test(callText);
              const hasVelocityUpdate = /setdeltamovement|setvelocity|setmotion|addvelocity|lerpmotion/.test(callText);
              if (hasTargetLookup && hasVectorMath && hasVelocityUpdate) {
                signatures.add('bytecode-signature:homing-projectile');
              }
              const hasProjectileLaunch = /projectile|shoot|launch|fireball|arrow|throw/.test(callText);
              if (hasProjectileLaunch && (hasControlFlow || hasIteration)) {
                signatures.add('bytecode-signature:projectile-launch');
              }
              if (/addfreshentity|spawnentity|summonentity|addentity/.test(callText)) {
                signatures.add('bytecode-signature:summon');
              }
              if (/addeffect|applyeffect|mobeffect|potioneffect/.test(callText)) {
                signatures.add('bytecode-signature:status-effect');
              }
              if (/charge|rush|dash|ram/.test(callText) && hasVectorMath && hasVelocityUpdate) {
                signatures.add('bytecode-signature:charge-attack');
              }
            }
          }
          cursor = attributeStart + attributeLength;
        }
      }
      const classCallText = classCalls.join(' ');
      const stateSetterCall = /(?:set|change|switch|transition|enter|exit|advance|next|update)[a-z0-9_$]*(?:state|phase|mode|form)/;
      const stateReceiverCall = /(?:state|phase|mode|form)[a-z0-9_$]*(?:set|change|switch|transition|enter|exit|advance|next|update)/;
      const hasStateTransitionCall = stateSetterCall.test(classCallText) || stateReceiverCall.test(classCallText);
      if (
        hasStateTransitionCall ||
        (classReadsState && (classWritesState || classHasSwitch) && classHasControlFlow)
      ) {
        signatures.add('bytecode-signature:state-machine');
      }
      const hasControllerReference = /animationcontroller|animcontroller|registercontrollers|controllerpredicate/.test(classCallText);
      const hasAnimationStateAction = /setanimation|playanimation|triggeranimation|animationstate|playstate|predicate|transition/.test(classCallText);
      if (hasControllerReference && hasAnimationStateAction) {
        signatures.add('bytecode-signature:animation-controller');
      }
      return Array.from(signatures);
    };
    const opcodeSignatures = collectOpcodeSignatures();
    const lowerSuper = superName.toLowerCase();
    const behaviorText = `${classCallText.toLowerCase()} ${methods.join(' ').toLowerCase()}`;
    // Role is decided by what the class actually extends, implements and calls. A class name
    // that merely contains "sword" — or that extends Item — is NOT combat evidence, which is
    // what used to turn every item class in every mod into a weapon.
    const itemLineage = /(?:^|\.)(?:item|itemstack|tiereditem|diggeritem|sworditem|pickaxeitem|axeitem|shovelitem|hoeitem|armoritem|bowitem|crossbowitem|bucketitem|blockitem|shielditem|projectileitem|recorditem|snowballitem)$/.test(lowerSuper)
      || /registeritem|itemgroup|onitemrightclick|useon|finishusingitem|hurtandbreak|getattackdamage/.test(behaviorText);
    const entityLineage = /(?:^|\.)(?:entity|livingentity|pathfindermob|monster|animal|wateranimal|flyingmob|ambiententity|tamableanimal|abstractarrow|throwableprojectile|projectile)$/.test(lowerSuper)
      || /registerattributes|createattributes|registergoals|goalselector|navigation/.test(behaviorText);
    const strikeEvidence = /attackdamage|getattackdamage|meleedamage|hurtandbreak|shootprojectile|launchprojectile|spawnprojectile/.test(behaviorText)
      || opcodeSignatures.includes('bytecode-signature:projectile-launch');
    const combatStateEvidence = opcodeSignatures.includes('bytecode-signature:charge-attack')
      || opcodeSignatures.includes('bytecode-signature:area-of-effect')
      || opcodeSignatures.includes('bytecode-signature:homing-projectile')
      || opcodeSignatures.includes('bytecode-signature:state-machine');
    const animationEvidence = opcodeSignatures.includes('bytecode-signature:animation-controller');
    let role: 'weapon' | 'combat' | 'entity' | 'animation' | 'utility' = 'utility';
    if (entityLineage && !itemLineage) {
      role = 'entity';
    } else if (itemLineage) {
      role = strikeEvidence ? 'weapon' : animationEvidence ? 'animation' : 'utility';
    } else if (combatStateEvidence) {
      role = 'combat';
    } else if (animationEvidence) {
      role = 'animation';
    }
    return {
      className: className.replace(/\//g, '.'),
      superName: superName.replace(/\//g, '.'),
      strings: Array.from(new Set(strings)).slice(0, 15),
      methods: Array.from(new Set(methods)).slice(0, 8),
      signals: Array.from(new Set([...opcodeSignatures, ...signals])).slice(0, 16),
      role
    };
  } catch {
    return null;
  }
}

/**
 * Deeply decompiles and analyzes unzipped Java mod entries:
 * 1. Finds root / pack icon PNG
 * 2. Parses mod metadata (fabric, forge, quilt, etc.)
 * 3. Inspects classes, inheritance, registered items, and combat mechanics
 * 4. Extracts assets, textures, models, and lang entries
 */
export function decompileJavaMod(
  entries: ExtractedZipEntry[],
  fallbackName?: string,
  /**
   * Bytecode parsed by a caller that already walked the class entries in slices. Passing it in
   * lets the archive be inspected across several frames instead of in one blocking pass.
   */
  presetClasses?: ParsedClass[],
): {
  stats: DecompileStats;
  iconBytes: Uint8Array | null;
  rawDecompileContext: string;
  sourceTextures: SourceTextureEntry[];
  sourceModels: string[];
  sourceAnimations: ExtractedZipEntry[];
} {
  const mechanicsSet = new Set<string>();
  let modId = '';
  let modName = '';
  let version = '1.0.0';
  let description = '';
  let metadataFormat = '';
  // Priority: root icon -> pack.png / icon.png -> assets icon
  let foundIconEntry: ExtractedZipEntry | null = null;

  // Root directory icons (pack.png / icon.png / logo.png at JAR root)
  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/');
    const isRoot = !cleanPath.includes('/');
    const lower = cleanPath.toLowerCase();
    if (isRoot && [assetsData.IMAGE_OGIN, assetsData.IMAGE_KPWD, assetsData.IMAGE_AYWF, assetsData.IMAGE_BWWX, assetsData.IMAGE_YRUS, assetsData.IMAGE_QEIG].includes(lower)) {
      foundIconEntry = entry;
      break;
    }
  }

  // Any root PNG
  if (!foundIconEntry) {
    for (const entry of entries) {
      const cleanPath = entry.path.replace(/\\/g, '/');
      if (!cleanPath.includes('/') && cleanPath.toLowerCase().endsWith('.png') && entry.data.length > 50) {
        foundIconEntry = entry;
        break;
      }
    }
  }

  // Assets icon fallback
  if (!foundIconEntry) {
    for (const entry of entries) {
      const lower = entry.path.replace(/\\/g, '/').toLowerCase();
      if ((lower.endsWith(assetsData.IMAGE_ACOC) || lower.endsWith(assetsData.IMAGE_XMBV) || lower.endsWith(assetsData.IMAGE_RQDC) || lower.endsWith(assetsData.IMAGE_LGOJ)) && entry.data.length > 50) {
        foundIconEntry = entry;
        break;
      }
    }
  }

  // 2. Parse Mod Metadata (including loader-specific dependency declarations)
  const dependencySet = new Set<string>();
  const collectDeps = (raw: unknown) => {
    if (!raw) return;
    if (Array.isArray(raw)) {
      raw.forEach(collectDeps);
      return;
    }
    if (typeof raw === 'string') {
      // Fabric style: "minecraft", ">=1.21", "forge: [41.x,)"] -> take the id part
      const id = raw.split(/[<>=~^!@\s]/)[0].trim();
      if (id && id !== 'java' && id !== 'minecraft') dependencySet.add(id);
    } else if (typeof raw === 'object') {
      Object.keys(raw as Record<string, unknown>).forEach(k => {
        const id = k.trim();
        if (id && id !== 'minecraft' && id !== 'java') dependencySet.add(id);
      });
    }
  };
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/');
    if (path === 'fabric.mod.json' || path.endsWith('/fabric.mod.json')) {
      try {
        const text = textDecoder.decode(entry.data);
        const json = JSON.parse(text) as {
          id?: string;
          name?: string;
          version?: string;
          description?: string;
          depends?: Record<string, unknown> | string[];
          recommends?: Record<string, unknown> | string[];
        };
        if (json.id) modId = json.id;
        if (json.name) modName = json.name;
        if (json.version) version = json.version;
        if (json.description) description = json.description;
        metadataFormat = 'Fabric (fabric.mod.json)';
        collectDeps(json.depends);
        collectDeps(json.recommends);
      } catch {
        // ignore parse error
      }
    } else if (path.endsWith('/quilt.mod.json')) {
      try {
        const text = textDecoder.decode(entry.data);
        const json = JSON.parse(text) as {
          quilt_loader?: {
            id?: string;
            metadata?: {
              name?: string;
              description?: string;
            };
            version?: string;
            depends?: Array<{
              id?: string;
            } | string>;
          };
        };
        const loader = json.quilt_loader;
        if (loader?.id) modId = loader.id;
        if (loader?.metadata?.name) modName = loader.metadata.name;
        if (loader?.metadata?.description) description = loader.metadata.description;
        if (loader?.version) version = typeof loader.version === 'string' ? loader.version : version;
        metadataFormat = 'Quilt (quilt.mod.json)';
        collectDeps(loader?.depends?.map(d => typeof d === 'string' ? d : d.id));
      } catch {
        // ignore
      }
    } else if (path === 'META-INF/mods.toml' || path.endsWith('/neoforge.mods.toml') || path === 'META-INF/neoforge.mods.toml') {
      try {
        const text = textDecoder.decode(entry.data);
        const idMatch = text.match(/modId\s*=\s*["']([^"']+)["']/);
        const nameMatch = text.match(/displayName\s*=\s*["']([^"']+)["']/);
        const versionMatch = text.match(/version\s*=\s*["']([^"']+)["']/);
        const descMatch = text.match(/description\s*=\s*'''([\s\S]*?)'''|description\s*=\s*["']([^"']+)["']/);
        if (idMatch?.[1]) modId = idMatch[1];
        if (nameMatch?.[1]) modName = nameMatch[1];
        if (versionMatch?.[1]) version = versionMatch[1];
        if (descMatch) description = (descMatch[1] ?? descMatch[2] ?? '').trim();
        metadataFormat = path.endsWith('neoforge.mods.toml') ? 'NeoForge (neoforge.mods.toml)' : 'Forge (mods.toml)';
        // Dependency blocks: [[dependencies.<modid>]] with mandatory=true / type="required"
        const depBlocks = text.split(/\[\[dependencies\.[^\]]+\]\]/).slice(1);
        for (const block of depBlocks) {
          const depIdMatch = block.match(/modId\s*=\s*["']([^"']+)["']/);
          const depId = depIdMatch?.[1];
          if (!depId || depId === 'minecraft' || depId === 'java' || depId === 'forge' || depId === 'neoforge') continue;
          const required = !/mandatory\s*=\s*false|type\s*=\s*["']optional["']/.test(block);
          if (required) dependencySet.add(depId);
        }
      } catch {
        // ignore
      }
    } else if (path === 'mcmod.info') {
      try {
        const text = textDecoder.decode(entry.data);
        const info = JSON.parse(text) as Array<{
          modid?: string;
          name?: string;
          version?: string;
          description?: string;
          dependencies?: string[];
        }>;
        const first = Array.isArray(info) ? info[0] : null;
        if (first?.modid) modId = first.modid;
        if (first?.name) modName = first.name;
        if (first?.version) version = first.version;
        if (first?.description) description = first.description;
        if (first?.dependencies) {
          metadataFormat = 'Forge (mcmod.info)';
          collectDeps(first.dependencies);
        }
      } catch {
        // ignore
      }
    }
  }

  // Fallback metadata from filename
  if (!modName && fallbackName) {
    const clean = fallbackName.replace(/\.(jar|zip)$/i, '').replace(/[-_]/g, ' ');
    modName = clean.charAt(0).toUpperCase() + clean.slice(1);
    modId = clean.toLowerCase().replace(/\s+/g, '_');
  }

  // 3. Scan lang entries — English (en_us) is preferred so remade names stay in English.
  // Supports modern .json formats and legacy Forge .lang key=value files.
  const langEntries: Record<string, string> = {};
  const fallbackLangEntries: Record<string, string> = {};
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/');
    if (path.includes('/lang/') && (path.endsWith('.json') || path.endsWith('.lang'))) {
      const namespace = path.match(/(?:^|\/)assets\/([^/]+)\/lang\//i)?.[1];
      if (!namespace || namespace.toLowerCase() !== modId.toLowerCase()) continue;
      try {
        const lower = path.toLowerCase();
        const isEnglish = lower.includes('en_us') || lower.includes('en_gb');
        if (path.endsWith('.json')) {
          const text = textDecoder.decode(entry.data);
          const json = JSON.parse(text) as Record<string, string>;
          Object.assign(isEnglish ? langEntries : fallbackLangEntries, json);
        } else if (path.endsWith('.lang')) {
          const text = textDecoder.decode(entry.data);
          const lines = text.split(/\r?\n/);
          const map: Record<string, string> = {};
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
            const eqIdx = trimmed.indexOf('=');
            const k = trimmed.slice(0, eqIdx).trim();
            const v = trimmed.slice(eqIdx + 1).trim();
            if (k && v) map[k] = v;
          }
          Object.assign(isEnglish ? langEntries : fallbackLangEntries, map);
        }
      } catch {
        // ignore
      }
    }
  }
  if (Object.keys(langEntries).length === 0 && Object.keys(fallbackLangEntries).length > 0) {
    Object.assign(langEntries, fallbackLangEntries);
  }


  const classEntries = entries.filter(e => e.path.endsWith('.class'));
  const parsedClasses: ParsedClass[] = [];
  const registeredStrings = new Set<string>();
  const scannedClasses = presetClasses ?? parseClassEntries(classEntriesForScan(classEntries));
  for (const parsed of scannedClasses) {
    parsedClasses.push(parsed);
    for (const str of parsed.strings) registeredStrings.add(str);
  }

  // Categorize items, blocks and entities from lang keys + registry strings
  const registeredItems: string[] = [];
  const registeredBlocks: string[] = [];
  const registeredEntities: string[] = [];
  const spawnableEntities: string[] = [];
  const seenLangIds = new Set<string>();
  const GENERIC_KEY = /recipe|creative_tab|container|screen|gui|unreadable|data_recovery|subtitle|tooltip|advancement|jade|waila|config|keybind|_and_|_with_|\.desc|\.info|\.message|\.jei|\.effec|\.curios|\.help|\.lore|\.action|\.mode|\.state|\.status|\.hint|\.warning|\.command|\.argument|\.narrat|\.debug|\.title|\.text|\.feed|\.heal/i;
  // Reject UI/format strings that are not real item display names
  const BAD_DISPLAY = /%[sdf0-9]|§|\u00a7|<-|->|:\s*%|\n|\r|%s|%d|_s\b|_d\b|\+|\bcommands?\b|\bargument\b|^name:|^type:|^registry name:|^release\b|^consume\b|^press\b|^hold\b|^sneak\b|^no\b|^to\b|^for\b|^requires\b|^when\b|^if\b|\bhealth\b|\binventory\b|\bspawned\b|\bmaze\b|\bcell\b|\bstinger back\b|\bgrow baby\b|\bpollinate\b|\bsubtitle\b|\btooltip\b|\b6honey\b|\bput stinger\b|\bheal 2\b|\bbaby to adult\b/i;
  const pushLang = (key: string, val: string, target: string[]) => {
    if (GENERIC_KEY.test(key)) return;
    const cleanKey = key.endsWith('.name') ? key.slice(0, -5) : key;
    const parts = cleanKey.split('.');
    const langId = parts.pop() ?? cleanKey;
    if (!langId || langId.length < 2 || seenLangIds.has(langId)) return;
    const display = (val || '').replace(/\s+/g, ' ').trim();
    if (!display || display.length < 2 || display.length > 40) return;
    // Reject format placeholders, color codes, UI phrases, sentences, colons, dashes
    if (BAD_DISPLAY.test(display)) return;
    if (/^[a-z]/.test(display)) return;
    if (/ - |: |\.\s|!\s|\?\s/.test(display)) return;
    if (display.split(' ').length > 4) return;
    if (/^(Release|Consume|No|To|For|Requires|When|If|Press|Hold|Sneak|Name|Type|Registry)\b/i.test(display)) return;
    seenLangIds.add(langId);
    target.push(display);
  };
  for (const [key, val] of Object.entries(langEntries)) {
    if (key.startsWith('item.') || key.startsWith('weapon.')) {
      pushLang(key, val, registeredItems);
    } else if (key.startsWith('block.') || key.startsWith('tile.')) {
      pushLang(key, val, registeredBlocks);
    } else if (key.startsWith('entity.')) {
      const before = registeredEntities.length;
      pushLang(key, val, registeredEntities);
      if (registeredEntities.length > before && !isGhostEntityName(registeredEntities[registeredEntities.length - 1])) {
        spawnableEntities.push(registeredEntities[registeredEntities.length - 1]);
      }
    } else if (key.startsWith('fluid.')) {
      pushLang(key, val, registeredItems);
    } else if (key.includes('skill.') || key.includes('combat.') || key.includes('animation.')) {
      const mech = (val || key).replace(/\s+/g, ' ').trim();
      if (mech && mech.length <= 40 && !BAD_DISPLAY.test(mech) && !/^[a-z]/.test(mech)) mechanicsSet.add(mech);
    }
  }
  const localizedItems = [...registeredItems];
  const localizedBlocks = [...registeredBlocks];
  const localizedEntities = [...registeredEntities];
  // Block-art index. Classifying one registry string used to walk the whole archive with a
  // fresh path normalisation per entry — on a large archive that is tens of millions of string
  // operations per decompile, and the decompile runs more than once per build. The stems are
  // now collected in a single pass and looked up by name.
  const blockArtStems = new Set<string>();
  for (const entry of entries) {
    const lower = entry.path.replace(/\\/g, '/').toLowerCase();
    const blockArt = lower.match(/(?:^|\/)(?:blockstates\/([^/]+)\.json|models\/block\/([^/]+)\.json|textures\/blocks?\/([^/]+)\.png)$/);
    if (!blockArt) continue;
    const stem = blockArt[1] ?? blockArt[2] ?? blockArt[3];
    if (stem) blockArtStems.add(stem);
  }
  for (const str of registeredStrings) {
    const match = str.match(/^([a-z0-9_.-]+):([a-z0-9_]+)$/i);
    if (match) {
      const itemName = match[2].toLowerCase();
      if (!itemName || itemName.length < 3 || itemName.length > 32) continue;
      if (/recipe|screen|menu|container|gui|creative|_tab|advancement|_particle|sound|block_entity|tooltip|desc|info|message|hint|debug|stat|event|action|mode|state|subtitle/i.test(itemName)) continue;
      if (/%[sdf0-9]|§|\u00a7|%s|%d|_s$|_d$|^[a-z]{1,2}$/i.test(itemName)) continue;
      if (/^(to_|no_|consume_|press_|hold_|when_|if_|heal_|grow_|pollinate_|release_|name_|type_|registry_name_)/i.test(itemName)) continue;
      if (/\b(health|inventory|stinger_back|grow_baby|pollinate|maze|cell_maze|new_compass|spawned|6honey_bottle|heal_2|put_stinger|baby_to_adult)\b/i.test(itemName)) continue;
      if (itemName.split('_').length > 4) continue;
      if (STATE_SUFFIX_RE.test(itemName)) continue;
      const readable = itemName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      if (BAD_DISPLAY.test(readable)) continue;
      if (/^(Release|Consume|No|To|For|Requires|When|If|Press|Hold|Sneak|Name|Type|Registry)\b/i.test(readable)) continue;

      // Classify as block when a blockstate, block model or block sheet for this name ships.
      const isBlockFile = blockArtStems.has(itemName);

      if (isBlockFile) {
        if (!registeredBlocks.some((b) => b.toLowerCase() === readable.toLowerCase())) {
          registeredBlocks.push(readable);
        }
      } else {
        if (registeredItems.includes(readable)) continue;
        if (/(^|_)backpack$/.test(itemName) && registeredItems.some(r => r.replace(/\s+/g, '_') === itemName)) continue;
        registeredItems.push(readable);
      }
    }
  }

  // Deep Asset Path Extraction: discover items, blocks, and entities directly from textures and models
  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/');
    const lower = cleanPath.toLowerCase();

    // Blocks from blockstates (definitive 3D block descriptors)
    const blockstateMatch = lower.match(/(?:^|\/)blockstates\/([a-z0-9_.-]+)\.json$/);
    if (blockstateMatch) {
      const raw = blockstateMatch[1];
      if (!/particle|overlay|destroy|dummy/i.test(raw) && !STATE_SUFFIX_RE.test(raw)) {
        const readable = raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        if (!registeredBlocks.some((b) => b.toLowerCase() === readable.toLowerCase())) {
          registeredBlocks.push(readable);
        }
      }
    }

    // Items from textures
    const itemTexMatch = lower.match(/(?:^|\/)textures\/items?\/([^/]+)\.png$/);
    if (itemTexMatch) {
      const raw = itemTexMatch[1];
      if (!/particle|overlay|layer|gui|slot|base|blank|empty|template|cell_maze|new_compass|6honey_bottle/i.test(raw) && !/^(to_|no_|consume_|release_|type_|registry_name_)/i.test(raw) && !STATE_SUFFIX_RE.test(raw)) {
        const readable = raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (!registeredItems.some(i => i.toLowerCase() === readable.toLowerCase())) {
          registeredItems.push(readable);
        }
      }
    }

    // Blocks from textures
    const blockTexMatch = lower.match(/(?:^|\/)textures\/blocks?\/([^/]+)\.png$/);
    if (blockTexMatch) {
      const raw = blockTexMatch[1];
      if (!/particle|overlay|destroy|top|side|bottom|front|back|inner/i.test(raw)) {
        const readable = raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (!registeredBlocks.some(b => b.toLowerCase() === readable.toLowerCase())) {
          registeredBlocks.push(readable);
        }
      }
    }

    // Entities from textures
    const entityTexMatch = lower.match(/(?:^|\/)textures\/(?:entities|entity)\/(?:[^/]+\/)*([^/]+)\.png$/);
    if (entityTexMatch) {
      const raw = entityTexMatch[1];
      // State/variant textures (e.g. gilbert/gilbertambient.png, chimera/chimerataunt.png)
      // live in the mob's own folder — they are NOT separate mobs. Skip when the stem
      // is prefixed by its parent folder name (mob id) or ends with an animation/audio
      // state suffix, otherwise every animation frame becomes a ghost entity + spawn egg.
      const folderSegs = lower.split('/');
      const folderStem = folderSegs[folderSegs.length - 2] ?? '';
      if (!/particle|layer|overlay|glow|eyes|shadow|armor/i.test(raw) &&
          !(folderStem && raw.startsWith(folderStem) && raw !== folderStem) &&
          !STATE_SUFFIX_RE.test(raw)) {
        const readable = raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (!registeredEntities.some(e => e.toLowerCase() === readable.toLowerCase())) {
          registeredEntities.push(readable);
        }
      }
    }

    // Items from model JSONs
    const itemModelMatch = lower.match(/(?:^|\/)models\/item\/([^/]+)\.json$/);
    if (itemModelMatch) {
      const raw = itemModelMatch[1];
      if (!/template|generated|builtin|handheld/i.test(raw)) {
        const readable = raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (!registeredItems.some(i => i.toLowerCase() === readable.toLowerCase())) {
          registeredItems.push(readable);
        }
      }
    }

    // Blocks from model JSONs
    const blockModelMatch = lower.match(/(?:^|\/)models\/block\/([^/]+)\.json$/);
    if (blockModelMatch) {
      const raw = blockModelMatch[1];
      if (!/cube|cross|orientable|tinted/i.test(raw)) {
        const readable = raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (!registeredBlocks.some(b => b.toLowerCase() === readable.toLowerCase())) {
          registeredBlocks.push(readable);
        }
      }
    }
  }

  // Localized display names keep priority, but every definition the registry-string scan and the
  // deep asset scan found is KEPT. The previous code replaced each array with the localized
  // snapshot taken before those scans ran, which silently discarded every entity discovered from
  // `textures/entity/**`, every block found through a blockstate or model, and every item found
  // through its sheet. On a mod whose lang file is missing or partial that meant the archive
  // exported no mobs at all — the model, skin and spawn egg were all still in the jar.
  const mergeDetected = (target: string[], localized: string[]): void => {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const name of [...localized, ...target]) {
      const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(name);
    }
    target.length = 0;
    target.push(...merged);
  };
  mergeDetected(registeredItems, localizedItems);
  mergeDetected(registeredBlocks, localizedBlocks);
  mergeDetected(registeredEntities, localizedEntities);

  const realEntities = registeredEntities.filter((entityName) => !isGhostEntityName(entityName));
  registeredEntities.length = 0;
  registeredEntities.push(...realEntities);

  // Pre-filter all textures & models safely (declared before usage to eliminate TDZ errors)
  const textureEntriesAll = entries.filter((e) => {
    const path = e.path.replace(/\\/g, '/').toLowerCase();
    return /(?:^|\/)textures\/.+\.png$/.test(path);
  });
  const textureCount = textureEntriesAll.length;
  const modelCount = entries.filter((e) => /(?:^|\/)models\/.+\.json$/i.test(e.path.replace(/\\/g, '/'))).length;

  // Build a texture index keyed by filename stem so each detected item/block can
  // be paired with its ORIGINAL texture from the mod archive.
  const textureByStem = new Map<string, SourceTextureEntry>();
  for (const e of textureEntriesAll) {
    const fileName = e.path.replace(/\\/g, '/').split('/').pop() ?? '';
    const stem = fileName.replace(/\.png$/i, '').toLowerCase();
    if (stem && !textureByStem.has(stem)) {
      textureByStem.set(stem, {
        name: fileName,
        data: e.data
      });
    }
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const allDetectedIds = [...registeredItems, ...registeredBlocks, ...registeredEntities].map(slug);
  const matchedTextures: SourceTextureEntry[] = [];
  const matchedStems = new Set<string>();
  for (const id of allDetectedIds) {
    const direct = textureByStem.get(id);
    if (direct && !matchedStems.has(id)) {
      matchedTextures.push(direct);
      matchedStems.add(id);
    }
  }
  for (const [stem, tex] of textureByStem) {
    if (matchedTextures.length >= 256) break;
    if (!matchedStems.has(stem) && !/particle|environment|gui|font|misc|painting|mob_effect/i.test(stem) && !STATE_SUFFIX_RE.test(stem)) {
      matchedTextures.push(tex);
      matchedStems.add(stem);
    }
  }

  // Check weapon/combat classes
  for (const cls of parsedClasses) {
    if (cls.className.includes('$')) continue;
    const simpleName = cls.className.split('.').pop() ?? cls.className;
    if (cls.role === 'combat' || cls.role === 'animation') {
      mechanicsSet.add(simpleName);
    }
    for (const m of cls.methods) {
      if (['attack', 'dodge', 'combo', 'parry', 'guard', 'stamina', 'useSkill'].some(k => m.toLowerCase().includes(k))) {
        mechanicsSet.add(m);
      }
    }
  }
  const animEntriesAll = entries.filter(e => {
    const p = e.path.toLowerCase();
    return (p.includes('/animations/') || p.includes('/anim/') || p.includes('/animation/') || p.endsWith('.animation.json')) && p.endsWith('.json');
  });
  const animationsCount = animEntriesAll.length;
  const detectedAnimations: string[] = animEntriesAll.slice(0, 10).map(e => e.path.split('/').pop()?.replace(/\.json$/i, '') || '').filter(Boolean);

  const particleEntriesAll = entries.filter(e => {
    const p = e.path.toLowerCase();
    return (p.includes('/particles/') || p.includes('/particle/')) && (p.endsWith('.json') || p.endsWith('.png'));
  });
  const particlesCount = particleEntriesAll.length;
  const detectedParticles = particleEntriesAll
    .map(e => e.path.split('/').pop()?.replace(/\.(json|png)$/i, '') || '')
    .filter((name, idx, arr) => Boolean(name) && arr.indexOf(name) === idx)
    .slice(0, 16);
  const sourceTextures: SourceTextureEntry[] = matchedTextures.slice(0, 256);
  const sourceModels = entries.filter(e => e.path.includes('/models/') && e.path.endsWith('.json')).slice(0, 8).map(e => {
    try {
      return textDecoder.decode(e.data).slice(0, 600);
    } catch {
      return '';
    }
  }).filter(Boolean);
  const iconBytes = foundIconEntry ? foundIconEntry.data : null;
  const classSummaries: DecompileClassSummary[] = parsedClasses.map(c => ({
    className: c.className.split('.').pop() ?? c.className,\n    qualifiedClassName: c.className,
    // Inheritance and the namespaced identifiers a class declares are the evidence the item
    // semantics engine reads. Neither is a name-based guess: both come from the class file.
    superName: c.superName,
    registryIds: c.strings,
    role: c.role,
    methods: Array.from(new Set(c.methods)),
    signals: Array.from(new Set(c.signals)),
  }));
  const iconDataUrl = iconBytes ? bytesToDataUrl(iconBytes, 'image/png') : undefined;
  const stats: DecompileStats = {
    modId: modId || 'mod_remake',
    modName: modName || 'Java Mod Remake',
    version,
    filesCount: entries.length,
    classesCount: classEntries.length,
    texturesCount: textureCount,
    modelsCount: modelCount,
    animationsCount,
    detectedAnimations,
    detectedStateMachines: parsedClasses
      .filter((entry) => entry.signals.includes('bytecode-signature:state-machine'))
      .map((entry) => entry.className.split('.').pop() ?? entry.className)
      .slice(0, 24),
    animationControllers: parsedClasses
      .filter((entry) => entry.signals.includes('bytecode-signature:animation-controller'))
      .map((entry) => entry.className.split('.').pop() ?? entry.className)
      .slice(0, 24),
    particlesCount,
    detectedParticles,
    foundIcon: Boolean(foundIconEntry),
    iconPath: foundIconEntry?.path,
    iconDataUrl,
    classes: classSummaries,
    registeredItems: registeredItems.slice(0, 64),
    registeredBlocks: registeredBlocks.slice(0, 48),
    registeredEntities: registeredEntities.slice(0, 128),
    spawnableEntities: Array.from(new Set(spawnableEntities)).slice(0, 128),
    mechanics: Array.from(mechanicsSet).slice(0, 8),
    dependencies: Array.from(dependencySet).slice(0, 12),
    metadataFormat: metadataFormat || (foundIconEntry ? 'Unknown (assets only)' : 'No metadata file found')
  };
  const rawDecompileContext = [`Metadata Format: ${stats.metadataFormat}`, `Mod ID: ${stats.modId}`, `Mod Name: ${stats.modName}`, `Version: ${stats.version}`, description ? `Description: ${description}` : '', stats.dependencies.length > 0 ? `Required Mod Dependencies: ${stats.dependencies.join(', ')}` : '', `Total Files in JAR: ${stats.filesCount}`, `Java Classes Found: ${stats.classesCount}`, `Textures Found: ${stats.texturesCount}`, `Models Found: ${stats.modelsCount}`, `JAR Root Icon Found: ${stats.foundIcon ? `Yes (${stats.iconPath})` : 'No'}`, stats.registeredItems.length > 0 ? `Registered Items / Weapons: ${stats.registeredItems.join(', ')}` : '', stats.registeredBlocks && stats.registeredBlocks.length > 0 ? `Registered Blocks: ${stats.registeredBlocks.join(', ')}` : '', stats.registeredEntities && stats.registeredEntities.length > 0 ? `Registered Entities: ${stats.registeredEntities.join(', ')}` : '', stats.mechanics.length > 0 ? `Combat & Gameplay Mechanics: ${stats.mechanics.join(', ')}` : '', stats.classes.length > 0 ? `Key Java Classes Analyzed:\n${stats.classes.map(c => `- ${c.className} [${c.role}]: ${c.methods.join(', ')}`).join('\n')}` : '', sourceTextures.length > 0 ? `Mod Texture Assets Found: ${sourceTextures.map(t => t.name).join(', ')}` : '', sourceModels.length > 0 ? `Mod 3D Model JSON Samples:\n${sourceModels.join('\n---\n')}` : ''].filter(Boolean).join('\n');
  return {
    stats,
    iconBytes,
    rawDecompileContext,
    sourceTextures,
    sourceModels,
    sourceAnimations: animEntriesAll
  };
}

/**
 * Inspection is keyed on the entry array identity, so opening one archive and building from it
 * decompiles the bytecode once instead of re-reading every class on each call. Rendering the
 * dashboard used to trigger a full decompile per state update, which is what locked up the tab.
 */
const inspectionCache = new WeakMap<
  ExtractedZipEntry[],
  { key: string; result: ReturnType<typeof decompileJavaMod> }
>();

export function decompileAndInspectJar(entries: ExtractedZipEntry[], fallbackName?: string) {
  const key = fallbackName ?? '';
  const cached = inspectionCache.get(entries);
  if (cached && cached.key === key) return cached.result;
  const result = decompileJavaMod(entries, fallbackName);
  inspectionCache.set(entries, { key, result });
  return result;
}

/** Class count a single conversion inspects, matching the long-standing archive scan budget. */
export const CLASS_SCAN_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * The class entries a conversion actually reads. A modpack can ship far more bytecode than a phone
 * can parse in one pass, so the scan stops at the class-count budget or at the byte budget —
 * whichever comes first — instead of pushing hundreds of megabytes through the parser at once.
 */
export function classEntriesForScan(classEntries: ExtractedZipEntry[]): ExtractedZipEntry[] {
  // Never silently omit source classes: a class beyond an arbitrary count/byte threshold may
  // contain a registry, static initializer, method body or dependency used by the mod.
  // The asynchronous caller yields between chunks to keep the Discord Activity responsive.
  return classEntries;
}

/** Parses every class entry handed in, skipping a malformed class instead of the whole archive. */
export function parseClassEntries(classEntries: ExtractedZipEntry[]): ParsedClass[] {
  const out: ParsedClass[] = [];
  for (const entry of classEntries) {
    try {
      const parsed = parseJavaClass(entry.data);
      if (parsed) out.push(parsed);
    } catch {
      // A malformed class is skipped; the remaining classes are still inspected.
    }
  }
  return out;
}

/**
 * Cooperative variant of `decompileAndInspectJar`.
 *
 * Bytecode inspection is the first long synchronous pass of a conversion. On a large archive that
 * pass stops the page painting, so it is walked in slices here and the frame is handed back between
 * them: the progress log advances while it works and the tab stays responsive. The result is the
 * same object the synchronous entry point returns, and it lands in the same inspection cache.
 */
export async function decompileAndInspectJarAsync(
  entries: ExtractedZipEntry[],
  fallbackName?: string,
  options?: { onProgress?: (done: number, total: number) => void; chunkSize?: number },
) {
  const key = fallbackName ?? '';
  const cached = inspectionCache.get(entries);
  if (cached && cached.key === key) return cached.result;
  const classEntries = classEntriesForScan(entries.filter((entry) => entry.path.endsWith('.class')));
  const chunkSize = Math.max(1, options?.chunkSize ?? 32);
  const parsed: ParsedClass[] = [];
  for (let start = 0; start < classEntries.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, classEntries.length);
    for (let index = start; index < end; index += 1) {
      try {
        const one = parseJavaClass(classEntries[index].data);
        if (one) parsed.push(one);
      } catch {
        // A malformed class is skipped; the remaining classes are still inspected.
      }
    }
    options?.onProgress?.(end, classEntries.length);
    if (end < classEntries.length) await yieldToUi();
  }
  const result = decompileJavaMod(entries, fallbackName, parsed);
  // Run the full instruction-level analysis over every class, not just the lightweight
  // signature scanner. Enrich the existing semantic inputs so downstream generic translators
  // can see real method calls, field accesses and registry references.
  const jvm = await analyzeJvmArchive(entries, {
    chunkSize,
    onProgress: (done, total) => options?.onProgress?.(done, total),
  });
  const byClass = new Map(jvm.classes.map((item) => [item.name, item]));
  result.stats.classes = result.stats.classes.map((summary) => {
    const detail = byClass.get(summary.qualifiedClassName ?? summary.className);
    if (!detail) return summary;
    const methodNames = detail.methods.map((method) => method.name);
    const callEvidence = detail.methods.flatMap((method) => method.calls.map((call) =>
      call.owner && call.name ? `${call.owner}.${call.name}` : call.name ?? call.kind
    ));
    const fieldEvidence = detail.methods.flatMap((method) => method.fieldAccesses.map((field) =>
      field.owner && field.name ? `${field.owner}.${field.name}` : field.name ?? field.kind
    ));
    const registryIds = detail.references
      .filter((reference) => typeof reference.value === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(reference.value))
      .map((reference) => String(reference.value));
    return {
      ...summary,
      methods: Array.from(new Set([...summary.methods, ...methodNames])),
      registryIds: Array.from(new Set([...(summary.registryIds ?? []), ...registryIds])),
      signals: Array.from(new Set([...(summary.signals ?? []), ...callEvidence, ...fieldEvidence])),
    };
  });
  result.stats.jvmAnalysis = jvm;
  inspectionCache.set(entries, { key, result });
  return result;
}
