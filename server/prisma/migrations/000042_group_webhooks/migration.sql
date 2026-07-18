create table if not exists "GroupWebhook" (
  "id" text primary key,
  "conversationId" text not null references "Conversation"("id") on delete cascade,
  "name" text not null,
  "tokenHash" text not null unique,
  "tokenPrefix" text not null,
  "enabled" boolean not null default true,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "lastUsedAt" timestamp(3),
  "revokedAt" timestamp(3)
);

create index if not exists "GroupWebhook_conversationId_idx" on "GroupWebhook"("conversationId");
create index if not exists "GroupWebhook_enabled_revokedAt_idx" on "GroupWebhook"("enabled", "revokedAt");

create table if not exists "GroupWebhookDelivery" (
  "id" text primary key,
  "webhookId" text references "GroupWebhook"("id") on delete set null,
  "conversationId" text not null references "Conversation"("id") on delete cascade,
  "messageId" text references "Message"("id") on delete set null,
  "status" text not null,
  "bodyPreview" text,
  "error" text,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamp(3) not null default current_timestamp
);

create index if not exists "GroupWebhookDelivery_webhookId_createdAt_idx" on "GroupWebhookDelivery"("webhookId", "createdAt");
create index if not exists "GroupWebhookDelivery_conversationId_createdAt_idx" on "GroupWebhookDelivery"("conversationId", "createdAt");
create index if not exists "GroupWebhookDelivery_messageId_idx" on "GroupWebhookDelivery"("messageId");
