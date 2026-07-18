create table "LiveLocationShare" (
  "id" text not null,
  "messageId" text not null,
  "conversationId" text not null,
  "ownerId" text not null,
  "latitude" double precision not null,
  "longitude" double precision not null,
  "address" text,
  "startedAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  "expiresAt" timestamp(3) not null,
  "stoppedAt" timestamp(3),
  constraint "LiveLocationShare_pkey" primary key ("id")
);

create unique index "LiveLocationShare_messageId_key" on "LiveLocationShare"("messageId");
create index "LiveLocationShare_conversationId_idx" on "LiveLocationShare"("conversationId");
create index "LiveLocationShare_ownerId_idx" on "LiveLocationShare"("ownerId");
create index "LiveLocationShare_expiresAt_idx" on "LiveLocationShare"("expiresAt");

alter table "LiveLocationShare"
  add constraint "LiveLocationShare_messageId_fkey"
  foreign key ("messageId") references "Message"("id") on delete cascade on update cascade;
alter table "LiveLocationShare"
  add constraint "LiveLocationShare_conversationId_fkey"
  foreign key ("conversationId") references "Conversation"("id") on delete cascade on update cascade;
alter table "LiveLocationShare"
  add constraint "LiveLocationShare_ownerId_fkey"
  foreign key ("ownerId") references "User"("id") on delete cascade on update cascade;
