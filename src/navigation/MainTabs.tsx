import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallsScreen } from '../screens/CallsScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { ChatsScreen } from '../screens/ChatsScreen';
import { StatusScreen } from '../screens/StatusScreen';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { MainTabParamList } from '../types/navigation';

const Tabs = createBottomTabNavigator<MainTabParamList>();

function TabPill({ focused, hasIndicator = false, icon, label, isDarkMode }: { focused: boolean; hasIndicator?: boolean; icon: keyof typeof Ionicons.glyphMap; isDarkMode: boolean; label: string }) {
  const tintColor = focused || hasIndicator ? colors.primary : colors.textSecondary;

  return (
    <View
      style={[
        styles.tabPill,
        focused && (isDarkMode ? styles.tabPillSelectedDark : styles.tabPillSelectedLight),
      ]}
    >
      <View style={styles.tabIconWrap}>
        <Ionicons color={tintColor} name={icon} size={20} />
        {hasIndicator ? <View style={styles.tabIndicatorDot} /> : null}
      </View>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        numberOfLines={1}
        style={[styles.tabPillLabel, { color: tintColor }]}
      >
        {label}
      </Text>
    </View>
  );
}

export function MainTabs() {
  useThemeColors();
  const insets = useSafeAreaInsets();
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const language = useAppStore((state) => state.language);
  const unreadChatsCount = useAppStore((state) => state.totalUnreadConversations);
  const hasUnviewedStatuses = useAppStore((state) => state.hasUnviewedStatuses);
  const labels = {
    calls: t('calls', {}, language),
    catalog: t('catalog', {}, language),
    chats: t('chats', {}, language),
    status: t('status', {}, language),
  };

  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.chatHeader },
        headerTintColor: colors.white,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarShowLabel: false,
        tabBarBackground: () => (
          isDarkMode ? (
            <View style={[styles.backgroundFill, { backgroundColor: colors.surface }]} />
          ) : (
            <LinearGradient
              colors={['#fcfeff', '#eef4ff', '#dbeafe']}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.backgroundFill}
            />
          )
        ),
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          elevation: 10,
          height: 64 + insets.bottom,
          paddingBottom: Math.max(insets.bottom + 6, 12),
          paddingTop: 6,
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.06,
          shadowRadius: 14,
        },
        tabBarBadgeStyle: {
          backgroundColor: colors.primary,
          color: colors.white,
          fontSize: 11,
          fontWeight: '800',
        },
        tabBarItemStyle: {
          paddingHorizontal: 4,
        },
      }}
    >
      <Tabs.Screen
        component={ChatsScreen}
        name="Chats"
        options={{
          headerLeft: () => <Text style={styles.brandHeaderTitle}>MeetVap</Text>,
          headerTitle: '',
          tabBarIcon: ({ focused }) => <TabPill focused={focused} icon="chatbubbles-outline" isDarkMode={isDarkMode} label={labels.chats} />,
          tabBarBadge: unreadChatsCount > 0 ? unreadChatsCount : undefined,
          title: labels.chats,
        }}
      />
      <Tabs.Screen
        component={CallsScreen}
        name="Calls"
        options={{
          headerTitleAlign: 'left',
          tabBarIcon: ({ focused }) => <TabPill focused={focused} icon="call-outline" isDarkMode={isDarkMode} label={labels.calls} />,
          title: labels.calls,
        }}
      />
      <Tabs.Screen
        component={StatusScreen}
        name="Status"
        options={{
          headerTitleAlign: 'left',
          tabBarIcon: ({ focused }) => <TabPill focused={focused} hasIndicator={hasUnviewedStatuses} icon="ellipse-outline" isDarkMode={isDarkMode} label={labels.status} />,
          title: labels.status,
        }}
      />
      <Tabs.Screen
        component={CatalogScreen}
        name="Catalog"
        options={{
          headerTitleAlign: 'left',
          tabBarIcon: ({ focused }) => <TabPill focused={focused} icon="grid-outline" isDarkMode={isDarkMode} label={labels.catalog} />,
          title: labels.catalog,
        }}
      />
    </Tabs.Navigator>
  );
}

const styles = StyleSheet.create({
  backgroundFill: {
    ...StyleSheet.absoluteFillObject,
  },
  brandHeaderTitle: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
    marginLeft: 8,
  },
  tabPill: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 2,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 78,
    paddingHorizontal: 10,
    paddingVertical: 4,
    width: '100%',
  },
  tabPillSelectedLight: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderColor: '#2563eb',
  },
  tabPillSelectedDark: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: '#ffffff',
  },
  tabPillLabel: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  tabIconWrap: {
    position: 'relative',
  },
  tabIndicatorDot: {
    backgroundColor: '#22c55e',
    borderColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    height: 8,
    position: 'absolute',
    right: -5,
    top: -2,
    width: 8,
  },
});
