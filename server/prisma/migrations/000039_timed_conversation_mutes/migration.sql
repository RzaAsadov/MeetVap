alter table "ConversationMember"
add column if not exists "mutedUntil" timestamp(3);
