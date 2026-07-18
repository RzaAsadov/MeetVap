export function isConversationMembershipMuted(member?: { mutedAt?: Date | null; mutedUntil?: Date | null } | null) {
  return !!member?.mutedAt && (!member.mutedUntil || member.mutedUntil.getTime() > Date.now());
}
