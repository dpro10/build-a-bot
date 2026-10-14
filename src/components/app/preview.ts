/**
 * A chat message as one plain line, for previews (the sidebar, the bot cards):
 * markdown marks, links and list bullets come out, whitespace collapses.
 */
export function plainPreview(text: string, max = 140): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}*_])[*_]([^*_\n]+)[*_](?=$|[^\p{L}\p{N}*_])/gu, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
