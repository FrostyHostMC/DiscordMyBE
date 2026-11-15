/**
 * Keep Discord display names faithful to the user's chosen text while removing
 * emoji glyphs from the AutoBE interface. Other punctuation and special characters
 * are deliberately left untouched.
 */
export const cleanDiscordDisplayName = (value?: string | null): string => {
  if (!value) return '';
  return value.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, '');
};
