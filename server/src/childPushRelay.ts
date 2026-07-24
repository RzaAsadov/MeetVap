import { operationalConfig } from './operationalConfig';

export async function relayPushToMainServer(type: string, input: unknown) {
  if (operationalConfig.serverRole !== 'child') {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${operationalConfig.mainServerHost!.replace(/\/+$/, '')}/internal/child-push`, {
      body: JSON.stringify({ input, type }),
      headers: {
        'Content-Type': 'application/json',
        'x-meetvap-main-server-key': operationalConfig.mainServerKey!,
      },
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Main push relay returned ${response.status}: ${await response.text()}`);
    }

    return true;
  } finally {
    clearTimeout(timeout);
  }
}
