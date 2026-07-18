# MeetVap

**Current project's iOS and Android applications, the backend in /server, and the administration panel in /admin were fully built with ChatGPT 5.5 and 5.6 (started with 5.5 then continued with 5.6) but manual coding not used at all.**

    This project is a IOS , Android and web based messaging and calling platform. Repository contains the  mobile applications (IOS and Anroid) build with react-native,
    backend server code (Node.js) /server,
    browser application (Node.JS) /web, 
    public website (PHP) /website,
    admin panel /admin
## Repository Catalogs


/src - Shared React Native application source: screens, navigation, state, local SQLite storage, messaging, calls, stories, localization, and native integrations.

/android - Native Android project, Gradle configuration, application services, notifications, calls, background tasks, and platform-specific integrations.

/ios - Native iOS project, CocoaPods workspace, app and share extensions, ReplayKit screen-sharing extension, CallKit/PushKit support, and platform-specific integrations.

/assets - Mobile application icons, fonts, sounds, images, and other bundled resources.

/server Node.js and TypeScript backend  

/admin - Standalone Node.js administration panel for users, subscriptions, groups, calls, reports, devices, diagnostics, partners, and service operations.

/web - React and Vite browser messenger with browser storage, chats, contacts, stories, calls, Meet links, and screen sharing.

/meet - Public React and Vite Meet-link client meetings from a browser without app.

/website - Public MeetVap website and deep-link pages, written in PHP with localized English, Turkish, and Russian content.

/help - Lightweight help entry points and redirects used in app (webview)

/catalog -  Single-page mobile games displayed through the application catalog experience.

/partner - Standalone Node.js partner and reseller portal for managing subscription promo codes.

/scripts - Repository maintenance and post-install scripts, including required React Native and Expo dependency patches.

## Mobile Application


Main technologies include:

1. React Native, Expo, and TypeScript
2. SQLite local-first message storage
3. Socket.IO for real-time communication
4. LiveKIT/WEBRTC for voice calls, video calls, voice rooms, and screen sharing
5. Localized application dictionaries under /src/i18n


Android builds require a compatible JDK and Android SDK. 

iOS builds require macOS, Xcode, CocoaPods, signing identities, provisioning profiles, and the configured app-extension identifiers.

**Install JavaScript dependencies and use:**

npm install
npm start


**Run a native development build:**

npm run android
npm run ios



## Backend

**Backend is a separate NodeJS project**
**It requires Node.js, PostgreSQL, and the configured supporting services.**
**Redis and LiveKIT are used by the calling infrastructure.**


cd server
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev


## Administration Panel

**The administration panel is a separate NodeJS project:**

cd admin
npm install
npm start


## Browser Applications

The authenticated browser messenger is under /web catalog:

npm install
npm run dev


The public Meet-link client is under /meet catalog:

npm install
npm run dev


Applications use Vite for development and production.

## Other Supporting Services

/website contains the public PHP website, product pages, legal pages, deep-link handling, and mobile app association files.
/help contains in-app help endpoints.
/catalog contains the application catalog and simple browser games.

These services have their own deployment scripts at the repository root or inside their respective catalogs.

## Configuration 

1. Review the file at root: config.json
2. Create the required environment files from the available examples.
3. Configure PostgreSQL,  LiveKit

## Credentials
1. Install Android signing material and Apple certificates/provisioning profiles separately.
2. Verify Firebase and Apple service configuration for the intended environment.

