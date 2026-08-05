-- Read receipts previously created content ACKs before clients durably stored
-- message bodies. Revalidate every still-recoverable message through the
-- installation-specific pending-content feed.
delete from "MessageClientAck"
where "messageId" in (
  select "id"
  from "Message"
  where "contentPurgedAt" is null
    and "deletedAt" is null
);

delete from "MessageContentAck"
where "messageId" in (
  select "id"
  from "Message"
  where "contentPurgedAt" is null
    and "deletedAt" is null
);
