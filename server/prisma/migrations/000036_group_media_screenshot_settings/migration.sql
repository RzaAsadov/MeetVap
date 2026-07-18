alter table "Conversation"
  add column if not exists "preventMediaSave" boolean not null default false,
  add column if not exists "preventScreenshots" boolean not null default false;
