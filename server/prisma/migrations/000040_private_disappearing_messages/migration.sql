alter table "Conversation"
add column if not exists "disappearingMessagesDurationMinutes" integer,
add column if not exists "disappearingMessagesSetById" text,
add column if not exists "disappearingMessagesExpiredAt" timestamp(3);
