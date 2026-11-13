// Portable JavaBE asset-path manifest.
//
// The original hosted template injected this map during export, but did not
// include it in the downloaded source archive. Keep canonical Bedrock paths
// here so local builds and the standalone Discord Activity are reproducible.
const svg = (body: string, color = '#c4a5ff') =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;

const assetsData = {
  // Small interface artwork is embedded so the Activity has no remote asset dependency.
  IMAGE_BSBQ: svg('<path d="M32 7 54 19v26L32 57 10 45V19L32 7Z"/><path d="m21 32 7 7 15-16"/>'),
  IMAGE_CZVT: svg('<circle cx="32" cy="32" r="23"/><path d="M32 18v16l11 7"/>'),
  IMAGE_IVKT: svg('<path d="m32 5 5.8 18.2L56 29l-18.2 5.8L32 53l-5.8-18.2L8 29l18.2-5.8L32 5Z"/><path d="m49 43 2.8 8.2L60 54l-8.2 2.8L49 65l-2.8-8.2L38 54l8.2-2.8L49 43Z"/>'),
  IMAGE_JHZD: svg('<path d="M12 14h40v36H12z"/><path d="m20 33 8 8 17-19"/>'),
  IMAGE_OVJL: svg('<path d="M32 43V10m0 0L20 22m12-12 12 12"/><path d="M12 40v12h40V40"/>'),
  IMAGE_SHTS: svg('<path d="m32 7 22 12v26L32 57 10 45V19L32 7Z"/><path d="m10 19 22 13 22-13M32 32v25"/>'),
  IMAGE_YYYX: svg('<rect x="9" y="9" width="46" height="46" rx="7"/><path d="m9 25 23 13 23-13M32 38v17"/>'),
  IMAGE_GHEI: svg('<path d="m14 50 28-36 8 7-28 36-8-7Z"/><path d="m9 55 10-2m19-33 8 7"/>'),
  IMAGE_KNHI: svg('<rect x="8" y="8" width="48" height="48" rx="9"/><path d="M18 20h28M18 32h28M18 44h18"/>'),

  // Java archive icon names accepted by the decompiler.
  IMAGE_OGIN: 'pack.png',
  IMAGE_KPWD: 'icon.png',
  IMAGE_AYWF: 'logo.png',
  IMAGE_BWWX: 'mod.png',
  IMAGE_YRUS: 'pack_icon.png',
  IMAGE_QEIG: 'pack_icon.png',
  IMAGE_ACOC: '.png',
  IMAGE_XMBV: '.jpg',
  IMAGE_RQDC: '.jpeg',
  IMAGE_LGOJ: '.webp',

  // Deterministic fixture and canonical texture paths used by the porting engine.
  IMAGE_ZYOY: 'textures/items/gem_shard.png',
  IMAGE_BBRW: 'textures/items/rune_blade.png',
  IMAGE_NYZS: 'textures/blocks/gem_lamp_on.png',
  IMAGE_PLFC: 'textures/blocks/gem_lamp_off.png',
  IMAGE_AMTV: 'textures/blocks/rune_gate.png',
  IMAGE_QFUA: 'textures/blocks/forge_front.png',
  IMAGE_DYBX: 'textures/entity/stone_sentinel.png',
  IMAGE_COPN: 'textures/entity/iron_colossus.png',
  IMAGE_HUGP: 'textures/entity/arcane_warden.png',
  IMAGE_FQNQ: 'textures/models/armor/warden_layer_1.png',
  IMAGE_KLMF: 'textures/models/armor/warden_layer_2.png',
  IMAGE_GZRP: 'textures/items/warden_helmet.png',
  IMAGE_YYPJ: 'textures/items/rune_spear.png',
  IMAGE_OUDO: 'textures/blocks/pipe.png',
  IMAGE_WAUV: 'textures/blocks/uv_relay.png',
  IMAGE_FQCN: 'textures/entity/alpha.png',
  IMAGE_APER: 'textures/entity/real.png',
  IMAGE_YIGA: 'textures/entity/missing_skin_expected.png',
  IMAGE_EOGO: 'textures/entity/missing_skin.png',
  IMAGE_LDJY: 'textures/particle/mob_glow.png',
  IMAGE_QDFQ: 'textures/items/head_clava_spawn_egg.png',
  IMAGE_KWNL: 'textures/blocks/stone.png',
  IMAGE_RDSE: 'textures/entity/capac.png',
  IMAGE_FJGP: 'textures/entity/one_mob_spawn_egg.png',
  IMAGE_IWBM: 'textures/entity/broken_a.png',
  IMAGE_LZSV: 'textures/entity/broken_b.png',
  IMAGE_EFUU: 'item/tools/runeblade.png',

  // Audio fixture paths. The sound converter rewrites these to the detected
  // container extension before creating Bedrock sound definitions.
  AUDIO_RWYF: 'assets/mymod/sounds/chime.ogg',
  AUDIO_OAXL: 'assets/mymod/sounds/wav_payload.ogg',
  AUDIO_HEJW: 'assets/mymod/sounds/music.mp3',
  AUDIO_QOKI: 'assets/mymod/sounds/empty.ogg',
  AUDIO_DWFM: 'sounds/mymod/chime.ogg, sounds/mymod/wav_payload.wav',
  AUDIO_YVYW: 'sounds/mymod/chime.ogg',
  AUDIO_YGZQ: 'sounds/mymod/wav_payload.wav',
  AUDIO_TOWT: 'sounds/mymod/wav_payload.wav',
  AUDIO_SIEC: 'sounds/mymod/wav_payload.ogg',
  AUDIO_NQCR: 'sounds/mymod/wav_payload.ogg',
  AUDIO_OKAF: 'sounds/mymod/wav_payload.wav',
  AUDIO_XBKL: 'assets/mymod/sounds/music.mp3',
  AUDIO_CLWM: 'assets/mymod/sounds/empty.ogg',
  AUDIO_GFVJ: 'assets/mymod/sounds/hurt.ogg',
} as const;

export default assetsData;
