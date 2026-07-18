# MeetVap Product and User Functionality

## Document Purpose

This document describes the currently implemented MeetVap product from the user's point of view. It is intended to support product planning, business review, customer support, release preparation, compliance review, and future development.

Implementation baseline reviewed: June 5, 2026.

It explains:

- what users can do in the application;
- how important workflows behave;
- which privacy and safety controls are available;
- how private chats, groups, calls, media, and notifications work;
- the business rules and limits that affect users;
- how the application behaves when a device is offline or the app is not open.

This is a functional business document, not a technical architecture guide.

## Product Summary

MeetVap is a subscription-based mobile messenger for iOS and Android. It combines private messaging, group communication, voice and video calls, media sharing, privacy controls, emergency tools, and local-first message storage.

The application is designed around the following product principles:

1. **Private communication:** Normal message history is stored primarily on users' devices instead of being retained permanently as readable message history on the server.
2. **Reliable communication:** Messages, edits, deletions, delivery receipts, calls, and notifications continue to work across offline and background scenarios.
3. **User-controlled identity:** Users choose a public display name and can keep their login nickname private.
4. **Group governance:** Owners and admins have clearly separated responsibilities and controls.
5. **Cross-platform calling:** Voice, video, group calls, background calling, native incoming-call interfaces, Bluetooth audio, and picture-in-picture behavior are supported.
6. **Safety and privacy:** Reporting, blocking, screenshot controls, media-saving restrictions, PIN protection, and PANIC PIN workflows are built into the product.

## Supported Platforms and Languages

### Platforms

- iPhone through iOS
- Android devices
- Android picture-in-picture environments where supported
- Public web pages for shared contacts and public group links

The mobile application currently operates in portrait orientation.

### Languages

The mobile application supports:

- English
- Turkish
- Russian
- System language selection

The selected language is used throughout the application, including supported notifications and native call actions where the platform permits it.

## Account Access and Registration

### Terms Acceptance

Before registering or signing in, a user must accept the Terms of Use and the zero-tolerance policy for objectionable content and abusive behavior.

### Registration

Registration is divided into two clear stages.

#### Stage 1: Login Credentials

The user creates:

- a unique username used for signing in;
- a password that satisfies the required security conditions.

Before continuing, MeetVap checks with the server that the username is available.

The username:

- is a login credential;
- is not intended to be the user's main public identity;
- is hidden from peers by default;
- may only contain supported lowercase letters, numbers, and underscores;
- must be between 6 and 32 characters;
- cannot be the reserved username `meetvap` in any letter-case combination.

The registration password must contain at least seven characters and include both letters and numbers.

#### Stage 2: Public Identity

The user chooses a display name.

The display name:

- is shown to contacts and other users;
- may be used to find the user when search visibility is enabled;
- can be changed later;
- cannot contain the reserved MeetVap name or configured prohibited content.

### Sign In

Users sign in with their username and password. The sign-in screen also provides:

- language selection;
- access to registration;
- links to legal terms;
- password visibility controls.

### Subscription Access

An active subscription is required to access the main messenger experience.

Available plan periods include:

- monthly;
- three months;
- six months;
- yearly.

The subscription screen supports:

- purchasing through Apple or Google platform billing;
- restoring purchases;
- refreshing subscription status;
- viewing the plan period and price supplied by the store;
- opening the Terms of Use and Privacy Policy;
- signing out.

Shared contact and public group links can still be opened before the user reaches the main application, but normal messaging access requires a usable subscription.

### Password Management

Signed-in users can change their password by providing:

- their current password;
- a new password;
- confirmation of the new password.

The new password must contain at least eight characters.

### Account Deletion

Users can permanently delete their account from Settings.

To reduce accidental deletion:

- the user must confirm the action;
- the user must provide their password;
- the destructive confirmation button is protected by a countdown.

## Main Application Navigation

The main application contains four tabs:

1. **Chats**
2. **Calls**
3. **Contacts**
4. **Settings**

The Chats tab can display a badge representing conversations that contain unread messages.

## Chats List

The Chats screen is the user's central communication view.

### Conversation Information

Each conversation row can show:

- profile or group photo;
- display name or group name;
- online state or last activity;
- last-message preview;
- delivery or read status for the user's outgoing last message;
- unread-message count;
- muted state;
- disappearing-message indicator;
- blocked-user indicator;
- group invitation indicator;
- group role information where appropriate;
- the MeetVap support badge for the system support chat.

The list updates in real time when:

- a new message arrives;
- a message is delivered or read;
- the last message is edited or deleted;
- a chat is cleared;
- a conversation is muted or unmuted;
- group membership or settings change.

### Search and Filters

Users can search the chat list and switch between:

- All;
- Unread;
- Groups;
- Favorites.

The first 100 conversations are loaded initially. More conversations load as the user scrolls, while newly active conversations continue to move to the correct position at the top.

### Chats Header Actions

The Chats header provides access to:

- sharing the user's own MeetVap contact link;
- adding a contact;
- creating a group;
- marking conversations as read;
- MeetVap support;
- Settings.

### Chat List Long-Press Actions

Depending on the conversation type and the user's role, long-pressing a chat can provide:

- add to or remove from Favorites;
- mute or unmute;
- delete or remove the chat from the user's list;
- add a private peer to contacts;
- block or unblock a private peer;
- report a user or group;
- report and block;
- leave a group.

Group chats do not show private-contact actions such as Add to contacts.

Owners and admins do not see inappropriate group actions such as blocking or reporting their own group. Owners cannot remove the group as if it were an ordinary personal chat.

### Mute Durations

Users can mute a chat:

- forever;
- for 15 minutes;
- for 1 hour;
- for 4 hours;
- for 8 hours;
- for 24 hours.

## Permanent MeetVap Support Chat

Every user has a permanent MeetVap support conversation.

The support chat:

- always appears in the chat list;
- uses the official MeetVap identity and logo;
- shows a localized Support badge;
- uses a distinctive avatar ring and green display name;
- supports normal incoming messages and unread counters;
- moves within the chat list according to normal last-message activity.

To protect the official system identity, users cannot:

- delete the support chat;
- call the support account;
- open peer details from its header;
- open its three-dot chat menu;
- long-press support-chat messages;
- send voice messages;
- use the emoji composer in that chat;
- add the account to groups;
- find the account through normal user search.

The reserved MeetVap account identity is not available for normal user registration.

## Contacts and User Discovery

### Contacts Tab

The Contacts tab allows users to:

- search their saved contacts;
- open a private chat;
- start a voice call;
- start a video call;
- share a contact;
- delete a contact;
- block a user.

### Finding New Users

Users can search for people by:

- display name;
- visible nickname.

Search begins after a minimum useful query length. Existing contacts are excluded from the Add contact results.

Privacy settings affect discovery:

- users who enable Hide me from search are excluded from public search;
- users who hide their nickname cannot be found or identified by that nickname;
- display names remain the primary public identity where search is allowed.

### Blocking

Blocking a user requires confirmation.

When a user is blocked:

- direct interaction is prevented;
- the mutual contact relationship is removed;
- the blocked state is shown in the chat list;
- the user can later be unblocked from the chat menu or Blocked users screen.

Blocking and reporting are separate actions. Users can choose to report content or report and block when abuse is involved.

## Shared Contact Links

Users can share their own profile or another contact through a stable MeetVap link.

Shared contact links:

- use a generated stable code instead of exposing the username;
- display the person's display name and profile photo;
- never expose the private login nickname;
- open the MeetVap application when installed;
- provide a web fallback and platform store links when needed.

From a shared contact page, a signed-in user can:

- open or start a message;
- add the person to contacts;
- share the contact link again.

## Private Chat Experience

### Header and Peer Details

The private chat header shows the peer's:

- profile photo;
- display name;
- online state or last seen, when the peer allows it.

Header actions provide:

- voice call;
- video call;
- chat menu;
- peer details.

The peer-details view includes:

- profile information;
- voice-call action;
- video-call action;
- search within chat;
- disappearing-message controls;
- chat Gallery.

### Message Timeline

Messages are displayed in chronological sections separated by date dividers.

The application loads the recent portion of a conversation first and progressively loads older messages. Navigation to an old pinned, replied-to, or searched message automatically loads the required history until the target is reached.

The chat screen supports:

- real-time incoming messages;
- typing indicators;
- delivery and read receipts;
- connection lost and connection recovered notices;
- scroll-to-latest controls;
- message search with previous and next result navigation.

### Message Status

Outgoing messages progress through:

- sending;
- sent;
- delivered;
- read.

A delivered status means the receiving user's application has acknowledged receipt. A read status is sent when the receiver actually views the conversation.

Status changes remain consistent between:

- the chat screen;
- the chat list;
- app restarts;
- offline recovery.

## Message Types

MeetVap supports the following message types.

### Text Messages

Users can send normal and multi-line text messages. Long text can be opened in an expanded reading view.

The configured maximum text length is 8,000 characters.

### Images

Users can:

- choose images from the device;
- capture an image with the camera;
- add an optional caption;
- open images full screen;
- pinch to zoom;
- pan a zoomed image;
- save or share an image when conversation policy permits it.

### Videos

Users can:

- choose or capture video;
- add an optional caption;
- view video in a dedicated viewer;
- save or share video when permitted.

Camera-captured video selection is limited to a supported duration in the application.

### Files

Users can:

- select files from the device;
- add an optional caption;
- view the file name and size;
- open the file through a compatible application installed on the phone;
- save, share, forward, or select the file when conversation policy permits it.

### Voice Messages

Voice messages support:

- press-and-hold recording;
- sliding upward to lock recording;
- pause and resume;
- discard;
- send;
- optional voice effects such as Normal, Deep, Bright, and Helium.

### Current Location

Users can send their current location as a location message.

### Live Location

Users can share a location that updates while moving.

Available sharing periods are:

- 15 minutes;
- 1 hour;
- 4 hours;
- 12 hours.

Live Location behavior:

- updates approximately once per minute;
- continues in the background when the required platform permission is granted;
- shows an establishment state while the first location is being acquired;
- shows a failure state if the share cannot be established;
- can be stopped by the sender;
- prevents the same user from starting another active Live Location share before the current one ends.

On Android, MeetVap presents a prominent disclosure before requesting background-location access. The disclosure explains that location is used only for selected Live Location chats and optional PANIC PIN emergency contacts.

### Shared Contacts

The attachment menu can open the user's contact list. Selecting a contact sends that person's stable MeetVap shared-contact link.

### Call Messages

Voice and video call activity appears in chat as call messages. Depending on call state, the message can show:

- incoming or outgoing;
- voice or video;
- answered, cancelled, declined, missed, or ended;
- call duration;
- an action to rejoin or return to an active call where applicable.

## Message Composer and Attachments

The composer supports:

- text input;
- device paste and editing actions;
- emoji selection and recent emojis;
- attachment menu;
- voice-message recording;
- reply previews;
- edit state;
- captions for media and files.

The attachment menu provides:

- gallery;
- camera;
- file;
- location;
- contact.

MeetVap checks the server's current attachment policy before uploading. If a selected item or batch exceeds the allowed limit, the user receives a localized explanation.

## Message Actions

Long-pressing a message opens actions appropriate to the message type, sender, conversation, and role.

Possible actions include:

- copy;
- reply;
- edit;
- pin or unpin;
- forward;
- select;
- save to phone;
- share;
- report;
- report and block;
- delete for me;
- delete for everyone.

The menu closes when the user touches outside it.

### Reply

Users can reply from the message menu or by swiping a message. The reply preview identifies the referenced message. Selecting the reference navigates to the original message.

### Edit

Users can edit eligible messages they sent. Edits are propagated to recipients, including recipients that reconnect later.

### Forward

Users can forward messages to other chats.

The forward selector:

- includes search;
- shows a controlled initial set for performance;
- supports large contact and conversation lists;
- keeps the device navigation area clear.

### Select

Selection mode allows users to select eligible messages and perform supported bulk actions.

### Delete

Users can delete eligible messages:

- only for themselves;
- for all participants.

Delete-for-everyone requests are queued for offline peers. When an offline peer reconnects, the message is removed from that device as well.

Deleting a message also removes any pin that references it, preventing ghost pinned messages.

### Report

Users can report objectionable messages. Where appropriate, the app also offers Report and block.

## Pinned Messages

### Private Chats

A private-chat message can be pinned:

- for me;
- for all participants.

### Group Chats

Only the group owner and admins can pin messages. Group pins are always for all group participants.

### Pinned Message Display

The newest pinned message is shown at the top of the chat.

Opening the pinned-message window shows:

- all pinned messages sorted by newest pin first;
- one-line previews with truncation;
- search by text or caption;
- text-message icons;
- thumbnails or icons for media, files, locations, and voice messages;
- captions where available;
- pin date and time;
- For me or For all scope badges;
- an action to navigate to the original message;
- an action to remove the pin with confirmation.

The pinned-message search is cleared each time the window is opened.

## Auto-Disappearing Private Messages

Users can enable auto-disappearing messages from private-chat details.

Available periods are:

- 4 hours;
- 8 hours;
- 24 hours;
- 1 week.

When enabled:

- the selected period is shown beside the setting;
- a clock indicator appears for the conversation;
- expired messages are deleted from both participants;
- related pins are removed;
- the chat displays information that automatic deletion is active.

The user who enables the feature controls it. The peer can see that disappearing messages were enabled by the other participant but cannot change that setting.

When the feature is turned off, the active automatic-deletion notice is removed.

## Chat Gallery

Private and group chat details provide a Gallery experience with three tabs:

- Media;
- Files;
- Links.

### Media

- Images and videos appear in a three-column gallery.
- Videos show a play indicator.
- Images open in the full-screen image viewer.
- Videos open in the video viewer.

### Files

- Files appear in a list.
- Each item shows its file name and size.
- Selecting a file opens the device's compatible-application menu.

### Links

- Links sent in the conversation appear in a list.
- Selecting a link opens it through the platform.

Long-pressing gallery content provides Show in chat, which navigates to the original message.

## Group Chats

### Creating a Group

A user can create a group by:

- entering a group name;
- selecting people from contacts and eligible conversations;
- confirming creation.

The group name:

- is required;
- cannot contain the reserved MeetVap name;
- cannot contain configured prohibited content.

The creator becomes the group owner and is accepted into the group immediately.

### Invitations and Pending Membership

Invited users are not treated as full group members until they accept.

Before the invitee decides:

- the group appears in the invitee's chat list with an Invited badge;
- the group shows an unread count of one;
- group messages remain hidden;
- the invitee cannot send messages;
- the invitee can still receive group call invitations;
- only the owner and admins can see the pending member in the member list.

The invited user can:

- accept;
- decline.

If the user declines, friendly follow-up choices allow them to:

- block the group;
- block and report the group;
- leave without blocking.

If the user accepts and Use different name in groups is enabled, acceptance is completed only after the user chooses:

- their normal display name; or
- a group-specific alias.

Aliases are stored separately for each group. If the user does not choose an alias, their display name is used.

### Group Roles

| Capability | Owner | Admin | Regular Member | Pending Invitee |
| --- | --- | --- | --- | --- |
| Read group messages | Yes | Yes | Yes | No |
| Send messages | Yes | Yes | Subject to group settings | No |
| Receive group call invitations | Yes | Yes | Yes | Yes |
| Add eligible members | Yes | Yes | No | No |
| Pin group messages | Yes | Yes | No | No |
| Edit group name or photo | Yes | Yes | No | No |
| Manage owner-only group settings | Yes | No | No | No |
| Make or remove admins | Yes | No | No | No |
| Transfer ownership | Yes | No | No | No |
| Delete the group | Yes | No | No | No |

The owner is shown as the owner, not as an admin.

### Group Member List

The group member list:

- shows display names or group-specific aliases;
- hides nicknames when the member's privacy setting requires it;
- shows pending members only to the owner and admins;
- respects the group's member-list visibility setting;
- displays 30 members per page for manageable performance.

Owners and admins can add people from contacts even when those people are hidden from public search.

### Group Member Management

Depending on role, supported actions include:

- add member;
- remove member;
- edit the group name;
- add or change the group photo;
- make admin;
- revoke admin;
- transfer ownership.

Making a member an admin requires confirmation and a five-second countdown.

Transferring ownership:

- is available only to the current owner;
- requires selecting an existing admin;
- requires confirmation;
- protects the final action with a ten-second countdown.

If there is no admin available, MeetVap explains that the owner must first add an admin.

### Leaving and Removing a Group

Regular members can leave a group.

When an admin leaves or removes the group from their chat list, MeetVap warns that the person will also lose admin status.

The owner cannot leave the group until ownership has been transferred.

### Deleting a Group

Only the owner can delete the group from the system. The final delete action requires confirmation and a ten-second countdown.

### Group Settings

Owner-controlled group settings include:

- Private or Public group;
- public invite link;
- hide member list;
- show admins;
- show member count in the group header;
- only admins can send messages;
- prevent regular members from saving or redistributing media;
- prevent screenshots.

Admins can perform delegated moderation and member actions, but they cannot open or change owner-only group settings.

### Public and Private Groups

Groups are private by default.

When the owner makes a group public:

- MeetVap generates a stable public invitation link;
- the link uses a generated code and does not expose the group name;
- people following the link can join the group;
- alias selection is still required when the joining user's group-alias setting is enabled.

When the owner makes the group private:

- the public link is removed from the system;
- the previous public link can no longer be used.

### Only Admins Can Send Messages

When this setting is enabled:

- regular members do not see the message composer or related sending controls;
- regular members do not receive message actions that would allow sending or changing content;
- owners and admins continue to send and manage messages.

### Prevent Saving Media on Phone

When enabled, regular group members cannot use restricted redistribution actions for protected group content, including:

- Save to phone;
- Share;
- Forward;
- Select.

The owner and admins retain the complete action set for group management.

### Prevent Screenshots

When enabled, MeetVap applies platform screenshot protection to the group chat and related group calls.

This setting is controlled by the group owner. Individual members' private-chat screenshot preferences do not independently control the whole group.

### Group Webhook Messages

An authorized MeetVap administrator can create a webhook for a selected group. External systems can currently send text-only messages into the group through that webhook.

For group users, webhook messages appear as normal group text activity. Webhook creation and management are not exposed in the mobile application.

## Voice and Video Calls

MeetVap supports:

- private voice calls;
- private video calls;
- group voice calls;
- group video calls;
- inviting additional people into an active call;
- returning to or rejoining an active call.

### Participant Limits

- Voice calls support up to 8 participants.
- Video calls support up to 6 participants.

When a group contains more people than a call can support, the caller selects eligible participants.

### Starting and Receiving Calls

Users can start calls from:

- private-chat headers;
- group chat;
- Contacts;
- Calls history;
- eligible call messages.

Incoming calls support:

- in-app incoming-call screens;
- Android call notifications and full-screen behavior where permitted;
- iOS PushKit and CallKit behavior;
- Answer and Decline actions;
- cold-start and background app handling.

The caller sees:

- Calling while the peer has not confirmed availability;
- Ringing after the peer's device has received the call;
- an outgoing ringback sound until the call is answered, declined, cancelled, or otherwise ends.

### Calls While Already in a Call

If another user calls someone who is already in a call, MeetVap can show the second incoming call and allow the user to:

- decline the new call;
- end the current call and answer the new call.

### Call Recovery

MeetVap monitors participant and network state during calls.

When a connection is temporarily lost:

- the app attempts recovery;
- the affected participant can see a connection-recovery state;
- peers may see that the participant's connection is lost;
- a countdown is shown before the call is treated as unrecoverable;
- a normal peer hangup is distinguished from an internet connection error.

### Call Controls

Call controls include, where relevant:

- mute or unmute microphone;
- select audio route;
- enable or disable camera;
- flip camera;
- invite people;
- minimize call;
- end call.

Controls and participant names hide automatically after five seconds to keep the video view clear. Touching the screen shows them again for another five seconds.

Before starting a voice call, the caller can select a live voice style such as Natural, Deep, Bright, or Helium. The selected style is applied to the caller's transmitted voice for that call.

### Audio Routing

MeetVap supports:

- earpiece;
- loudspeaker;
- wired headset;
- Bluetooth audio devices.

The audio button reflects the active route and opens a route selector.

Default behavior:

- voice calls normally begin on the earpiece unless Bluetooth is available;
- video calls normally begin on the loudspeaker unless Bluetooth is available;
- an available Bluetooth route is selected for both voice and video calls.

### Two-Person Video Layout

In a two-person video call:

- the peer's camera normally fills the main view;
- the user's own camera appears in a smaller preview;
- tapping the small preview swaps the two camera views;
- tapping again restores the normal layout.

### Group Video Layout

Group video calls display the available participant video feeds and waiting states for participants whose video is not yet available.

### Background and Picture-in-Picture

Users can minimize an active call and continue using MeetVap.

Supported platform behavior includes:

- navigating to chats while a call continues;
- Android system picture-in-picture for video calls;
- iOS picture-in-picture integration where supported;
- continuing call audio while the app is not the active foreground app.

### Sharing Into MeetVap During a Call

If a user shares an image, video, file, or text into MeetVap while a call is active:

- the call remains active;
- MeetVap shows the Send to conversation selector;
- the user can send the shared content;
- the user can return to the active call.

### Screenshot Privacy During Calls

For private calls, including calls expanded by inviting more people, screenshot protection is based on the privacy preferences of the other call participants. A user's own preference does not prevent that same user from capturing their own screen.

For group calls, screenshot protection follows the group's Prevent screenshots setting.

MeetVap applies the platform's available secure-screen mechanisms to protected call surfaces, including minimized in-app call/chat presentations where supported.

### Call History

The Calls tab shows:

- incoming and outgoing calls;
- voice and video type;
- answered, cancelled, declined, and missed states;
- call time and related participant information.

Users can:

- search call history;
- call again;
- delete eligible call records for themselves or all participants.

### Call Quality Feedback

MeetVap asks users to rate call quality:

- after the first completed call;
- after every 30th completed call afterward.

The user can select one to five stars or dismiss the request. Submitted feedback records the call, participants, participant count, rating user, rating, and date for service-quality analysis.

The local call-feedback counter restarts when a new application version is installed.

## Notifications and Background Behavior

### Message Notifications

Message notifications support:

- localized content;
- opening the relevant conversation;
- mark-as-read actions;
- inline replies where supported.

### Delivery While Offline

If a recipient is offline:

- the sender initially sees the message as sent but not delivered;
- the server queues the message for the recipient;
- when the recipient's app actually receives and stores the message, MeetVap acknowledges delivery;
- the sender then sees the delivered status;
- read status is sent only when the recipient opens the conversation.

For supported text-message pushes, the receiving app can store the message in the local database and acknowledge delivery while in the background. A successful push-provider response alone is not treated as proof of delivery.

### Reconnection

When the app reconnects:

- pending messages are synchronized;
- pending edits and deletions are applied;
- delivery and read receipts are reconciled;
- chat-list rows are refreshed;
- live conversation state resumes.

## Sharing From Other Applications

MeetVap appears in the iOS and Android system share menus.

Users can share:

- text;
- images;
- videos;
- files.

After selecting MeetVap:

- the app opens the Send to screen;
- the user searches or selects a conversation;
- the user sends the shared content;
- repeated shares work without requiring the app to be cleared from memory.

## Privacy Settings

Settings provides the following privacy controls.

### Online and Last Seen

Controls whether peers can see the user's online state and last-seen information.

### Hide Me From Search

Removes the user's profile from normal new-chat and add-contact searches.

### Hide My Nickname

Hides the login nickname from peers in chats, groups, contacts, and searches. This setting is enabled by default.

### Prevent Peers From Taking Chat Screenshots

Controls whether a private-chat peer can capture protected private-chat and private-call surfaces. This setting is enabled by default.

If MeetVap cannot verify the peer's setting because the required service connection is unavailable, protected private-chat behavior fails closed.

### Use Different Name in Groups

When enabled, the user chooses a normal display name or a group-specific alias when accepting each group invitation. This setting is enabled by default.

## Profile and Appearance Settings

Users can:

- add, change, or remove their profile photo;
- edit their display name;
- edit their nickname subject to privacy and validation rules;
- enable dark mode;
- select the application language;
- change their password;
- view the installed application version.

Only the newest profile photo is retained as the active avatar. Replacing an avatar removes the old unreferenced avatar file.

## Lock PIN and PANIC PIN

### Lock PIN

Users can protect MeetVap with a four-digit Lock PIN.

When enabled, the PIN is required when the app is reopened or returns to the foreground according to the configured lock behavior.

### PANIC PIN

PANIC PIN is an emergency alternative PIN that must be different from the normal Lock PIN.

After PANIC PIN is enabled, MeetVap presents a dismissible tip that directs the user to configure emergency contacts and related actions.

Entering the PANIC PIN can:

- erase local chat data;
- open the app in a decoy/offline state;
- optionally remove the user's chats from peers;
- optionally send an emergency message to selected contacts;
- optionally start a 12-hour Live Location share to selected emergency contacts.

The emergency workflow does not keep the user waiting for Live Location establishment. The app unlocks while configured emergency actions continue in the background.

### PANIC PIN Emergency Contacts

Users can select up to two emergency contacts.

The contact selector:

- supports search;
- is designed for large contact lists;
- shows existing selected contacts;
- excludes the permanent MeetVap support account.

The PANIC PIN settings allow the user to configure:

- emergency contacts;
- emergency message text;
- Remove all chats with me from peers;
- Send live location.

Selected contacts can be removed by selecting their displayed name and confirming removal.

## Storage Usage and Local Data

### Local-First Message History

MeetVap stores normal chat history on the user's device in a local SQLite database.

On supported upgrades from the previous storage system:

- the app presents a migration screen;
- existing local messages are migrated before normal use continues;
- the user sees success, failure, or retry status;
- after successful migration, the application uses the SQLite message store.

### Storage Usage Screen

The Storage usage screen shows:

- total voice-call duration and count;
- total video-call duration and count;
- total sent and received media size;
- total sent and received message count;
- current photo storage usage;
- current video storage usage;
- current file storage usage.

Locally tracked call counts and call-duration statistics restart when a new application version is installed. Message and media statistics are calculated from the local content that remains on the device.

Users can open categories and review usage by:

- private chat;
- group.

The user can clear selected conversation data after confirmation. Clearing a conversation updates both local storage and the chat-list preview.

The permanent MeetVap support chat is excluded from Storage usage calculations and clear actions.

### Clearing a Chat

Clear chat removes:

- local messages for the selected conversation;
- locally cached media associated with that conversation;
- the stale last-message preview from the chat list.

## Media Transfer and Reliability

### Upload Limits

The current default server policy allows:

- maximum single attachment: 1 GB;
- maximum combined attachment batch: 1 GB;
- direct-upload requests up to 100 MB;
- resumable uploads through 1 MB chunks.

The mobile application uses resumable chunk uploads for attachments larger than 2 MB.

The server can change these limits through operational configuration. The app checks the active policy and informs the user before attempting an invalid upload.

### Resumable Downloads

Media and files larger than 2 MB are downloaded in 1 MB chunks.

Users see download progress. If the connection is interrupted, MeetVap can resume from completed chunks rather than restarting the entire download.

The application limits simultaneous downloads to protect device and network performance.

## Message Storage and Server Retention

MeetVap is designed so normal readable message history is not kept permanently as a server-side archive.

### Delivery Queue

The server temporarily holds message content while it is required for delivery. After all intended recipients acknowledge the content, readable message bodies and related media can be purged while the system retains the minimum records needed for functions such as:

- delivery state;
- read state;
- edit requests;
- delete-for-everyone requests;
- abuse reports;
- operational integrity.

### Maximum Undelivered Retention

Current default maximum retention for undelivered content is:

| Content type | Maximum queue period |
| --- | --- |
| Text messages | 30 days |
| Images, videos, files, and voice messages | 15 days |
| Current and Live Location messages | 10 days |

Expired undelivered content is removed automatically.

## Safety, Reporting, and Moderation

### Content Rules

MeetVap prohibits objectionable content and abusive behavior through its Terms of Use.

Configured content filters are applied to supported user-generated text, including:

- usernames;
- display names;
- group names;
- text messages;
- edited text messages;
- group webhook text.

### Reporting

Users can report:

- another user;
- a message;
- a group.

Where appropriate, MeetVap offers:

- Report;
- Report and block.

Reports are sent to the moderation system for review.

### Blocking

Users can block abusive users and groups through supported menus. Blocking immediately removes or restricts the relevant interaction from the user's experience.

### Support

The application provides:

- a permanent MeetVap support chat;
- support contact information;
- child-safety contact information.

## User-Facing Operational Limits

The following defaults protect service quality and abuse resistance.

| Function | Current default |
| --- | --- |
| Voice-call participants | Up to 8 |
| Video-call participants | Up to 6 |
| Text-message length | Up to 8,000 characters |
| Display name or group name | Up to 80 characters |
| Text messages | Up to 90 per minute |
| Media messages | Up to 20 per minute |
| Upload operations | Up to 24 per minute |
| Single attachment | Up to 1 GB |
| Combined attachment batch | Up to 1 GB |
| Live Location duration | 15 minutes, 1 hour, 4 hours, or 12 hours |
| Group member-list page | 30 members |
| Group creation or add-member batch | Up to 49 selected users |
| Chat-list page | 100 conversations |
| PANIC PIN emergency contacts | Up to 2 |

When a service limit is reached, the application presents an appropriate error or cooldown response instead of silently failing.

## Permissions and Why They Are Used

MeetVap requests permissions only when needed for a user-facing feature.

| Permission or platform capability | User-facing purpose |
| --- | --- |
| Notifications | New messages, call invitations, call actions, and service updates |
| Microphone | Voice messages and voice/video calls |
| Camera | Profile photos, captured media, and video calls |
| Photos and media | Select, send, save, and share supported media |
| Files | Select and send files |
| Foreground location | Send current location |
| Background location | Continue selected Live Location sharing and optional PANIC PIN emergency location |
| Bluetooth/audio routing | Use Bluetooth and wired audio devices during calls |
| Picture-in-picture | Continue supported video calls while using other apps |
| iOS PushKit/CallKit | Present and answer incoming calls while MeetVap is backgrounded or closed |

Background location is not requested silently. The user receives a prominent explanation before the platform permission request.

## Important End-to-End User Journeys

### Start a Private Conversation

1. Open Contacts, Add contact, New chat, or a shared contact link.
2. Search for or select a person.
3. Open the private chat.
4. Send text, media, files, voice messages, locations, or a contact.
5. Follow sent, delivered, and read status in real time.

### Receive Messages After Being Offline

1. A sender sends messages while the recipient has no connection.
2. The sender sees the messages as sent but not delivered.
3. The recipient reconnects or receives supported background delivery.
4. MeetVap saves the messages locally and acknowledges delivery.
5. The sender sees Delivered.
6. The recipient opens the conversation.
7. The sender sees Read.

### Join an Invited Group

1. The invited group appears with an Invited badge.
2. The invitee cannot read group messages yet.
3. The invitee accepts or declines.
4. If group aliases are enabled for that user, the invitee chooses a display name or alias.
5. Membership becomes active.
6. Group messages and normal group actions become available.

### Join a Public Group

1. Open the group's public MeetVap link.
2. Review the group identity and member count.
3. Sign in if required.
4. Join the group.
5. Complete alias selection if the user's group-alias setting requires it.

### Start a Group Call

1. Open a group chat.
2. Choose voice or video call.
3. Select participants if the group exceeds the call limit.
4. Invited and accepted eligible members receive the call invitation.
5. Participants join, leave, reconnect, or are re-invited while the call remains active.

### Share Content From Another App

1. Select text, an image, video, or file in another application.
2. Choose MeetVap from the system share menu.
3. Search for or select a destination.
4. Send the content.
5. Return to the previous activity or active call.

### Use PANIC PIN

1. Enable a normal Lock PIN.
2. Configure a separate PANIC PIN.
3. Optionally select emergency contacts, message text, remote chat removal, and Live Location.
4. Enter the PANIC PIN on the lock screen.
5. MeetVap clears local chat data and opens the emergency/decoy state.
6. Configured emergency actions continue without delaying access to the app.

## Product Behavior Notes

- Platform capabilities and operating-system restrictions can affect notification presentation, incoming-call UI, background execution, screenshot protection, and picture-in-picture behavior.
- Screenshot protection uses the strongest supported platform mechanisms but should not be represented as protection against external cameras or modified devices.
- Background Live Location depends on the user granting the required location permission and the operating system allowing background activity.
- Delivery means the receiving application acknowledged the message; it does not mean the user read it.
- Read status is generated only when the recipient views the relevant chat.
- Public links use generated stable codes and are designed not to expose private usernames or group names in URLs.
- Operational limits and retention periods are configurable by MeetVap service operators and may change to protect reliability, safety, or compliance.

## Product Scope Summary

MeetVap currently provides a complete private and group communication experience covering:

- account registration and subscription access;
- private and group messaging;
- local-first message history;
- delivery and read receipts;
- offline delivery and queued actions;
- text, image, video, file, voice, contact, and location messages;
- Live Location;
- private and group voice/video calls;
- background calls, native incoming calls, audio routing, and picture-in-picture;
- group invitations, aliases, roles, public links, and owner-controlled policies;
- contact sharing and public profile links;
- privacy, screenshot, search, nickname, and presence controls;
- blocking, reporting, moderation, and support;
- Lock PIN and PANIC PIN emergency workflows;
- storage management and media reliability;
- Apple and Google subscription billing;
- English, Turkish, and Russian localization.
