import { RootStackParamList } from '../types/navigation';

export type ActiveMeetingSession = RootStackParamList['MeetingRoom'] & {
  link?: string;
  mode?: 'voice' | 'video';
};

type ActiveMeetingListener = (session: ActiveMeetingSession | null) => void;

let activeMeetingSession: ActiveMeetingSession | null = null;
const listeners = new Set<ActiveMeetingListener>();

export function getActiveMeetingSession() {
  return activeMeetingSession;
}

export function setActiveMeetingSession(session: ActiveMeetingSession | null) {
  activeMeetingSession = session;
  listeners.forEach((listener) => listener(activeMeetingSession));
}

export function subscribeToActiveMeetingSession(listener: ActiveMeetingListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
