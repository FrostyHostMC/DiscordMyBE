const textDecoder = new TextDecoder();

/** Literal sub-paths a renderer/model class can use to name an asset file. */
const RESOURCE_HINT = /(?:^|\/)(?:textures|geo|animations?|models|entity)\//i;

export interface ScannedClassResources {
  /** Simple class name, package stripped (`FooRenderer`). */
  className: string;
  /** Fully qualified superclass, used as lineage evidence. */
  superName: string;
  /** Asset resource literals this class declares (`textures/entity/foo`, `geo/foo.geo.json`, …). */
  refs: string[];
}

function readUtf8(utf8: Array<string | undefined>, index: number | undefined): string {
  if (!index || index <= 0) return '';
  return utf8[index] ?? '';
}

/**
 * Reads a Java class file's constant pool and returns the asset resource literals it
 * declares. A Java mod's renderer and model classes spell out the exact skin, geometry
 * and animation files they load, so these strings are the binding authority — a file
 * name guess is never needed when the class states the answer.
 */
export function scanClassResources(data: Uint8Array): ScannedClassResources | null {
  try {
    if (!data || data.length < 32) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, false) !== 0xcafebabe) return null;
    const count = view.getUint16(8, false);
    if (count < 4) return null;
    const utf8: Array<string | undefined> = new Array(count);
    const classNames = new Map<number, number>();
    let offset = 10;
    for (let i = 1; i < count && offset < data.length; i++) {
      const tag = view.getUint8(offset++);
      if (tag === 1) {
        const len = view.getUint16(offset, false);
        offset += 2;
        if (offset + len > data.length) break;
        utf8[i] = textDecoder.decode(data.subarray(offset, offset + len));
        offset += len;
      } else if (tag === 7) {
        classNames.set(i, view.getUint16(offset, false));
        offset += 2;
      } else if (tag === 8 || tag === 16 || tag === 19 || tag === 20) {
        offset += 2;
      } else if (tag === 15) {
        offset += 3;
      } else if (tag === 3 || tag === 4 || tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) {
        offset += 4;
      } else if (tag === 5 || tag === 6) {
        offset += 8;
        i++;
      } else {
        break;
      }
    }
    if (offset + 6 > data.length) return null;
    offset += 2;
    const thisIdx = view.getUint16(offset, false);
    offset += 2;
    const superIdx = view.getUint16(offset, false);
    const rawName = readUtf8(utf8, classNames.get(thisIdx));
    const rawSuper = readUtf8(utf8, classNames.get(superIdx));
    if (!rawName) return null;
    const refs: string[] = [];
    for (const value of utf8) {
      if (!value || value.length < 6 || value.length > 120) continue;
      if (!RESOURCE_HINT.test(value)) continue;
      if (refs.includes(value)) continue;
      refs.push(value);
      if (refs.length >= 24) break;
    }
    return {
      className: rawName.split('/').pop() ?? rawName,
      superName: rawSuper.replace(/\//g, '.'),
      refs,
    };
  } catch {
    return null;
  }
}