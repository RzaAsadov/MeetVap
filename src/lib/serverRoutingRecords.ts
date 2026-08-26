export type ParsedRoutingRecord = {
  alias: string;
  hostname: string;
  metadata: Record<string, string>;
};

export function parseRoutingRecord(value: string): ParsedRoutingRecord | null {
  const fields = value.trim().split(';').map((field) => field.trim());
  const aliasMatch = /^mv=([a-z0-9][a-z0-9_-]{0,62})$/i.exec(fields[0] ?? '');
  if (!aliasMatch || !fields[1]) return null;

  try {
    const metadata: Record<string, string> = {};
    fields.slice(2).forEach((field) => {
      const separator = field.indexOf('=');
      if (separator <= 0) return;
      const key = field.slice(0, separator).trim().toLowerCase();
      const metadataValue = field.slice(separator + 1).trim();
      if (key && metadataValue) metadata[key] = metadataValue;
    });
    return {
      alias: aliasMatch[1].toLowerCase(),
      hostname: normalizeRoutingHostname(fields[1]),
      metadata,
    };
  } catch {
    return null;
  }
}

export function getRoutingHostnames(records: ParsedRoutingRecord[], alias: string) {
  return [...new Set(records
    .filter((record) => record.alias === alias.toLowerCase())
    .map((record) => record.hostname))];
}

export function normalizeRoutingHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/\.$/, '');
  if (
    hostname.length > 253 ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
  ) throw new Error('Invalid server hostname');
  return hostname;
}
