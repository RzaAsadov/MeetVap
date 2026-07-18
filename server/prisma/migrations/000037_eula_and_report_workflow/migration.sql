alter table "User"
  add column if not exists "termsAcceptedAt" timestamp(3),
  add column if not exists "termsAcceptedIpAddress" text,
  add column if not exists "termsAcceptedLocale" text,
  add column if not exists "termsAcceptedPlatform" text,
  add column if not exists "termsVersion" text;

alter table "Report"
  add column if not exists "status" text not null default 'OPEN',
  add column if not exists "reviewedAt" timestamp(3),
  add column if not exists "moderatorNote" text;

create index if not exists "Report_status_createdAt_idx" on "Report" ("status", "createdAt");
