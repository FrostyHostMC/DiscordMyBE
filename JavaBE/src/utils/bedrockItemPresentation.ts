import type { IntermediateModel } from '@/utils/javaModelIR';

export interface RenderOffsetsView {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface ItemPresentationResult {
  /** Bedrock `minecraft:render_offsets` payload (attachable component), or null. */
  renderOffsets: Record<string, Record<string, RenderOffsetsView>> | null;
  /** Java display perspectives that Bedrock cannot express for a custom item. */
  unrepresentable: string[];
  /** Item model overrides recovered from the Java model (reported, never faked). */
  overrides: Array<{ model: string; predicate: string }>;
}

const HAND_VIEWS: Record<string, [hand: string, view: string]> = {
  firstperson_righthand: ['main_hand', 'first_person'],
  thirdperson_righthand: ['main_hand', 'third_person'],
  firstperson_lefthand: ['off_hand', 'first_person'],
  thirdperson_lefthand: ['off_hand', 'third_person'],
};

const round4 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Translates Java item `display` transforms into Bedrock render offsets.
 *
 * Java expresses hand placement per perspective (`firstperson_righthand`, …) with
 * translations in 1/16-block model units; Bedrock attachables take per-hand,
 * per-view position/rotation/scale in block units. Perspectives that Bedrock has no
 * custom-item equivalent for (`gui`, `ground`, `fixed`, `head`) are reported instead
 * of being silently dropped or invented.
 */
export function writeItemPresentation(ir: IntermediateModel): ItemPresentationResult {
  const hands: Record<string, Record<string, RenderOffsetsView>> = {};
  const unrepresentable: string[] = [];

  for (const [perspective, transform] of Object.entries(ir.display)) {
    const target = HAND_VIEWS[perspective];
    if (!target) {
      unrepresentable.push(perspective);
      continue;
    }
    const [hand, view] = target;
    hands[hand] = hands[hand] ?? {};
    hands[hand][view] = {
      position: [
        round4(transform.translation[0] / 16),
        round4(transform.translation[1] / 16),
        round4(transform.translation[2] / 16),
      ],
      rotation: [round4(transform.rotation[0]), round4(transform.rotation[1]), round4(transform.rotation[2])],
      scale: [round4(transform.scale[0]), round4(transform.scale[1]), round4(transform.scale[2])],
    };
  }

  const overrides = ir.overrides.map((override) => ({
    model: override.model,
    predicate: Object.entries(override.predicate)
      .map(([key, value]) => `${key}=${value}`)
      .join(', '),
  }));

  return {
    renderOffsets: Object.keys(hands).length > 0 ? hands : null,
    unrepresentable,
    overrides,
  };
}

/** One-line, evidence-based presentation summary for the conversion log. */
export function describeItemPresentation(ir: IntermediateModel, result: ItemPresentationResult): string {
  const parts: string[] = [];
  if (result.renderOffsets) {
    const views = Object.entries(result.renderOffsets)
      .map(([hand, viewMap]) => `${hand}:${Object.keys(viewMap).join('+')}`)
      .join(', ');
    parts.push(`render offsets from Java display (${views})`);
  } else {
    parts.push('no Java display transforms in the model');
  }
  if (result.unrepresentable.length > 0) {
    parts.push(`not representable in Bedrock: ${result.unrepresentable.join(', ')}`);
  }
  if (result.overrides.length > 0) {
    parts.push(
      `${result.overrides.length} Java model override(s) recovered (predicates ${result.overrides
        .map((override) => override.predicate)
        .join(' | ')}) — Bedrock resolves custom items through components, so these are reported, not faked`,
    );
  }
  if (ir.uvLock) parts.push('uv-lock detected');
  return parts.join('; ');
}