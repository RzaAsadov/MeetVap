import { Message } from '../types/domain';
import { t } from '../i18n';

export function getReportContextNotice() {
  return t('reportContextNotice');
}

export function buildReportReason(chatTitle: string, messages: Message[]) {
  return buildReportReasonWithCategory('General report', chatTitle, messages);
}

function buildReportReasonWithCategory(category: string, chatTitle: string, messages: Message[]) {
  const lastMessages = messages.slice(-5);

  if (lastMessages.length === 0) {
    return `Category: ${category}\nChat: ${chatTitle}\nLast 5 messages: none available on this device.`;
  }

  return [
    `Category: ${category}`,
    `Chat: ${chatTitle}`,
    'Last 5 messages:',
    ...lastMessages.map((message, index) => (
      `${index + 1}. ${formatReportMessage(message)}`
    )),
  ].join('\n');
}

function formatReportMessage(message: Message) {
  const sender = message.sender?.displayName || message.sender?.username || message.senderId;
  const body = message.body.trim() || `[${message.kind}]`;
  const createdAt = message.createdAtIso || message.createdAt;

  return `${createdAt} ${sender}: ${body.slice(0, 500)}`;
}
