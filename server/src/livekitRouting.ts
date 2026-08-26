export type ApiHostRoutableLiveKitServer = {
  clientUrlByApiHost?: string;
};

export function isLiveKitServerEligibleForApiHost(
  server: ApiHostRoutableLiveKitServer,
  apiHost?: string | null,
) {
  const normalizedApiHost = apiHost?.trim().toLowerCase().replace(/\.$/, '') || null;

  return normalizedApiHost
    ? server.clientUrlByApiHost === normalizedApiHost
    : !server.clientUrlByApiHost;
}
