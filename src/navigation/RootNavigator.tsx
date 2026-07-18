import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Platform } from 'react-native';

import { AddContactScreen } from '../screens/AddContactScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { BlockedUsersScreen } from '../screens/BlockedUsersScreen';
import { CallRoomScreen } from '../screens/CallRoomScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { ChatRoomScreen } from '../screens/ChatRoomScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { PremiumTrialIntro } from '../components/PremiumTrialIntro';
import { DevicesScreen } from '../screens/DevicesScreen';
import { MeetingRoomScreen } from '../screens/MeetingRoomScreen';
import { NewChatScreen } from '../screens/NewChatScreen';
import { NewGroupScreen } from '../screens/NewGroupScreen';
import { ShareTargetScreen } from '../screens/ShareTargetScreen';
import { SharedContactScreen } from '../screens/SharedContactScreen';
import { SharedGroupScreen } from '../screens/SharedGroupScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StorageUsageScreen } from '../screens/StorageUsageScreen';
import { SubscriptionScreen } from '../screens/SubscriptionScreen';
import { MainTabs } from './MainTabs';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  useThemeColors();
  useAppStore((state) => state.language);
  const user = useAppStore((state) => state.user);

  return (
    <>
    <Stack.Navigator
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerBackTitle: '',
        headerShown: false,
      }}
    >
      {!user ? (
        <>
          <Stack.Screen component={AuthScreen} name="Auth" />
          <Stack.Screen
            component={SharedContactScreen}
            name="SharedContact"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('sharedContact'),
            }}
          />
          <Stack.Screen
            component={SharedGroupScreen}
            name="SharedGroup"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('groupInvite'),
            }}
          />
          <Stack.Screen
            component={MeetingRoomScreen}
            name="MeetingRoom"
            options={{
              headerShown: false,
            }}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            component={MainTabs}
            name="MainTabs"
            options={{
              title: '',
            }}
          />
          <Stack.Screen
            component={SubscriptionScreen}
            name="Subscription"
          />
          <Stack.Screen
            component={AddContactScreen}
            name="AddContact"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('addContact'),
            }}
          />
          <Stack.Screen
            component={ContactsScreen}
            name="Contacts"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('contacts'),
            }}
          />
          <Stack.Screen
            component={DevicesScreen}
            name="Devices"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('devices'),
            }}
          />
          <Stack.Screen
            component={SettingsScreen}
            name="Settings"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('settings'),
            }}
          />
          <Stack.Screen
            component={NewChatScreen}
            name="NewChat"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('newChat'),
            }}
          />
          <Stack.Screen
            component={NewGroupScreen}
            name="NewGroup"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('newGroup'),
            }}
          />
          <Stack.Screen
            component={ShareTargetScreen}
            name="ShareTarget"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('sendTo'),
            }}
          />
          <Stack.Screen
            component={ChatRoomScreen}
            name="ChatRoom"
            options={{
              gestureEnabled: Platform.OS !== 'ios',
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
            }}
          />
          <Stack.Screen
            component={CallRoomScreen}
            name="CallRoom"
            options={{
              animation: 'fade',
              presentation: 'transparentModal',
            }}
          />
          <Stack.Screen
            component={BlockedUsersScreen}
            name="BlockedUsers"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('blockedUsers'),
            }}
          />
          <Stack.Screen
            component={ChangePasswordScreen}
            name="ChangePassword"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('changePassword'),
            }}
          />
          <Stack.Screen
            component={StorageUsageScreen}
            name="StorageUsage"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('storageUsage'),
            }}
          />
          <Stack.Screen
            component={SharedContactScreen}
            name="SharedContact"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('sharedContact'),
            }}
          />
          <Stack.Screen
            component={SharedGroupScreen}
            name="SharedGroup"
            options={{
              headerShown: true,
              headerStyle: { backgroundColor: colors.chatHeader },
              headerTintColor: colors.white,
              title: t('groupInvite'),
            }}
          />
          <Stack.Screen
            component={MeetingRoomScreen}
            name="MeetingRoom"
            options={{
              headerShown: false,
            }}
          />
        </>
      )}
    </Stack.Navigator>
    {user ? <PremiumTrialIntro /> : null}
    </>
  );
}
