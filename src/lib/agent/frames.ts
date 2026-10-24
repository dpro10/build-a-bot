/**
 * The tags the agent loop wraps text in: <system_directive> (the platform's own instructions),
 * <untrusted_content> (what a tool brought back) and <message_from_contact> (someone other than
 * the owner). Text that isn't the platform's own must not open or close one, or an email could
 * end its wrapper and start a "platform" instruction: its look-alikes lose their angle brackets.
 */
const FRAME = /<\s*\/?\s*(system_directive|untrusted_content|message_from_contact)\b[^>]*>/gi;

export function defuse(text: string): string {
  return text.replace(FRAME, (tag) => tag.replace(/</g, "‹").replace(/>/g, "›"));
}
