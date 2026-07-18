import { VideoQuality } from 'livekit-client';
import type { RemoteTrackPublication } from 'livekit-client';

const REMOTE_VIDEO_RESET_COOLDOWN_MS = 20_000;
const REMOTE_VIDEO_RESUBSCRIBE_DELAY_MS = 250;
const REMOTE_VIDEO_DECODE_STALL_AFTER_MS = 8_000;
// How long a publication may sit at isSubscribed=true with no track before we
// treat it as an orphan transceiver (LiveKit requested subscription but never
// attached a usable WebRTC track) and force a resubscribe.
const REMOTE_VIDEO_TRACK_ATTACH_STALL_AFTER_MS = 6_000;

type RemoteVideoDecodeState = {
  bytesReceived: number;
  framesDecoded: number;
  stalledSince: number;
};

type RemoteVideoSubscriptionOptions = {
  isStartup?: boolean;
  log?: (event: string, details: Record<string, unknown>) => void;
  networkProfile?: 'normal' | 'degraded' | 'critical';
  useGroupVideoLimits?: boolean;
};

const remoteVideoDecodeStates = new WeakMap<RemoteTrackPublication, RemoteVideoDecodeState>();
const groupLimitedVideoPublications = new WeakSet<RemoteTrackPublication>();
const startupPreparedVideoPublications = new WeakSet<RemoteTrackPublication>();

// Shared across both recovery paths (decoder-stall and track-attach-stall) so
// the two mechanisms never fire resubscribes back-to-back for the same
// publication.
const remoteVideoLastResetAt = new WeakMap<RemoteTrackPublication, number>();
// Tracks when a publication first became isSubscribed=true without a track,
// so we can detect the orphan-transceiver case regardless of isStartup.
const remoteVideoTrackWaitStartedAt = new WeakMap<RemoteTrackPublication, number>();

export function ensureRemoteAudioPublicationSubscribed(publication?: RemoteTrackPublication) {
  if (!publication || publication.isMuted === true) {
    return;
  }

  try {
    const maybeEnabledPublication = publication as RemoteTrackPublication & { isEnabled?: boolean };

    if (maybeEnabledPublication.isEnabled === false) {
      publication.setEnabled(true);
    }

    if (!publication.isDesired) {
      publication.setSubscribed(true);
    }
  } catch {
    // The publication can disappear while a participant reconnects.
  }
}

export function ensureRemoteVideoPublicationSubscribed(
  publication?: RemoteTrackPublication,
  {
    isStartup = false,
    log,
    networkProfile = 'normal',
    useGroupVideoLimits = false,
  }: RemoteVideoSubscriptionOptions = {},
) {
  if (!publication || publication.isMuted === true) {
    remoteVideoTrackWaitStartedAt.delete(publication as RemoteTrackPublication);
    return;
  }

  try {
    // LiveKit owns initial room subscription. In rooms that explicitly disable
    // auto-subscribe, request it once but do not combine that request with layer
    // changes or unsubscribe/resubscribe recovery in the same signaling cycle.
    if (!publication.isDesired) {
      remoteVideoTrackWaitStartedAt.delete(publication);
      publication.setSubscribed(true);
      log?.('remote-video-subscribe-requested', getRemoteVideoPublicationDetails(publication));
      return;
    }

    // The 90p startup request introduced by the slow-network profile leaves some
    // React Native receivers decoding an orphan transceiver which LiveKit never
    // attaches to the publication. Request the stable primary layer once while
    // subscription is being established. Normal adaptation starts after decode.
    //
    // IMPORTANT: only mark this publication as "prepared" once the calls below
    // actually succeed. Marking it first meant that if setEnabled/setVideoQuality
    // threw (plausible on RN before the native transceiver is fully attached),
    // the outer catch would swallow the error but the WeakSet entry would still
    // be set, permanently skipping this workaround for that publication.
    if (isStartup && !startupPreparedVideoPublications.has(publication)) {
      publication.setEnabled(true);
      publication.setVideoQuality(VideoQuality.HIGH);
      startupPreparedVideoPublications.add(publication);
      log?.('remote-video-startup-quality-requested', getRemoteVideoPublicationDetails(publication));
    }

    // A published TrackInfo is not yet a usable WebRTC track. Changing quality or
    // resetting subscription here caused Android receivers to remain permanently
    // desired-but-unsubscribed. Wait for LiveKit's TrackSubscribed event instead.
    if (!publication.isSubscribed || !publication.track) {
      // Watchdog for the orphan-transceiver case: isSubscribed flips true but
      // track never attaches. This used to have no recovery path at all (it
      // only cleared decode state and returned), so a stuck publication here
      // was permanent, and previously this only got any protection when
      // isStartup was true. Track it regardless of isStartup so mid-call
      // joiners are covered too.
      if (publication.isSubscribed && !publication.track) {
        maybeRecoverStalledTrackAttach(publication, log);
      } else {
        remoteVideoTrackWaitStartedAt.delete(publication);
      }
      return;
    }

    remoteVideoTrackWaitStartedAt.delete(publication);
    startupPreparedVideoPublications.delete(publication);

    const maybeEnabledPublication = publication as RemoteTrackPublication & { isEnabled?: boolean };
    if (maybeEnabledPublication.isEnabled === false) {
      publication.setEnabled(true);
    }

    applyRemoteVideoSettings(publication, useGroupVideoLimits, networkProfile, isStartup);
    log?.('remote-video-track-ready', getRemoteVideoPublicationDetails(publication));
  } catch {
    log?.('remote-video-subscribe-error', getRemoteVideoPublicationDetails(publication));
  }
}

function maybeRecoverStalledTrackAttach(
  publication: RemoteTrackPublication,
  log?: (event: string, details: Record<string, unknown>) => void,
) {
  const now = Date.now();
  const waitStartedAt = remoteVideoTrackWaitStartedAt.get(publication);

  if (!waitStartedAt) {
    remoteVideoTrackWaitStartedAt.set(publication, now);
    return;
  }

  const lastResetAt = remoteVideoLastResetAt.get(publication) ?? 0;

  if (
    now - waitStartedAt < REMOTE_VIDEO_TRACK_ATTACH_STALL_AFTER_MS ||
    now - lastResetAt < REMOTE_VIDEO_RESET_COOLDOWN_MS
  ) {
    return;
  }

  remoteVideoLastResetAt.set(publication, now);
  remoteVideoTrackWaitStartedAt.set(publication, now);
  log?.('remote-video-track-attach-stalled', getRemoteVideoPublicationDetails(publication));

  try {
    publication.setSubscribed(false);
    setTimeout(() => {
      try {
        publication.setSubscribed(true);
        log?.('remote-video-track-attach-resubscribed', getRemoteVideoPublicationDetails(publication));
      } catch {
        log?.('remote-video-track-attach-resubscribe-error', getRemoteVideoPublicationDetails(publication));
      }
    }, REMOTE_VIDEO_RESUBSCRIBE_DELAY_MS);
  } catch {
    log?.('remote-video-track-attach-resubscribe-error', getRemoteVideoPublicationDetails(publication));
  }
}

function applyRemoteVideoSettings(
  publication: RemoteTrackPublication,
  useGroupVideoLimits: boolean,
  networkProfile: RemoteVideoSubscriptionOptions['networkProfile'] = 'normal',
  isStartup = false,
) {
  // The stable startup quality was requested before the track arrived. Avoid a
  // second layer change while its first keyframe is being decoded.
  if (isStartup) {
    return;
  }

  if (networkProfile === 'critical') {
    groupLimitedVideoPublications.add(publication);
    publication.setVideoQuality(VideoQuality.LOW);

    if (publication.track) {
      publication.setVideoFPS(8);
    }

    return;
  }

  if (networkProfile === 'degraded') {
    groupLimitedVideoPublications.add(publication);
    publication.setVideoQuality(VideoQuality.MEDIUM);

    if (publication.track) {
      publication.setVideoFPS(12);
    }

    return;
  }

  if (!useGroupVideoLimits) {
    if (groupLimitedVideoPublications.has(publication)) {
      groupLimitedVideoPublications.delete(publication);
      publication.setVideoQuality(VideoQuality.HIGH);
    }

    return;
  }

  // Quality and explicit dimensions are mutually exclusive LiveKit controls.
  // Keep one stable request so group calls do not continuously switch layers.
  groupLimitedVideoPublications.add(publication);
  publication.setVideoQuality(VideoQuality.LOW);

  if (publication.track) {
    publication.setVideoFPS(15);
  }
}

export async function recoverRemoteVideoPublicationIfDecoderStalled(
  publication?: RemoteTrackPublication,
  log?: (event: string, details: Record<string, unknown>) => void,
) {
  const track = publication?.track as (RemoteTrackPublication['track'] & {
    getReceiverStats?: () => Promise<{
      bytesReceived?: number;
      framesDecoded?: number;
    } | undefined>;
  }) | undefined;

  if (!publication || publication.isMuted === true || !publication.isSubscribed || !track?.getReceiverStats) {
    if (publication) {
      remoteVideoDecodeStates.delete(publication);
    }
    return;
  }

  const stats = await track.getReceiverStats().catch(() => undefined);
  const bytesReceived = stats?.bytesReceived;
  const framesDecoded = stats?.framesDecoded;

  if (typeof bytesReceived !== 'number' || typeof framesDecoded !== 'number') {
    return;
  }

  const now = Date.now();
  const previous = remoteVideoDecodeStates.get(publication);

  if (!previous) {
    remoteVideoDecodeStates.set(publication, {
      bytesReceived,
      framesDecoded,
      stalledSince: 0,
    });
    return;
  }

  const receivedBytes = bytesReceived > previous.bytesReceived;
  const decodedFrames = framesDecoded > previous.framesDecoded;

  previous.bytesReceived = bytesReceived;
  previous.framesDecoded = framesDecoded;

  if (decodedFrames || !receivedBytes) {
    previous.stalledSince = 0;
    return;
  }

  if (previous.stalledSince === 0) {
    previous.stalledSince = now;
    return;
  }

  const lastResetAt = remoteVideoLastResetAt.get(publication) ?? 0;

  if (
    now - previous.stalledSince < REMOTE_VIDEO_DECODE_STALL_AFTER_MS ||
    now - lastResetAt < REMOTE_VIDEO_RESET_COOLDOWN_MS
  ) {
    return;
  }

  remoteVideoLastResetAt.set(publication, now);
  previous.stalledSince = 0;
  log?.('remote-video-decoder-stalled', getRemoteVideoPublicationDetails(publication));

  try {
    publication.setSubscribed(false);
    await new Promise((resolve) => setTimeout(resolve, REMOTE_VIDEO_RESUBSCRIBE_DELAY_MS));
    publication.setSubscribed(true);
    log?.('remote-video-decoder-resubscribed', getRemoteVideoPublicationDetails(publication));
  } catch {
    log?.('remote-video-decoder-resubscribe-error', getRemoteVideoPublicationDetails(publication));
  }
}

function getRemoteVideoPublicationDetails(publication: RemoteTrackPublication) {
  return {
    hasTrack: !!publication.track,
    isDesired: publication.isDesired,
    isMuted: publication.isMuted,
    isSubscribed: publication.isSubscribed,
    readyState: publication.track?.mediaStreamTrack.readyState,
    trackSid: publication.trackSid,
  };
}