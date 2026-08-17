import { getAccountSession, getActiveAccountIdSync, listSavedAccounts } from './accountRegistry';
import { clearNativeQuickReplyCredentials, setNativeQuickReplyAccounts } from '../native/CallNative';

export async function syncNativeAccountCredentials() {
  const activeAccountId = getActiveAccountIdSync();
  const accounts = await listSavedAccounts();
  const sessions = (await Promise.all(accounts.map((account) => getAccountSession(account.accountId))))
    .filter((session): session is NonNullable<typeof session> => (
      !!session && session.authState === 'authenticated'
    ));

  if (sessions.length === 0) {
    clearNativeQuickReplyCredentials();
    return;
  }

  setNativeQuickReplyAccounts(sessions.map((session) => ({
    accountUserId: session.userId,
    authToken: session.token,
    isActive: session.accountId === activeAccountId,
    serverInstanceId: session.serverInstanceId,
    serverUrl: session.serverUrl,
  })));
}
