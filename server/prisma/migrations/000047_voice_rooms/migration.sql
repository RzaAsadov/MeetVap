alter table "Conversation"
  add column if not exists "isVoiceRoom" boolean not null default false;

create index if not exists "Conversation_isVoiceRoom_idx" on "Conversation"("isVoiceRoom");

create table if not exists "VoiceRoomParticipant" (
  "id" text not null primary key,
  "conversationId" text not null,
  "userId" text not null,
  "joinedAt" timestamp(3) not null default current_timestamp,
  "leftAt" timestamp(3),
  "selfMuted" boolean not null default true,
  "adminMuted" boolean not null default false,
  "updatedAt" timestamp(3) not null default current_timestamp,
  constraint "VoiceRoomParticipant_conversationId_fkey"
    foreign key ("conversationId") references "Conversation"("id") on delete cascade on update cascade,
  constraint "VoiceRoomParticipant_userId_fkey"
    foreign key ("userId") references "User"("id") on delete cascade on update cascade
);

create unique index if not exists "VoiceRoomParticipant_conversationId_userId_key"
  on "VoiceRoomParticipant"("conversationId", "userId");

create index if not exists "VoiceRoomParticipant_conversationId_leftAt_idx"
  on "VoiceRoomParticipant"("conversationId", "leftAt");

create index if not exists "VoiceRoomParticipant_userId_idx"
  on "VoiceRoomParticipant"("userId");
