import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Camera, CameraOff, Copy, Download, LogOut, Mic, MicOff, PhoneOff, Users, Video } from 'lucide-react';
import { ConnectionQuality, Participant, Room, RoomEvent, Track, VideoPreset, VideoPresets, VideoQuality } from 'livekit-client';
import type { LocalVideoTrack, RemoteTrackPublication, TrackPublishOptions, VideoCaptureOptions } from 'livekit-client';

import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'https://meetvap.com';
const WEB_TOKEN_KEY = 'meetvap.web.token';
const GUEST_ID_KEY = 'meetvap.meet.guestId';
const ACTIVE_SPEAKER_PROMOTE_MS = 5_000;
const MEETING_VIDEO_CAPTURE_OPTIONS: VideoCaptureOptions = {
  facingMode: 'user',
  frameRate: 15,
  resolution: { frameRate: 15, height: 360, width: 640 },
};
const MEETING_VIDEO_PUBLISH_OPTIONS: TrackPublishOptions = {
  degradationPreference: 'maintain-framerate',
  simulcast: true,
  source: Track.Source.Camera,
  videoEncoding: { maxBitrate: 360_000, maxFramerate: 15 },
  videoSimulcastLayers: [VideoPresets.h90, new VideoPreset(320, 180, 130_000, 12)],
};
type MeetingNetworkProfile = 'normal' | 'degraded' | 'critical';

function getMeetingVideoQuality(profile: MeetingNetworkProfile) {
  return profile === 'critical'
    ? VideoQuality.LOW
    : profile === 'degraded'
      ? VideoQuality.MEDIUM
      : VideoQuality.HIGH;
}

type Meeting = {
  code: string;
  creator: { displayName: string; id: string; username: string };
  durationLimitSeconds: number;
  endedAt: string | null;
  id: string;
  link: string;
  maxEndsAt: string;
  mode: 'voice' | 'video';
  startedAt: string;
  status: 'active' | 'ended';
};

type MeetingParticipant = {
  displayName: string;
  guestId: string | null;
  id: string;
  joinedAt: string;
  leftAt: string | null;
  role: 'HOST' | 'GUEST';
  userId: string | null;
};

type JoinResponse = {
  guestId?: string | null;
  livekit: { roomName: string; token: string; url: string };
  meeting: Meeting;
  participant: MeetingParticipant;
  remainingSeconds: number;
};

function App() {
  const code = getMeetingCodeFromPath();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [participant, setParticipant] = useState<MeetingParticipant | null>(null);
  const [choiceMade, setChoiceMade] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [isMicOn, setMicOn] = useState(false);
  const [isCameraOn, setCameraOn] = useState(false);
  const [isJoining, setJoining] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [renderVersion, setRenderVersion] = useState(0);
  const [visibleSpeakerIds, setVisibleSpeakerIds] = useState<Set<string>>(new Set());
  const [networkProfile, setNetworkProfile] = useState<MeetingNetworkProfile>('degraded');
  const [error, setError] = useState<string | null>(null);
  const audioHostRef = useRef<HTMLDivElement>(null);
  const activeSpeakerSinceRef = useRef(new Map<string, number>());
  const networkRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomStartupAtRef = useRef(0);
  const token = localStorage.getItem(WEB_TOKEN_KEY);
  const isHost = !!participant && participant.role === 'HOST';

  useEffect(() => {
    if (!code) {
      setError('Meeting link is invalid.');
      return;
    }

    let cancelled = false;

    async function loadMeeting() {
      const response = await fetch(`${API_URL}/meetings/${encodeURIComponent(code)}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Meeting not found.');
      }

      if (!cancelled) {
        setMeeting(payload.meeting);
        setParticipants(payload.participants ?? []);
        setRemainingSeconds(payload.remainingSeconds ?? 0);
      }
    }

    void loadMeeting().catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : 'Meeting not found.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!meeting || meeting.status !== 'active') {
      return undefined;
    }

    const interval = setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((new Date(meeting.maxEndsAt).getTime() - Date.now()) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [meeting]);

  useEffect(() => {
    if (!code || !room) {
      return undefined;
    }

    const interval = setInterval(async () => {
      const metadataResponse = await fetch(`${API_URL}/meetings/${encodeURIComponent(code)}`).catch(() => null);

      if (metadataResponse?.ok) {
        const metadata = await metadataResponse.json();
        setMeeting(metadata.meeting);
        setRemainingSeconds(metadata.remainingSeconds ?? 0);
        setParticipants(metadata.participants ?? []);
        if (metadata.meeting?.status === 'ended') {
          leaveMeeting(false);
        }
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [code, room]);

  useEffect(() => {
    if (!room) {
      return undefined;
    }

    const bump = () => setRenderVersion((current) => current + 1);
    const handleActiveSpeakers = (speakers: Participant[]) => {
      const now = Date.now();
      const activeIds = new Set(speakers.map((speaker) => speaker.identity));

      room.remoteParticipants.forEach((remoteParticipant) => {
        if (activeIds.has(remoteParticipant.identity)) {
          if (!activeSpeakerSinceRef.current.has(remoteParticipant.identity)) {
            activeSpeakerSinceRef.current.set(remoteParticipant.identity, now);
          }
        } else {
          activeSpeakerSinceRef.current.delete(remoteParticipant.identity);
        }
      });
    };

    room
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.ParticipantConnected, bump)
      .on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);

    const promoteInterval = setInterval(() => {
      const now = Date.now();
      const next = new Set(visibleSpeakerIds);

      activeSpeakerSinceRef.current.forEach((startedAt, identity) => {
        if (now - startedAt >= ACTIVE_SPEAKER_PROMOTE_MS) {
          next.add(identity);
        }
      });

      room.remoteParticipants.forEach((remoteParticipant) => {
        if (remoteParticipant.isSpeaking === false && !activeSpeakerSinceRef.current.has(remoteParticipant.identity)) {
          return;
        }
      });
      setVisibleSpeakerIds(next);
    }, 1000);

    return () => {
      clearInterval(promoteInterval);
      room
        .off(RoomEvent.TrackSubscribed, bump)
        .off(RoomEvent.TrackUnsubscribed, bump)
        .off(RoomEvent.TrackMuted, bump)
        .off(RoomEvent.TrackUnmuted, bump)
        .off(RoomEvent.ParticipantConnected, bump)
        .off(RoomEvent.ParticipantDisconnected, bump)
        .off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    };
  }, [room, visibleSpeakerIds]);

  useEffect(() => {
    if (!room || !audioHostRef.current) {
      return undefined;
    }

    const host = audioHostRef.current;
    const attachAudio = () => {
      host.replaceChildren();
      room.remoteParticipants.forEach((remoteParticipant) => {
        remoteParticipant.audioTrackPublications.forEach((publication) => {
          if (publication.track) {
            host.appendChild(publication.track.attach());
          }
        });
      });
    };

    attachAudio();
    room.on(RoomEvent.TrackSubscribed, attachAudio).on(RoomEvent.TrackUnsubscribed, attachAudio);

    return () => {
      room.off(RoomEvent.TrackSubscribed, attachAudio).off(RoomEvent.TrackUnsubscribed, attachAudio);
      host.replaceChildren();
    };
  }, [room, renderVersion]);

  useEffect(() => {
    if (!room) {
      return undefined;
    }

    const handleConnectionQuality = (quality: ConnectionQuality, changedParticipant: Participant) => {
      if (changedParticipant.identity !== room.localParticipant.identity) {
        return;
      }

      if (networkRecoveryTimerRef.current) {
        clearTimeout(networkRecoveryTimerRef.current);
        networkRecoveryTimerRef.current = null;
      }

      if (quality === ConnectionQuality.Poor) {
        setNetworkProfile('critical');
      } else if (quality === ConnectionQuality.Excellent) {
        networkRecoveryTimerRef.current = setTimeout(() => {
          setNetworkProfile('normal');
          networkRecoveryTimerRef.current = null;
        }, 8_000);
      } else {
        setNetworkProfile('degraded');
      }
    };

    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQuality);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQuality);
      if (networkRecoveryTimerRef.current) {
        clearTimeout(networkRecoveryTimerRef.current);
        networkRecoveryTimerRef.current = null;
      }
    };
  }, [room]);

  useEffect(() => {
    if (!room || meeting?.mode !== 'video') {
      return undefined;
    }

    const applyVideoPolicy = () => {
      const isStartup = Date.now() - roomStartupAtRef.current < 2_000;
      const isGroupCall = room.remoteParticipants.size > 1;
      const remoteQuality = isStartup || isGroupCall
        ? VideoQuality.LOW
        : getMeetingVideoQuality(networkProfile);

      room.remoteParticipants.forEach((remoteParticipant) => {
        const publication = remoteParticipant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
        if (!publication || publication.isMuted) {
          return;
        }

        publication.setEnabled(true);
        publication.setVideoQuality(remoteQuality);
        if (!publication.isDesired) {
          publication.setSubscribed(true);
        }
      });

      const localCamera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
      localCamera?.setPublishingQuality(getMeetingVideoQuality(networkProfile));
    };

    applyVideoPolicy();
    const interval = setInterval(applyVideoPolicy, 5_000);
    room
      .on(RoomEvent.ParticipantConnected, applyVideoPolicy)
      .on(RoomEvent.TrackPublished, applyVideoPolicy)
      .on(RoomEvent.TrackSubscriptionStatusChanged, applyVideoPolicy)
      .on(RoomEvent.TrackUnmuted, applyVideoPolicy);

    return () => {
      clearInterval(interval);
      room
        .off(RoomEvent.ParticipantConnected, applyVideoPolicy)
        .off(RoomEvent.TrackPublished, applyVideoPolicy)
        .off(RoomEvent.TrackSubscriptionStatusChanged, applyVideoPolicy)
        .off(RoomEvent.TrackUnmuted, applyVideoPolicy);
    };
  }, [meeting?.mode, networkProfile, room]);

  const visibleParticipants = useMemo(() => {
    if (!room) {
      return [];
    }

    const maxTiles = window.matchMedia('(max-width: 760px)').matches ? 6 : 20;
    const remotes = Array.from(room.remoteParticipants.values());
    const orderedRemotes = remotes.length > 6
      ? remotes.sort((left, right) => {
        const leftPromoted = visibleSpeakerIds.has(left.identity) ? 0 : 1;
        const rightPromoted = visibleSpeakerIds.has(right.identity) ? 0 : 1;

        if (leftPromoted !== rightPromoted) {
          return leftPromoted - rightPromoted;
        }

        return (left.name || left.identity).localeCompare(right.name || right.identity);
      })
      : remotes;

    return orderedRemotes.slice(0, maxTiles);
  }, [renderVersion, room, visibleSpeakerIds]);

  async function joinMeeting() {
    if (!code || !displayName.trim() || isJoining) {
      return;
    }

    setError(null);
    setJoining(true);

    try {
      const guestId = getGuestId();
      const response = await fetch(`${API_URL}/meetings/${encodeURIComponent(code)}/join`, {
        body: JSON.stringify({ displayName: displayName.trim(), guestId }),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: 'POST',
      });
      const payload = await response.json() as JoinResponse & { error?: string };

      if (!response.ok) {
        setError(payload.error || 'Could not join meeting.');
        return;
      }

      if (payload.guestId) {
        localStorage.setItem(GUEST_ID_KEY, payload.guestId);
      }

      const nextRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          ...MEETING_VIDEO_PUBLISH_OPTIONS,
          dtx: true,
          red: true,
          stopMicTrackOnMute: false,
        },
        videoCaptureDefaults: MEETING_VIDEO_CAPTURE_OPTIONS,
      });

      await nextRoom.connect(payload.livekit.url, payload.livekit.token);
      roomStartupAtRef.current = Date.now();
      await nextRoom.localParticipant.setMicrophoneEnabled(false);
      await nextRoom.localParticipant.setCameraEnabled(false);
      setMeeting(payload.meeting);
      setParticipant(payload.participant);
      setParticipants((current) => [
        payload.participant,
        ...current.filter((item) => item.id !== payload.participant.id),
      ]);
      setRemainingSeconds(payload.remainingSeconds);
      setRoom(nextRoom);
      setMicOn(false);
      setCameraOn(false);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not join meeting.');
    } finally {
      setJoining(false);
    }
  }

  async function leaveMeeting(sendLeave = true) {
    const currentRoom = room;
    const currentMeeting = meeting;
    const currentParticipant = participant;

    currentRoom?.disconnect();
    setRoom(null);
    setParticipant(null);
    setMicOn(false);
    setCameraOn(false);
    if (sendLeave && currentMeeting && currentParticipant) {
      await fetch(`${API_URL}/meetings/${encodeURIComponent(currentMeeting.code)}/leave`, {
        body: JSON.stringify({
          guestId: localStorage.getItem(GUEST_ID_KEY),
          participantId: currentParticipant.id,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }).catch(() => undefined);
    }
  }

  async function endMeeting() {
    if (!meeting || !token) {
      return;
    }

    await fetch(`${API_URL}/meetings/${encodeURIComponent(meeting.code)}/end`, {
      headers: { Authorization: `Bearer ${token}` },
      method: 'POST',
    }).catch(() => undefined);
    await leaveMeeting(false);
    setMeeting((current) => current ? { ...current, endedAt: new Date().toISOString(), status: 'ended' } : current);
  }

  async function toggleMic() {
    if (!room) {
      return;
    }

    const next = !isMicOn;

    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  async function toggleCamera() {
    if (!room) {
      return;
    }

    const next = !isCameraOn;

    await room.localParticipant.setCameraEnabled(
      next,
      next ? MEETING_VIDEO_CAPTURE_OPTIONS : undefined,
      next ? MEETING_VIDEO_PUBLISH_OPTIONS : undefined,
    );
    const cameraTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    cameraTrack?.setPublishingQuality(getMeetingVideoQuality(networkProfile));
    setCameraOn(next);
    setRenderVersion((current) => current + 1);
  }

  if (error && !meeting) {
    return <CenteredMessage title="MeetVap Meet" message={error} />;
  }

  if (!meeting) {
    return <CenteredMessage title="MeetVap Meet" message="Loading meeting..." />;
  }

  if (!room) {
    return (
      <main className="landing">
        <section className="join-card">
          <div className="brand-row">
            <Video size={30} />
            <strong>MeetVap Meet</strong>
          </div>
          <h1>{meeting.creator.displayName}'s {meeting.mode === 'video' ? 'video' : 'voice'} meeting</h1>
          <p>{meeting.status === 'ended' ? 'This meeting has ended.' : `${formatDuration(remainingSeconds)} remaining`}</p>
          {meeting.status !== 'ended' && !choiceMade ? (
            <div className="choice-grid">
              <a className="secondary-action" href="https://meetvap.com/applinks">
                <Download size={18} />
                <span>Download MeetVap</span>
              </a>
              <button onClick={() => setChoiceMade(true)}>Join in browser</button>
            </div>
          ) : null}
          {meeting.status !== 'ended' && choiceMade ? (
            <form className="join-form" onSubmit={(event) => {
              event.preventDefault();
              void joinMeeting();
            }}>
              <label>
                <span>Display name</span>
                <input autoFocus maxLength={80} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
              </label>
              <button disabled={!displayName.trim() || isJoining} type="submit">
                {isJoining ? <span className="button-spinner" /> : null}
                {isJoining ? 'Joining...' : 'Join muted'}
              </button>
            </form>
          ) : null}
          {error ? <em className="error-text">{error}</em> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="meeting-screen">
      <header className="meeting-header">
        <div>
          <strong>{meeting.creator.displayName}'s meeting</strong>
          <span>{formatDuration(remainingSeconds)} remaining · {participants.length} participants</span>
        </div>
        <button onClick={() => void navigator.clipboard.writeText(getMeetingInviteText(meeting.creator.displayName, meeting.link))} title="Copy link">
          <Copy size={18} />
        </button>
      </header>
      <section className={`participant-grid participant-grid-${getGridClassName(visibleParticipants.length)}`}>
        {visibleParticipants.map((remoteParticipant) => (
          <ParticipantTile key={remoteParticipant.identity} participant={remoteParticipant} />
        ))}
        {visibleParticipants.length === 0 ? <LocalTile enabled={isCameraOn} participant={room.localParticipant} /> : null}
        {visibleParticipants.length > 0 ? (
          <div className="local-overlay">
            <LocalTile enabled={isCameraOn} participant={room.localParticipant} />
          </div>
        ) : null}
      </section>
      <aside className="participant-list">
        <Users size={18} />
        {participants.map((item) => <span key={item.id}>{item.displayName}{item.role === 'HOST' ? ' · Host' : ''}</span>)}
      </aside>
      <footer className="controls">
        <button className={isMicOn ? 'active' : ''} onClick={() => void toggleMic()}>
          {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
          <span>{isMicOn ? 'Mute' : 'Unmute'}</span>
        </button>
        {meeting.mode === 'video' ? (
          <button className={isCameraOn ? 'active' : ''} onClick={() => void toggleCamera()}>
            {isCameraOn ? <Camera size={20} /> : <CameraOff size={20} />}
            <span>{isCameraOn ? 'Camera off' : 'Camera on'}</span>
          </button>
        ) : null}
        <button className="danger" onClick={() => void leaveMeeting()}>
          <LogOut size={20} />
          <span>Leave</span>
        </button>
        {isHost ? (
          <button className="danger strong" onClick={() => void endMeeting()}>
            <PhoneOff size={20} />
            <span>End meeting</span>
          </button>
        ) : null}
      </footer>
      <div ref={audioHostRef} className="audio-host" />
    </main>
  );
}

function ParticipantTile({ participant }: { participant: Participant }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraTrack = participant.getTrackPublication(Track.Source.Camera)?.track;
  const isCameraEnabled = !!cameraTrack && !participant.getTrackPublication(Track.Source.Camera)?.isMuted;

  useEffect(() => {
    if (!videoRef.current || cameraTrack?.kind !== Track.Kind.Video) {
      return undefined;
    }

    cameraTrack.attach(videoRef.current);
    return () => {
      if (videoRef.current) {
        cameraTrack.detach(videoRef.current);
      }
    };
  }, [cameraTrack]);

  return (
    <div className={`tile ${participant.isSpeaking ? 'speaking' : ''}`}>
      {isCameraEnabled ? <video ref={videoRef} autoPlay playsInline /> : <Avatar name={participant.name || participant.identity} />}
      <span>{participant.name || participant.identity}</span>
    </div>
  );
}

function LocalTile({ enabled, participant }: { enabled: boolean; participant: Participant }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraTrack = participant.getTrackPublication(Track.Source.Camera)?.track;

  useEffect(() => {
    if (!enabled || !videoRef.current || cameraTrack?.kind !== Track.Kind.Video) {
      return undefined;
    }

    cameraTrack.attach(videoRef.current);
    return () => {
      if (videoRef.current) {
        cameraTrack.detach(videoRef.current);
      }
    };
  }, [cameraTrack, enabled]);

  return (
    <div className="tile local">
      {enabled ? <video ref={videoRef} autoPlay muted playsInline /> : <Avatar name="You" />}
      <span>You</span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>;
}

function CenteredMessage({ message, title }: { message: string; title: string }) {
  return (
    <main className="landing">
      <section className="join-card">
        <div className="brand-row">
          <Video size={30} />
          <strong>{title}</strong>
        </div>
        <p>{message}</p>
      </section>
    </main>
  );
}

function getMeetingCodeFromPath() {
  return window.location.pathname.split('/').filter(Boolean)[0] ?? '';
}

function getGuestId() {
  const existing = localStorage.getItem(GUEST_ID_KEY);

  if (existing) {
    return existing;
  }

  const next = `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  localStorage.setItem(GUEST_ID_KEY, next);
  return next;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getGridClassName(remoteCount: number) {
  if (remoteCount <= 1) {
    return 'one';
  }

  if (remoteCount <= 4) {
    return 'four';
  }

  return 'six';
}

function getMeetingInviteText(displayName: string, link: string) {
  return `${displayName} invites you to a MeetVap meeting. Click the link to join: ${link}`;
}

createRoot(document.getElementById('root')!).render(<App />);
