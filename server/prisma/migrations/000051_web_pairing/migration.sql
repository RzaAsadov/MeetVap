create table if not exists "WebPairingSession" (
  "id" text not null primary key,
  "secretHash" text not null,
  "userId" text references "User"("id") on delete cascade on update cascade,
  "tokenHash" text,
  "userAgent" text,
  "ipAddress" text,
  "approvedAt" timestamp(3),
  "consumedAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "expiresAt" timestamp(3) not null
);

create index if not exists "WebPairingSession_secretHash_idx" on "WebPairingSession"("secretHash");
create index if not exists "WebPairingSession_userId_idx" on "WebPairingSession"("userId");
create index if not exists "WebPairingSession_expiresAt_idx" on "WebPairingSession"("expiresAt");
