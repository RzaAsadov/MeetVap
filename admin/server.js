const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool } = require('pg');

loadEnvFile(path.join(__dirname, '..', '.env'));

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const backendPolicyPath = path.join(__dirname, '..', 'config.json');
const backendPolicy = JSON.parse(fs.readFileSync(backendPolicyPath, 'utf8'));
const app = express();
const pool = new Pool({ connectionString: config.databaseUrl });
const adminContext = new AsyncLocalStorage();
const requestContext = new AsyncLocalStorage();

const ONLINE_WINDOW_MINUTES = 2;
const ADMIN_SECTIONS = ['dashboard', 'users', 'calls', 'groups', 'subscriptions', 'partners', 'reports', 'support', 'operations'];
const ADMIN_PERMISSION_LEVELS = ['none', 'read', 'edit'];
const ADMIN_LANGUAGES = ['en', 'tr'];
const MANUAL_SUBSCRIPTION_PERIODS = {
  one_month: { label: '1 Month', months: 1, productId: 'manual_1_month' },
  three_month: { label: '3 Month', months: 3, productId: 'manual_3_month' },
  six_month: { label: '6 Month', months: 6, productId: 'manual_6_month' },
  twelve_month: { label: '12 Month', months: 12, productId: 'manual_12_month' },
  forever: { label: 'Forever', years: 10, productId: 'manual_forever' },
};
const REDEEM_SUBSCRIPTION_PERIODS = {
  one_month: { label: '1 Month', months: 1, productId: 'redeem_1_month' },
  three_month: { label: '3 Month', months: 3, productId: 'redeem_3_month' },
  six_month: { label: '6 Month', months: 6, productId: 'redeem_6_month' },
  twelve_month: { label: '12 Month', months: 12, productId: 'redeem_12_month' },
};
const SORTS = {
  created_at: '"createdAt"',
  display_name: '"displayName"',
  username: 'username',
  last_online: 'last_online_at',
  last_signin: 'last_signin_at',
  contacts: 'contacts_count',
  messages: 'total_messages',
  voice_today: 'voice_today',
  voice_7: 'voice_7d',
  voice_15: 'voice_15d',
  voice_30: 'voice_30d',
  voice_duration: 'voice_duration_sec',
  video_today: 'video_today',
  video_7: 'video_7d',
  video_15: 'video_15d',
  video_30: 'video_30d',
  video_duration: 'video_duration_sec',
};
const livePeaks = {
  onlineUsers: 0,
  peopleInCalls: 0,
  peopleInVoiceCalls: 0,
  peopleInVideoCalls: 0,
  activeCalls: 0,
  updatedAt: null,
};
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = line.split('=');
    const envKey = key.trim();

    if (!envKey || process.env[envKey]) {
      continue;
    }

    process.env[envKey] = trimEnvValue(valueParts.join('=').trim());
  }
}

function trimEnvValue(value) {
  if (!value) {
    return '';
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use((req, res, next) => {
  const queryLanguage = normalizeAdminLanguage(req.query.lang);
  const language = queryLanguage || normalizeAdminLanguage(req.cookies.meetvap_admin_lang) || detectBrowserLanguage(req);

  if (queryLanguage) {
    res.cookie('meetvap_admin_lang', queryLanguage, {
      httpOnly: false,
      sameSite: 'lax',
      secure: config.secureCookies === true,
    });
  }

  req.lang = language;
  requestContext.run({ lang: language }, next);
});
app.use('/static', express.static(path.join(__dirname, 'public')));

async function init() {
  await pool.query(`
    create table if not exists "AdminBlockedUser" (
      "userId" text primary key references "User"(id) on delete cascade,
      "reason" text,
      "createdAt" timestamp(3) not null default current_timestamp
    )
  `);
  await pool.query(`
    create table if not exists "IpLocationCache" (
      ip text primary key,
      country text,
      city text,
      source text not null,
      "createdAt" timestamp(3) not null default current_timestamp,
      "updatedAt" timestamp(3) not null default current_timestamp
    )
  `);
  await pool.query('alter table "User" add column if not exists "catalogUrl" text');
  await pool.query('alter table "User" add column if not exists "diagnosticMode" boolean not null default false');
  await pool.query('alter table "User" add column if not exists "callDiagnosticMode" boolean not null default false');
  await pool.query(`
    create table if not exists "AdminUser" (
      id text primary key,
      username text not null unique,
      "passwordHash" text not null,
      permissions jsonb not null default '{}'::jsonb,
      "isActive" boolean not null default true,
      "createdBy" text,
      "createdAt" timestamp(3) not null default current_timestamp,
      "updatedAt" timestamp(3) not null default current_timestamp,
      "lastLoginAt" timestamp(3)
    )
  `);
  await pool.query(`
    create table if not exists "SupportTicketReplyAdmin" (
      "messageId" text primary key references "Message"(id) on delete cascade,
      "adminUsername" text,
      "createdAt" timestamp(3) not null default current_timestamp
    )
  `);
  await pool.query(`
    create table if not exists "PartnerUser" (
      id text primary key,
      username text not null unique,
      "displayName" text,
      "passwordHash" text not null,
      "isActive" boolean not null default true,
      "createdByAdminId" text,
      "createdByAdminUsername" text,
      "createdAt" timestamp(3) not null default current_timestamp,
      "updatedAt" timestamp(3) not null default current_timestamp,
      "lastLoginAt" timestamp(3)
    )
  `);
  await pool.query(`
    alter table "Report"
      add column if not exists "status" text not null default 'OPEN',
      add column if not exists "reviewedAt" timestamp(3),
      add column if not exists "moderatorNote" text
  `);
  await pool.query('alter type "SubscriptionPlatform" add value if not exists \'MANUAL\'');
  await pool.query(`
    alter table "SubscriptionEntitlement"
      add column if not exists "manualGrantedByAdminId" text,
      add column if not exists "manualGrantedByUsername" text,
      add column if not exists "manualGrantedAt" timestamp(3)
  `);
  await pool.query('alter table "Call" add column if not exists "livekitServerId" text');
  await pool.query('create index if not exists "Call_livekitServerId_endedAt_idx" on "Call"("livekitServerId", "endedAt")');
  await pool.query(`
    create index if not exists "SubscriptionEntitlement_manualGrantedByAdminId_idx"
      on "SubscriptionEntitlement"("manualGrantedByAdminId")
  `);
  await pool.query(`
    create table if not exists "RedeemCode" (
      id text primary key,
      name text not null,
      code text not null unique,
      "productId" text not null,
      "durationMonths" integer not null,
      "maxUses" integer not null default 1,
      "usedCount" integer not null default 0,
      "createdByAdminId" text,
      "createdByAdminUsername" text,
      "disabledAt" timestamp(3),
      "createdAt" timestamp(3) not null default current_timestamp,
      "updatedAt" timestamp(3) not null default current_timestamp
    )
  `);
  await pool.query(`
    alter table "RedeemCode"
      add column if not exists "createdByPartnerId" text,
      add column if not exists "createdByPartnerUsername" text
  `);
  await pool.query(`
    create table if not exists "RedeemCodeUse" (
      id text primary key,
      "redeemCodeId" text not null references "RedeemCode"(id) on delete cascade,
      "userId" text not null references "User"(id) on delete cascade,
      "entitlementId" text references "SubscriptionEntitlement"(id) on delete set null,
      "usedAt" timestamp(3) not null default current_timestamp
    )
  `);
  await pool.query('create unique index if not exists "RedeemCode_code_key" on "RedeemCode"(code)');
  await pool.query('create unique index if not exists "RedeemCodeUse_redeemCodeId_userId_key" on "RedeemCodeUse"("redeemCodeId", "userId")');
  await pool.query('create index if not exists "RedeemCodeUse_userId_idx" on "RedeemCodeUse"("userId")');
  await pool.query('create index if not exists "RedeemCodeUse_entitlementId_idx" on "RedeemCodeUse"("entitlementId")');
  await pool.query('create unique index if not exists "PartnerUser_username_key" on "PartnerUser"(username)');
  await pool.query('create index if not exists "PartnerUser_isActive_idx" on "PartnerUser"("isActive")');
  await pool.query('create index if not exists "PartnerUser_createdAt_idx" on "PartnerUser"("createdAt")');
  await pool.query('create index if not exists "RedeemCode_createdByPartnerId_idx" on "RedeemCode"("createdByPartnerId")');
  await pool.query(`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint where conname = 'RedeemCode_createdByPartnerId_fkey'
      ) then
        alter table "RedeemCode"
          add constraint "RedeemCode_createdByPartnerId_fkey"
          foreign key ("createdByPartnerId") references "PartnerUser"(id) on delete set null on update cascade;
      end if;
    end $$
  `);
  const statsTables = await pool.query(`
    select
      to_regclass('"AnalyticsOverview"') is not null as overview,
      to_regclass('"UserMessageStats"') is not null as users
  `);

  if (statsTables.rows[0]?.overview !== true || statsTables.rows[0]?.users !== true) {
    throw new Error('Admin analytics tables are missing. Run backend migrations before starting admin: cd server && npm run prisma:deploy');
  }

  await ensureAdminPerformanceIndexes();
}

async function ensureAdminPerformanceIndexes() {
  const indexes = [
    'create index if not exists "idx_admin_user_created_at" on "User" ("createdAt" desc)',
    'create index if not exists "idx_admin_user_last_seen" on "User" ("lastSeenAt" desc)',
    'create index if not exists "idx_admin_user_display_name" on "User" ("displayName")',
    'create index if not exists "idx_admin_user_username" on "User" (username)',
    'create index if not exists "idx_admin_contact_owner" on "Contact" ("ownerId")',
    'create index if not exists "idx_admin_session_user_created" on "Session" ("userId", "createdAt" desc)',
    'create index if not exists "idx_admin_callparticipant_user_call" on "CallParticipant" ("userId", "callId")',
    'create index if not exists "idx_admin_callparticipant_call_user" on "CallParticipant" ("callId", "userId")',
    'create index if not exists "idx_admin_call_mode_started" on "Call" (mode, "startedAt" desc)',
    'create index if not exists "idx_admin_call_started" on "Call" ("startedAt" desc)',
  ];

  for (const sql of indexes) {
    await pool.query(sql);
  }

  try {
    await pool.query('create extension if not exists pg_trgm');
    await pool.query('create index if not exists "idx_admin_user_username_trgm" on "User" using gin (username gin_trgm_ops)');
    await pool.query('create index if not exists "idx_admin_user_display_name_trgm" on "User" using gin ("displayName" gin_trgm_ops)');
  } catch (error) {
    console.warn('Admin user search trigram indexes were not created:', error.message);
  }
}

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

function setSession(res, admin) {
  const payload = Buffer.from(JSON.stringify({
    id: admin.id,
    source: admin.source,
    username: admin.username,
  })).toString('base64url');
  const value = `${Date.now()}.${crypto.randomBytes(16).toString('hex')}.${payload}`;
  res.cookie('meetvap_admin', `${value}.${sign(value)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies === true,
  });
}

function parseSessionCookie(req, cookieName = 'meetvap_admin') {
  const raw = req.cookies[cookieName];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const value = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const expected = sign(value);
  if (parts[3].length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(parts[3]), Buffer.from(expected))) return null;

  try {
    return JSON.parse(Buffer.from(parts[2], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function getAdminFromRequest(req) {
  const session = parseSessionCookie(req);

  if (!session?.username || !session?.source) {
    return null;
  }

  if (session.source === 'config' && session.username === config.admin.username) {
    return createConfigSuperAdmin();
  }

  if (session.source !== 'db' || !session.id) {
    return null;
  }

  const admin = (await pool.query('select * from "AdminUser" where id = $1 and "isActive" = true', [session.id])).rows[0];

  if (!admin) {
    return null;
  }

  return {
    id: admin.id,
    isSuperAdmin: false,
    permissions: normalizeAdminPermissions(admin.permissions),
    source: 'db',
    username: admin.username,
  };
}

async function requireAdmin(req, res, next) {
  const admin = await getAdminFromRequest(req).catch(() => null);

  if (!admin) {
    res.redirect('/login');
    return;
  }

  req.admin = admin;
  adminContext.run({ ...admin, lang: req.lang }, next);
}

function requireSection(section, mode = 'read') {
  return (req, res, next) => {
    if (!hasAdminPermission(req.admin, section, mode)) {
      res.status(403).send(page({
        active: section,
        body: empty(mode === 'edit' ? 'This admin account has read-only access to this section.' : 'This admin account cannot access this section.'),
        title: 'Forbidden',
      }));
      return;
    }

    next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.admin?.isSuperAdmin) {
    res.status(403).send(page({ active: 'admins', body: empty('Only the main config admin can manage admin accounts.'), title: 'Forbidden' }));
    return;
  }

  next();
}

function createConfigSuperAdmin() {
  return {
    id: 'config',
    isSuperAdmin: true,
    permissions: Object.fromEntries([...ADMIN_SECTIONS, 'admins'].map((section) => [section, 'edit'])),
    source: 'config',
    username: config.admin.username,
  };
}

function getCurrentAdmin() {
  return adminContext.getStore() || null;
}

function hasAdminPermission(admin, section, mode = 'read') {
  if (!admin) return false;
  if (admin.isSuperAdmin) return true;
  const level = admin.permissions?.[section] || 'none';
  return mode === 'edit' ? level === 'edit' : level === 'read' || level === 'edit';
}

function canRead(section) {
  return hasAdminPermission(getCurrentAdmin(), section, 'read');
}

function canEdit(section) {
  return hasAdminPermission(getCurrentAdmin(), section, 'edit');
}

function canManageManualPayments(admin = getCurrentAdmin()) {
  return hasAdminPermission(admin, 'subscriptions', 'read') || hasAdminPermission(admin, 'users', 'read');
}

function canManageRedeemCodes(admin = getCurrentAdmin()) {
  return hasAdminPermission(admin, 'subscriptions', 'edit');
}

function normalizeAdminPermissions(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(ADMIN_SECTIONS.map((section) => {
    const value = ADMIN_PERMISSION_LEVELS.includes(input[section]) ? input[section] : 'none';
    return [section, value];
  }));
}

function parseAdminPermissions(body) {
  return Object.fromEntries(ADMIN_SECTIONS.map((section) => {
    if (section === 'dashboard') {
      return [section, 'read'];
    }

    const value = String(body[`${section}Permission`] || 'none');
    return [section, ADMIN_PERMISSION_LEVELS.includes(value) ? value : 'none'];
  }));
}

function normalizeAdminUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function sectionLabel(section) {
  const labels = {
    calls: 'Calls',
    dashboard: 'Dashboard',
    groups: 'Groups',
    operations: 'Operations',
    partners: 'Partners',
    reports: 'Reports',
    subscriptions: 'Subscriptions',
    support: 'Support tickets',
    users: 'Users',
  };
  return labels[section] || section;
}

function userSortOptions() {
  return [
    ['created_at', 'Registration date'],
    ['display_name', 'Display name'],
    ['username', 'Username'],
    ['last_online', 'Last online'],
    ['last_signin', 'Last sign-in'],
    ['contacts', 'Contacts count'],
    ['messages', 'Message count'],
    ['voice_today', 'Voice calls today'],
    ['voice_7', 'Voice calls 7 days'],
    ['voice_15', 'Voice calls 15 days'],
    ['voice_30', 'Voice calls 30 days'],
    ['voice_duration', 'Voice call duration'],
    ['video_today', 'Video calls today'],
    ['video_7', 'Video calls 7 days'],
    ['video_15', 'Video calls 15 days'],
    ['video_30', 'Video calls 30 days'],
    ['video_duration', 'Video call duration'],
  ];
}

function normalizeAdminLanguage(value) {
  const language = String(value || '').trim().toLowerCase().slice(0, 2);
  return ADMIN_LANGUAGES.includes(language) ? language : '';
}

function detectBrowserLanguage(req) {
  const header = String(req.headers['accept-language'] || '').toLowerCase();
  return header.split(',').some((part) => part.trim().startsWith('tr')) ? 'tr' : 'en';
}

function getCurrentLanguage() {
  return adminContext.getStore()?.lang || requestContext.getStore()?.lang || 'en';
}

function translateText(text) {
  const lang = getCurrentLanguage();
  return lang === 'tr' ? ADMIN_TR[text] || text : text;
}

function languageSelector(variant = 'default') {
  const lang = getCurrentLanguage();
  const classes = ['language-form'];
  if (variant) classes.push(`language-form--${variant}`);
  return `<form class="${classes.join(' ')}" method="get">
    <label><span>${translateText('Language')}</span>
      <select name="lang" onchange="this.form.submit()">
        <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
        <option value="tr" ${lang === 'tr' ? 'selected' : ''}>Türkçe</option>
      </select>
    </label>
  </form>`;
}

function translateHtml(html) {
  if (getCurrentLanguage() !== 'tr') {
    return html;
  }

  const entries = Object.entries(ADMIN_TR)
    .sort((a, b) => b[0].length - a[0].length)

  return html
    .split(/(<[^>]+>)/g)
    .map((chunk) => {
      if (!chunk || chunk.startsWith('<')) {
        return chunk;
      }

      return entries.reduce((output, [english, turkish]) => {
        const safeEnglish = escapeHtml(english);
        const safeTurkish = escapeHtml(turkish);
        const pattern = /^[A-Za-z0-9_-]+$/.test(safeEnglish)
          ? new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(safeEnglish)}(?![A-Za-z0-9_-])`, 'g')
          : new RegExp(escapeRegExp(safeEnglish), 'g');
        return output.replace(pattern, safeTurkish);
      }, chunk);
    })
    .join('');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ADMIN_TR = {
  'Accept': 'Kabul et',
  'Account': 'Hesap',
  'Active or grace status': 'Aktif veya ek süre durumu',
  'Active or grace status.': 'Aktif veya ek süre durumu.',
  'Account': 'Hesap',
  'Actions': 'İşlemler',
  'Active': 'Aktif',
  'Active calls': 'Aktif aramalar',
  'Active participants': 'Aktif katılımcılar',
  'Activity': 'Etkinlik',
  'Subscriptions': 'Abonelikler',
  'Admin': 'Admin',
  'Add admin': 'Admin ekle',
  'Add contact': 'Kişi ekle',
  'Add contact by username': 'Kullanıcı adıyla kişi ekle',
  'Add to group': 'Gruba ekle',
  'Add user or admin': 'Kullanıcı veya admin ekle',
  'Admin actions': 'Admin işlemleri',
  'Admin blocked': 'Admin tarafından engellenenler',
  'Admin analytics tables are missing. Run backend migrations before starting admin: cd server && npm run prisma:deploy': 'Admin analiz tabloları eksik. Admin panelini başlatmadan önce backend migrasyonlarını çalıştırın: cd server && npm run prisma:deploy',
  'Admin editing': 'Admin düzenleme',
  'Admin login': 'Admin girişi',
  'Admin username is required.': 'Admin kullanıcı adı gerekli.',
  'Admins': 'Adminler',
  'All users': 'Tüm kullanıcılar',
  'All subscriptions': 'Tüm abonelikler',
  'Apply': 'Uygula',
  'App version': 'Uygulama sürümü',
  'Audit group ownership, admins, members, settings, and reports.': 'Grup sahipliği, adminler, üyeler, ayarlar ve raporları denetleyin.',
  'Back': 'Geri',
  'Back to calls': 'Aramalara dön',
  'Bad request': 'Hatalı istek',
  'Billing retry': 'Faturalama tekrar deneniyor',
  'Block reason': 'Engelleme nedeni',
  'Block user': 'Kullanıcıyı engelle',
  'Blocked': 'Engellendi',
  'Build': 'Derleme',
  'Calls': 'Aramalar',
  'Call': 'Arama',
  'CALL': 'ARAMA',
  'Call details': 'Arama detayları',
  'Call media type': 'Arama medya türü',
  'Call records': 'Arama kayıtları',
  'Can sign in': 'Giriş yapabilir',
  'Capacity': 'Kapasite',
  'Change password': 'Şifre değiştir',
  'Change this user password and sign out their active sessions?': 'Bu kullanıcının şifresi değiştirilsin ve aktif oturumları kapatılsın mı?',
  'Close': 'Kapat',
  'Completed uploads': 'Tamamlanan yüklemeler',
  'Conversation': 'Sohbet',
  'Configuration': 'Yapılandırma',
  'Contacts': 'Kişiler',
  'Devices': 'Cihazlar',
  'Device data': 'Cihaz verileri',
  'Catalog URL': 'Katalog URL',
  'Catalog URL saved.': 'Katalog URL kaydedildi.',
  'Remote diagnostics': 'Uzaktan tanılama',
  'Enable message logging': 'Mesaj günlüklerini etkinleştir',
  'Enable call logging': 'Arama günlüklerini etkinleştir',
  'Message logging': 'Mesaj günlükleri',
  'Call logging': 'Arama günlükleri',
  'Diagnostic data is stored on the messenger server under diagdata/{userId}. Keep this enabled only while investigating a live issue.': 'Tanılama verileri messenger sunucusunda diagdata/{userId} altında saklanır. Bunu yalnızca canlı bir sorunu incelerken açık tutun.',
  'Save diagnostics setting': 'Tanılama ayarını kaydet',
  'Enabled': 'Açık',
  'Disabled': 'Kapalı',
  'Reports': 'Raporlar',
  'Rows': 'Satır',
  'Sessions': 'Oturumlar',
  'Statistics': 'İstatistikler',
  'Users': 'Kullanıcılar',
  'Custom Catalog URL': 'Özel Katalog URL',
  'Leave empty to use the server default catalog URL.': 'Sunucu varsayılan katalog URL’sini kullanmak için boş bırakın.',
  'Save Catalog URL': 'Katalog URL’yi kaydet',
  'Invalid Catalog URL.': 'Geçersiz Katalog URL.',
  'Contacts saved by user': 'Kullanıcının kaydettiği kişiler',
  'Config file': 'Yapılandırma dosyası',
  'Config path': 'Yapılandırma yolu',
  'Config source': 'Yapılandırma kaynağı',
  'Copy this URL now. The token is stored only as a hash and cannot be shown again.': 'Bu URL’yi şimdi kopyalayın. Token yalnızca hash olarak saklanır ve tekrar gösterilemez.',
  'Create admin': 'Admin oluştur',
  'Create webhook URL': 'Webhook URL oluştur',
  'Created by': 'Oluşturan',
  'Created at': 'Oluşturulma zamanı',
  'created.': 'oluşturuldu.',
  'Dashboard': 'Panel',
  'Database admins': 'Veritabanı adminleri',
  'Database-backed admin users. The config.json admin remains the permanent superadmin and is the only account allowed to manage admins.': 'Veritabanında saklanan admin kullanıcıları. config.json admini kalıcı süper admindir ve admin hesaplarını yönetebilen tek hesaptır.',
  'Datetime': 'Tarih/saat',
  'Delete user': 'Kullanıcıyı sil',
  'Delete this user permanently?': 'Bu kullanıcı kalıcı olarak silinsin mi?',
  'Deliveries': 'Teslimatlar',
  'Details': 'Detaylar',
  'Disable': 'Devre dışı bırak',
  'Disabled': 'Devre dışı',
  'Direction': 'Yön',
  'Display name': 'Görünen ad',
  'Done': 'Tamam',
  'Duration': 'Süre',
  'Ended': 'Bitti',
  'Ended at': 'Bitiş zamanı',
  'Edit': 'Düzenle',
  'Enable': 'Etkinleştir',
  'Environment': 'Ortam',
  'Expires': 'Bitiş',
  'Expired': 'Süresi doldu',
  'Expired queue messages': 'Süresi dolan kuyruk mesajları',
  'Expired sessions': 'Süresi dolan oturumlar',
  'Error': 'Hata',
  'Files/media by type': 'Türe göre dosya/medya',
  'Filter': 'Filtrele',
  'FILE': 'DOSYA',
  'Forbidden': 'Yetkisiz',
  'Group': 'Grup',
  'Group editing': 'Grup düzenleme',
  'Group settings': 'Grup ayarları',
  'Group title': 'Grup adı',
  'GROUP': 'GRUP',
  'Group title or owner username': 'Grup adı veya sahip kullanıcı adı',
  'Groups': 'Gruplar',
  'Hide members from regular users': 'Üyeleri normal kullanıcılardan gizle',
  'Healthy': 'Sağlıklı',
  'IP': 'IP',
  'In call': 'Aramada',
  'Inspect live calls, participants, rooms, duration, and related users.': 'Canlı aramaları, katılımcıları, odaları, süreyi ve ilgili kullanıcıları inceleyin.',
  'IMAGE': 'GÖRSEL',
  'INCOMING': 'GELEN',
  'Invited and joined users': 'Davet edilen ve katılan kullanıcılar',
  'Joined and not left active calls': 'Katılmış ve ayrılmamış aktif aramalar',
  'Joined': 'Katıldı',
  'Language': 'Dil',
  'Last activity': 'Son etkinlik',
  'Last login': 'Son giriş',
  'Last verified': 'Son doğrulama',
  'Last online': 'Son çevrimiçi',
  'Last sign-in': 'Son oturum açma',
  'Last used': 'Son kullanım',
  'Left': 'Ayrıldı',
  'Live operations view with durable counters and real-time call/user state.': 'Kalıcı sayaçlar ve gerçek zamanlı arama/kullanıcı durumuyla operasyon görünümü.',
  'LiveKit servers': 'LiveKit sunucuları',
  'Load': 'Yük',
  'Main admin': 'Ana admin',
  'Make admin': 'Admin yap',
  'Make owner': 'Sahip yap',
  'Manage': 'Yönet',
  'Manual': 'Manuel',
  'MANUAL': 'MANUEL',
  'Manual grant': 'Manuel tanımlama',
  'Manual Payment': 'Manuel ödeme',
  'Manual payment': 'Manuel ödeme',
  'Manual period': 'Manuel süre',
  'Manual subscription granted.': 'Manuel abonelik tanımlandı.',
  'Partner': 'Partner',
  'Partners': 'Partnerler',
  'Partner actions': 'Partner işlemleri',
  'Partner portal': 'Partner portalı',
  'Partner username is required.': 'Partner kullanıcı adı gerekli.',
  'Partner username already exists.': 'Partner kullanıcı adı zaten var.',
  'Reseller accounts that can create promotional subscription codes from the partner portal.': 'Partner portalından promosyon abonelik kodları oluşturabilen bayi hesapları.',
  'Add partner': 'Partner ekle',
  'Archive': 'Arşiv',
  'Create partner': 'Partner oluştur',
  'Save partner': 'Partneri kaydet',
  'No partners yet.': 'Henüz partner yok.',
  'Promo codes': 'Promosyon kodları',
  'Add promo code': 'Promosyon kodu ekle',
  'Create promo code': 'Promosyon kodu oluştur',
  'Promo code name': 'Promosyon kodu adı',
  'Promo code created.': 'Promosyon kodu oluşturuldu.',
  'No promo codes yet.': 'Henüz promosyon kodu yok.',
  'Subscription package': 'Abonelik paketi',
  'Open partner portal': 'Partner portalını aç',
  'Wrong partner username or password.': 'Partner kullanıcı adı veya şifre hatalı.',
  'Created by partner': 'Oluşturan partner',
  '1 Month': '1 Ay',
  '3 Month': '3 Ay',
  '6 Month': '6 Ay',
  '12 Month': '12 Ay',
  'Forever': 'Süresiz',
  'Redeem codes': 'Kullanım kodları',
  'redeem codes for trial and promotional subscription access.': 'deneme ve promosyon abonelik erişimi için kullanım kodu.',
  'Redeem code': 'Kullanım kodu',
  'Create redeem code': 'Kullanım kodu oluştur',
  'Redeem code created.': 'Kullanım kodu oluşturuldu.',
  'Redeem code disabled.': 'Kullanım kodu devre dışı bırakıldı.',
  'Redeem code details': 'Kullanım kodu detayları',
  'Redeem code name': 'Kod adı',
  'Code': 'Kod',
  'Max uses': 'Maksimum kullanım',
  'Used': 'Kullanıldı',
  'Uses': 'Kullanımlar',
  'Used by': 'Kullanan',
  'Used at': 'Kullanım zamanı',
  'Usage': 'Kullanım',
  'Generate or enter code': 'Kod üret veya gir',
  'Leave empty to generate automatically.': 'Otomatik üretmek için boş bırakın.',
  'Created by admin': 'Oluşturan admin',
  'No redeem codes.': 'Kullanım kodu yok.',
  'No redeem code uses yet.': 'Bu kod henüz kullanılmadı.',
  'Redeem code not found.': 'Kullanım kodu bulunamadı.',
  'Invalid redeem code.': 'Geçersiz kullanım kodu.',
  'Invalid redeem code package.': 'Geçersiz kullanım kodu paketi.',
  'Redeem code name is required.': 'Kod adı gerekli.',
  'Redeem code already exists.': 'Bu kullanım kodu zaten var.',
  'Disable this redeem code? Existing subscription grants stay active.': 'Bu kullanım kodu devre dışı bırakılsın mı? Verilmiş abonelikler aktif kalır.',
  'Read-only access. Redeem code changes are disabled for this admin.': 'Salt okunur erişim. Bu admin için kullanım kodu değişiklikleri kapalı.',
  'Month': 'Ay',
  'Media': 'Medya',
  'Members': 'Üyeler',
  'memberships': 'üyelik',
  'Messages': 'Mesajlar',
  'MESSAGE': 'MESAJ',
  'Mode': 'Mod',
  'Moderator note': 'Moderatör notu',
  'Moderation action': 'Moderasyon işlemi',
  'Name': 'Ad',
  'No active calls.': 'Aktif arama yok.',
  'No LiveKit servers configured.': 'LiveKit sunucusu yapılandırılmamış.',
  'No LiveKit room': 'LiveKit odası yok',
  'No calls.': 'Arama yok.',
  'No contacts saved by this user.': 'Bu kullanıcı tarafından kaydedilmiş kişi yok.',
  'No data.': 'Veri yok.',
  'No database admins yet.': 'Henüz veritabanı admini yok.',
  'No participants.': 'Katılımcı yok.',
  'No reports yet.': 'Henüz rapor yok.',
  'No reason': 'Sebep yok',
  'No reason provided': 'Sebep belirtilmedi',
  'No section access': 'Bölüm erişimi yok',
  'No subscriptions.': 'Abonelik yok.',
  'No': 'Hayır',
  'No owner': 'Sahip yok',
  'No webhook deliveries yet.': 'Henüz webhook teslimatı yok.',
  'No webhook URLs for this group.': 'Bu grup için webhook URL yok.',
  'Not active': 'Aktif değil',
  'Not configured': 'Yapılandırılmamış',
  'None': 'Yok',
  'Missing LiveKit configuration': 'LiveKit yapılandırması eksik',
  'Invalid manual subscription period.': 'Geçersiz manuel abonelik süresi.',
  'Only admins can send messages': 'Yalnızca adminler mesaj gönderebilir',
  'Only the main config admin can manage admin accounts.': 'Admin hesaplarını yalnızca ana config admini yönetebilir.',
  'Original': 'Orijinal',
  'Open admin': 'Admin panelini aç',
  'Open calls': 'Aramaları aç',
  'Open reports': 'Açık raporlar',
  'Operations': 'Operasyonlar',
  'Oldest first': 'En eskiler önce',
  'Password': 'Şifre',
  'Password must be at least 8 characters.': 'Şifre en az 8 karakter olmalıdır.',
  'Paid entitlement records with account display names, Apple/Google identifiers, expiration, renewal state, and raw webhook payloads.': 'Hesap görünen adları, Apple/Google kimlikleri, bitiş tarihi, yenileme durumu ve ham webhook verileriyle ücretli yetki kayıtları.',
  'Paid entitlement records with account display names, Apple/Google/manual identifiers, expiration, renewal state, and raw payment payloads.': 'Hesap görünen adları, Apple/Google/manuel kimlikleri, bitiş tarihi, yenileme durumu ve ham ödeme verileriyle ücretli yetki kayıtları.',
  'Paid entitlement view with Apple/Google identifiers, expiration, renewal state, and raw webhook payloads.': 'Apple/Google kimlikleri, bitiş tarihi, yenileme durumu ve ham webhook verileriyle ücretli yetki görünümü.',
  'Participants': 'Katılımcılar',
  'Permissions': 'Yetkiler',
  'Platform': 'Platform',
  'Preview': 'Önizleme',
  'PRIVATE': 'ÖZEL',
  'Pooled LiveKit routing, capacity, and active call distribution.': 'LiveKit havuz yönlendirmesi, kapasite ve aktif arama dağılımı.',
  'Product': 'Ürün',
  'Provider': 'Sağlayıcı',
  'Provider ID': 'Sağlayıcı ID',
  'Purchase token': 'Satın alma tokenı',
  'Raw latest payment event': 'Son ödeme olayı',
  'Real-time calls': 'Gerçek zamanlı aramalar',
  'Read-only': 'Salt okunur',
  'Read-only access. Editing user data is disabled for this admin.': 'Salt okunur erişim. Bu admin için kullanıcı verisi düzenleme kapalı.',
  'Read-only access. Member and settings changes are disabled for this admin.': 'Salt okunur erişim. Bu admin için üye ve ayar değişiklikleri kapalı.',
  'Read-only access. Moderation changes are disabled for this admin.': 'Salt okunur erişim. Bu admin için moderasyon değişiklikleri kapalı.',
  'Read-only access. Webhook changes are disabled for this admin.': 'Salt okunur erişim. Bu admin için webhook değişiklikleri kapalı.',
  'Registration IP': 'Kayıt IP adresi',
  'Registration OS': 'Kayıt işletim sistemi',
  'Registration language': 'Kayıt dili',
  'Registration user agent': 'Kayıt kullanıcı aracısı',
  'Latest IP': 'Son IP adresi',
  'User agent': 'Kullanıcı aracısı',
  'Recent calls': 'Son aramalar',
  'Recent registrations': 'Son kayıtlar',
  'Recent subscriptions': 'Son abonelikler',
  'Recent webhook deliveries': 'Son webhook teslimatları',
  'Remove admin': 'Adminliği kaldır',
  'Remove contact?': 'Kişi kaldırılsın mı?',
  'Remove this user from group?': 'Bu kullanıcı gruptan kaldırılsın mı?',
  'Registered': 'Kayıt tarihi',
  'Registration date': 'Kayıt tarihi',
  'Registered accounts': 'Kayıtlı hesaplar',
  'Remove': 'Kaldır',
  'Reports': 'Raporlar',
  'Reports against user': 'Kullanıcı hakkındaki raporlar',
  'Reports made by user': 'Kullanıcının yaptığı raporlar',
  'Reviewed at': 'İncelenme zamanı',
  'Renew': 'Yenileme',
  'Revoke': 'İptal et',
  'Revoke this webhook permanently?': 'Bu webhook kalıcı olarak iptal edilsin mi?',
  'Revoked': 'İptal edildi',
  'Role': 'Rol',
  'Save admin': 'Admini kaydet',
  'Save new password': 'Yeni şifreyi kaydet',
  'Save group settings': 'Grup ayarlarını kaydet',
  'Save moderation status': 'Moderasyon durumunu kaydet',
  'Search': 'Ara',
  'Server': 'Sunucu',
  'Servers': 'Sunucular',
  'Select subscription duration': 'Abonelik süresini seçin',
  'Send cooldowns': 'Gönderim bekleme süreleri',
  'Sessions and IP addresses': 'Oturumlar ve IP adresleri',
  'Show admins': 'Adminleri göster',
  'Since admin process started': 'Admin süreci başladığından beri',
  'Single-server env fallback': 'Tek sunuculu env yedeği',
  'Sign in': 'Giriş yap',
  'Started': 'Başlangıç',
  'Started at': 'Başlangıç zamanı',
  'Status': 'Durum',
  'Support ticket': 'Destek talebi',
  'Support ticket not found.': 'Destek talebi bulunamadı.',
  'Support tickets': 'Destek talepleri',
  'Subscriptions': 'Abonelikler',
  'Subscription details': 'Abonelik detayları',
  'Granted by': 'Tanımlayan',
  'Granted at': 'Tanımlanma zamanı',
  'Superadmin · all sections edit mode': 'Süper admin · tüm bölümlerde düzenleme modu',
  'Target': 'Hedef',
  'This admin account cannot access this section.': 'Bu admin hesabı bu bölüme erişemez.',
  'This admin account has read-only access to this section.': 'Bu admin hesabının bu bölümde salt okunur erişimi var.',
  '1d': '1g',
  '7d': '7g',
  '15d': '15g',
  '30d': '30g',
  'Token': 'Token',
  'Transaction': 'İşlem',
  'Original transaction': 'Orijinal işlem',
  'Transfer owner': 'Sahipliği aktar',
  'Transfer group ownership?': 'Grup sahipliği aktarılsın mı?',
  'Type': 'Tür',
  'Target details': 'Hedef detayları',
  'Target reference': 'Hedef referansı',
  'Untitled group': 'Adsız grup',
  'Unblock user': 'Kullanıcı engelini kaldır',
  'Unlimited': 'Sınırsız',
  'Update block': 'Engeli güncelle',
  'URL': 'URL',
  'Updated': 'Güncellendi',
  'User': 'Kullanıcı',
  'Users who saved this user': 'Bu kullanıcıyı kaydeden kullanıcılar',
  'Username or display name': 'Kullanıcı adı veya görünen ad',
  'Users seen in the last 2 minutes': 'Son 2 dakikada görülen kullanıcılar',
  'Username': 'Kullanıcı adı',
  'Users': 'Kullanıcılar',
  'Undelivered': 'Teslim edilmemiş',
  'Undelivered messages': 'Teslim edilmemiş mesajlar',
  'Users with undelivered messages': 'Teslim edilmemiş mesajı olan kullanıcılar',
  'Verified': 'Doğrulandı',
  'VIDEO': 'VİDEO',
  'Video call people': 'Video aramadaki kişiler',
  'VOICE': 'SES',
  'Voice call people': 'Sesli aramadaki kişiler',
  'Webhook name': 'Webhook adı',
  'Webhook': 'Webhook',
  'Webhooks': 'Webhooklar',
  'Weight': 'Ağırlık',
  'Will renew': 'Yenilenecek',
  'Yes': 'Evet',
  'Entitlement': 'Yetkilendirme',
  'Report': 'Rapor',
  'Wrong admin username or password.': 'Admin kullanıcı adı veya şifre hatalı.',
  'All tracked message types': 'Takip edilen tüm mesaj türleri',
  'Awaiting moderation': 'Moderasyon bekliyor',
  'Active only': 'Yalnızca aktif',
  'All calls': 'Tüm aramalar',
  'All modes': 'Tüm modlar',
  'All platforms': 'Tüm platformlar',
  'All statuses': 'Tüm durumlar',
  'All types': 'Tüm türler',
  'Android': 'Android',
  '1 Month': '1 Ay',
  '3 Month': '3 Ay',
  '6 Month': '6 Ay',
  '12 Month': '12 Ay',
  'Forever': 'Süresiz',
  'Images, videos, files, voice': 'Görseller, videolar, dosyalar ve sesler',
  'Current voice participants': 'Mevcut sesli arama katılımcıları',
  'Current video participants': 'Mevcut video arama katılımcıları',
  'Calls without endedAt': 'Bitiş zamanı olmayan aramalar',
  'Admin messages': 'Admin mesajları',
  'Admins hidden': 'Adminler gizli',
  'Cancelled': 'İptal edildi',
  'Contacts count': 'Kişi sayısı',
  'Default': 'Varsayılan',
  'Deleted group': 'Silinmiş grup',
  'Deleted message': 'Silinmiş mesaj',
  'Deleted user': 'Silinmiş kullanıcı',
  'Display name': 'Görünen ad',
  'Dismissed': 'Reddedildi',
  'Grace period': 'Ek süre',
  'group aliases off': 'grup takma adları kapalı',
  'group aliases on': 'grup takma adları açık',
  'Hidden members': 'Üyeler gizli',
  'joined': 'katıldı',
  'Largest media senders': 'En çok medya gönderenler',
  'last seen hidden': 'son görülme gizli',
  'last seen shown': 'son görülme açık',
  'Message count': 'Mesaj sayısı',
  'members': 'üye',
  'Moderation items': 'Moderasyon öğeleri',
  'Newest first': 'En yeniler önce',
  'nickname hidden': 'takma ad gizli',
  'nickname visible': 'takma ad görünür',
  'Open': 'Açık',
  'OUTGOING': 'GİDEN',
  'Open longer than 24 hours': '24 saatten uzun süredir açık',
  'Peak online': 'En yüksek çevrimiçi',
  'Peak voice': 'En yüksek sesli arama',
  'Peak video': 'En yüksek video arama',
  'Calls': 'Aramalardaki kişiler',
  'Refunded': 'İade edildi',
  'Resolved': 'Çözüldü',
  'Revoked': 'İptal edildi',
  'screenshots allowed': 'ekran görüntüsüne izin veriliyor',
  'screenshots blocked': 'ekran görüntüsü engelli',
  'search hidden': 'arama gizli',
  'search visible': 'arama görünür',
  'Online': 'Çevrimiçi',
  'Owner included': 'Sahip dahil',
  'OVERDUE': 'GECİKMİŞ',
  'Stored message rows': 'Saklanan mesaj satırları',
  'Group call rows': 'Grup arama kayıtları',
  'Video calls 15 days': '15 günlük görüntülü aramalar',
  'Video calls 30 days': '30 günlük görüntülü aramalar',
  'Video calls 7 days': '7 günlük görüntülü aramalar',
  'Video calls today': 'Bugünkü görüntülü aramalar',
  'Video call duration': 'Görüntülü arama süresi',
  'Current voice participants': 'Mevcut sesli arama katılımcıları',
  'Current video participants': 'Mevcut video arama katılımcıları',
  'Voice': 'Ses',
  'Voice today': 'Bugünkü ses',
  'Voice 7d': '7 günlük ses',
  'Voice 15d': '15 günlük ses',
  'Voice 30d': '30 günlük ses',
  'Voice calls 15 days': '15 günlük sesli aramalar',
  'Voice calls 30 days': '30 günlük sesli aramalar',
  'Voice calls 7 days': '7 günlük sesli aramalar',
  'Voice calls today': 'Bugünkü sesli aramalar',
  'Voice call duration': 'Sesli arama süresi',
  'Video': 'Video',
  'Video today': 'Bugünkü video',
  'Video 7d': '7 günlük video',
  'Video 15d': '15 günlük video',
  'Video 30d': '30 günlük video',
  'Voice calls 30d': '30 günlük sesli aramalar',
  'Video calls 30d': '30 günlük görüntülü aramalar',
  'Sent messages': 'Gönderilen mesajlar',
  'Durable stat counter': 'Kalıcı istatistik sayacı',
  'Total upload bytes': 'Toplam yükleme baytı',
  'Total undelivered': 'Toplam teslim edilmemiş',
  'Total undelivered messages': 'Toplam teslim edilmemiş mesaj',
  'Latest IP': 'Son IP adresi',
  'Latest user agent': 'Son kullanıcı aracısı',
  'Message delivery': 'Mesaj teslimatı',
  'Message delivery queue': 'Mesaj teslimat kuyruğu',
  'Privacy': 'Gizlilik',
  'Push devices': 'Bildirim cihazları',
  'Raw latest Apple/Google event': 'Son Apple/Google olayı',
  'Reported at': 'Raporlanma zamanı',
  'Reporter': 'Raporlayan',
  'Support bot, CRM, monitoring': 'Destek botu, CRM, izleme',
  'Answered': 'Yanıtlandı',
  'No messages yet.': 'Henüz mesaj yok.',
  'No support tickets yet.': 'Henüz destek talebi yok.',
  'Send': 'Gönder',
  'Waiting': 'Bekliyor',
  'Send JSON with': 'JSON gönderin:',
  'or': 'veya',
  'Name': 'Ad',
  'Pending': 'Beklemede',
  'pending': 'beklemede',
  'Private': 'Özel',
  'Public': 'Herkese açık',
  'New password': 'Yeni şifre',
  'New': 'Yeni',
  'New messages': 'Yeni mesajlar',
  'Last message datetime': 'Son mesaj zamanı',
  'Leave empty to keep current password': 'Mevcut şifreyi korumak için boş bırakın',
  'Alias': 'Takma ad',
  'Settings': 'Ayarlar',
  'When': 'Zaman',
  'unknown': 'bilinmiyor',
  'Unknown': 'Bilinmiyor',
  'Unhealthy': 'Sağlıksız',
  'all': 'tümü',
  'active': 'aktif',
  'edit': 'düzenle',
  'none': 'yok',
  'read': 'oku',
  'TEXT': 'METİN',
  'USER': 'KULLANICI',
};

app.get('/login', (req, res) => {
  res.send(layout({
    bare: true,
    body: `
      <main class="login">
        <section class="login-shell glass">
          <div class="login-showcase">
            <div class="login-showcase-top">
              <a class="brand login-brand" href="/"><img alt="MeetVap" class="brand-logo" src="/static/adaptive-icon.png"><strong>MeetVap Admin</strong></a>
              ${languageSelector('login')}
            </div>
          </div>
          <form class="login-card" method="post" action="/login">
            <div class="login-card-top">
              <div>
                <span class="eyebrow">${escapeHtml(translateText('Username'))}</span>
                <h2>Sign in</h2>
              </div>
            </div>
            <p class="subtle">Use your admin account to access the MeetVap control center.</p>
            ${req.query.error ? '<div class="notice">Wrong admin username or password.</div>' : ''}
            <label>${escapeHtml(translateText('Username'))} <input name="username" autocomplete="username"></label>
            <label>${escapeHtml(translateText('Password'))} <input name="password" type="password" autocomplete="current-password"></label>
            <button type="submit">Open admin</button>
          </form>
        </section>
      </main>
    `,
    title: 'Admin login',
  }));
});

app.post('/login', async (req, res, next) => {
  if (req.body.username === config.admin.username && req.body.password === config.admin.password) {
    setSession(res, createConfigSuperAdmin());
    res.redirect('/');
    return;
  }

  try {
    const admin = (await pool.query('select * from "AdminUser" where username = $1 and "isActive" = true', [normalizeAdminUsername(req.body.username)])).rows[0];

    if (!admin || !(await bcrypt.compare(String(req.body.password || ''), admin.passwordHash))) {
      res.redirect('/login?error=1');
      return;
    }

    await pool.query('update "AdminUser" set "lastLoginAt" = current_timestamp where id = $1', [admin.id]);
    setSession(res, {
      id: admin.id,
      isSuperAdmin: false,
      permissions: normalizeAdminPermissions(admin.permissions),
      source: 'db',
      username: admin.username,
    });
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.post('/logout', requireAdmin, (_req, res) => {
  res.clearCookie('meetvap_admin');
  res.redirect('/login');
});

app.get('/admins', requireAdmin, requireSuperAdmin, async (_req, res, next) => {
  try {
    const admins = await getAdminUsers();
    res.send(page({
      active: 'admins',
      body: `
        ${hero('Admins', 'Database-backed admin users. The config.json admin remains the permanent superadmin and is the only account allowed to manage admins.', logout())}
        <section class="detail-grid">
          ${panel('Add admin', adminUserForm())}
          ${panel('Main admin', detailList([
            ['Username', escapeHtml(config.admin.username)],
            ['Source', 'config.json'],
            ['Permissions', 'Superadmin · all sections edit mode'],
          ]))}
        </section>
        ${panel('Database admins', adminUsersTable(admins.rows))}
      `,
      title: 'Admins',
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/admins', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    const username = normalizeAdminUsername(req.body.username);
    const password = String(req.body.password || '');

    if (!username) throw new Error('Admin username is required.');
    if (username === config.admin.username) throw new Error('This username belongs to the config superadmin.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(`
      insert into "AdminUser" (id, username, "passwordHash", permissions, "createdBy")
      values ($1, $2, $3, $4::jsonb, $5)
    `, [cuid(), username, passwordHash, JSON.stringify(parseAdminPermissions(req.body)), req.admin.username]);
    res.redirect('/admins');
  } catch (error) {
    next(error);
  }
});

app.post('/admins/:id', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    await pool.query(`
      update "AdminUser"
      set permissions = $1::jsonb, "isActive" = $2, "updatedAt" = current_timestamp
      where id = $3
    `, [JSON.stringify(parseAdminPermissions(req.body)), req.body.isActive === 'on', req.params.id]);

    const password = String(req.body.password || '');
    if (password) {
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      await pool.query('update "AdminUser" set "passwordHash" = $1, "updatedAt" = current_timestamp where id = $2', [await bcrypt.hash(password, 12), req.params.id]);
    }

    res.redirect('/admins');
  } catch (error) {
    next(error);
  }
});

app.get('/partners', requireAdmin, requireSection('partners'), async (_req, res, next) => {
  try {
    const partners = await getPartnerUsers();

    res.send(page({
      active: 'partners',
      body: `
        ${hero('Partners', 'Reseller accounts that can create promotional subscription codes from the partner portal.', `<div class="actions">${canEdit('partners') ? `<button type="button" onclick="document.getElementById('partner-create-modal').showModal()">${escapeHtml(translateText('Add partner'))}</button>` : ''}${logout()}</div>`)}
        ${canEdit('partners') ? partnerCreateModal() : ''}
        ${canEdit('partners') ? panel('Partner actions', `<div class="inline-form"><button type="button" onclick="document.getElementById('partner-create-modal').showModal()">${escapeHtml(translateText('Add partner'))}</button></div>`) : ''}
        ${panel('Partners', partnerUsersTable(partners.rows))}
      `,
      title: 'Partners',
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/partners', requireAdmin, requireSection('partners', 'edit'), async (req, res, next) => {
  try {
    const username = normalizeAdminUsername(req.body.username);
    const displayName = String(req.body.displayName || '').trim();
    const password = String(req.body.password || '');

    if (!username) throw new Error('Partner username is required.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(`
      insert into "PartnerUser" (
        id, username, "displayName", "passwordHash", "createdByAdminId", "createdByAdminUsername", "createdAt", "updatedAt"
      )
      values ($1, $2, $3, $4, $5, $6, current_timestamp, current_timestamp)
    `, [cuid(), username, displayName || null, passwordHash, req.admin.id || null, req.admin.username || null]);

    res.redirect('/partners');
  } catch (error) {
    if (error && error.code === '23505') {
      res.status(409).send(page({ active: 'partners', body: empty('Partner username already exists.'), title: 'Conflict' }));
      return;
    }

    next(error);
  }
});

app.post('/partners/:id', requireAdmin, requireSection('partners', 'edit'), async (req, res, next) => {
  try {
    const displayName = String(req.body.displayName || '').trim();
    const isActive = req.body.isActive === 'on';

    await pool.query(`
      update "PartnerUser"
      set "displayName" = $1, "isActive" = $2, "updatedAt" = current_timestamp
      where id = $3
    `, [displayName || null, isActive, req.params.id]);

    const password = String(req.body.password || '');
    if (password) {
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      await pool.query('update "PartnerUser" set "passwordHash" = $1, "updatedAt" = current_timestamp where id = $2', [await bcrypt.hash(password, 12), req.params.id]);
    }

    res.redirect('/partners');
  } catch (error) {
    next(error);
  }
});

app.get('/api/live', requireAdmin, requireSection('dashboard'), async (_req, res, next) => {
  try {
    res.json(await getLiveMetrics());
  } catch (error) {
    next(error);
  }
});

app.get('/operations', requireAdmin, requireSection('operations'), async (_req, res, next) => {
  try {
    const cleanup = await getCleanupExposure();
    res.send(page({
      active: 'operations',
      body: `
        ${hero('Operations', 'Retention, upload safety limits, cooldowns, and database cleanup exposure.', logout())}
        <section class="metric-grid">
          ${metric('Expired queue messages', number(cleanup.expired_messages), 'Eligible for scheduled removal')}
          ${metric('Orphan media files', number(cleanup.orphan_media), 'Uploaded but not attached to a message')}
          ${metric('Expired sessions', number(cleanup.expired_sessions), 'Eligible for scheduled removal')}
          ${metric('Open reports overdue', number(cleanup.overdue_reports), 'Requires moderation action')}
        </section>
        <section class="dash-grid">
          ${panel('Message retention', policyRows([
            ['Text messages', `${backendPolicy.retention.textMessageDays} days`],
            ['Images, videos, files, voice', `${backendPolicy.retention.mediaMessageDays} days`],
            ['Current and live locations', `${backendPolicy.retention.locationMessageDays} days`],
          ]))}
          ${panel('Upload limits', policyRows([
            ['Single attachment', bytes(backendPolicy.uploads.maxAttachmentBytes)],
            ['Combined attachment selection', bytes(backendPolicy.uploads.maxBatchAttachmentBytes)],
            ['Chunk size', bytes(backendPolicy.uploads.maxChunkBytes)],
            ['Direct upload threshold', bytes(backendPolicy.uploads.maxDirectUploadBytes)],
          ]))}
          ${panel('Send cooldowns', policyRows([
            ['Text messages', `${backendPolicy.rateLimits.textMessagesPerMinute} per minute`],
            ['Media messages', `${backendPolicy.rateLimits.mediaMessagesPerMinute} per minute`],
            ['Completed uploads', `${backendPolicy.rateLimits.uploadsPerMinute} per minute`],
          ]))}
          ${panel('Maintenance schedule', policyRows([
            ['Cleanup interval', `${backendPolicy.maintenance.cleanupIntervalMinutes} minutes`],
            ['Partial upload retention', `${backendPolicy.maintenance.partialUploadRetentionHours} hours`],
            ['Orphan media retention', `${backendPolicy.maintenance.orphanMediaRetentionHours} hours`],
            ['Expired session retention', `${backendPolicy.maintenance.expiredSessionRetentionDays} days`],
          ]))}
        </section>
        <div class="ops-note">Policies are loaded from <strong>config.json</strong> beside the backend <strong>.env</strong>. Restart the backend after editing that file.</div>
      `,
      title: 'Operations',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/', requireAdmin, async (_req, res, next) => {
  try {
    const canOpenRealtimeCallRows = _req.admin?.isSuperAdmin === true;
    const canSeeLiveKit = canRead('calls');
    const [overview, live, reportMix, recentUsers, heavyMedia, activeCalls, recentSubs, messageMix, groupSummary, liveKitSnapshot] = await Promise.all([
      getOverview(),
      getLiveMetrics(),
      pool.query(`
        select "targetType", count(*)::int count
        from "Report"
        group by "targetType"
        order by "targetType"
      `),
      pool.query(`
        select id, username, "displayName", "createdAt", "lastSeenAt"
        from "User"
        order by "createdAt" desc
        limit 8
      `),
      pool.query(`
        select u.id, u.username, u."displayName", coalesce(ums."mediaBytes",0)::bigint bytes
        from "User" u
        left join "UserMessageStats" ums on ums."userId" = u.id
        order by bytes desc
        limit 8
      `),
      getActiveCalls(),
      getSubscriptions({ limit: 8 }),
      getMessageMix(),
      getGroupSummary(),
      canSeeLiveKit ? getLiveKitAdminSnapshot() : Promise.resolve(null),
    ]);

    res.send(page({
      active: 'dashboard',
      body: `
        ${hero('Dashboard', 'Live operations view with durable counters and real-time call/user state.', logout())}
        <section class="metric-grid live-grid">
          ${metricTriplet([
            { label: 'Users', value: number(overview.users) },
            { label: 'Online', value: number(live.onlineUsers), key: 'onlineUsers' },
            { label: 'Subscriptions', value: number(overview.active_subscriptions) },
          ], { live: true })}
          ${metricTriplet([
            { label: 'Calls', value: number(live.peopleInCalls), key: 'peopleInCalls' },
            { label: 'Voice', value: number(live.peopleInVoiceCalls), key: 'peopleInVoiceCalls' },
            { label: 'Video', value: number(live.peopleInVideoCalls), key: 'peopleInVideoCalls' },
          ], { live: true })}
          ${metricTriplet([
            { label: 'Peak online', value: number(live.peaks.onlineUsers), key: 'peakOnlineUsers' },
            { label: 'Peak voice', value: number(live.peaks.peopleInVoiceCalls), key: 'peakPeopleInVoiceCalls' },
            { label: 'Peak video', value: number(live.peaks.peopleInVideoCalls), key: 'peakPeopleInVideoCalls' },
          ], { live: true })}
          ${metricTriplet([
            { label: 'Groups', value: number(groupSummary.groups) },
            { label: 'Private', value: number(groupSummary.private_groups) },
            { label: 'Public', value: number(groupSummary.public_groups) },
          ])}
        </section>
        <section class="metric-grid">
          ${metricTriplet([
            { label: 'Messages', value: number(overview.messages) },
            { label: 'Calls', value: number(overview.calls) },
            { label: 'Media sent', value: bytes(overview.media_bytes) },
          ])}
          ${metricTriplet([
            { label: 'Reports', value: number(overview.reports) },
            { label: 'Open', value: number(overview.open_reports) },
            { label: 'Overdue', value: number(overview.overdue_reports) },
          ])}
        </section>
        <section class="dash-grid">
          ${panel('Recent subscriptions', subscriptionMiniTable(recentSubs.rows), { action: '<a class="btn secondary" href="/subscriptions">All subscriptions</a>' })}
          ${canSeeLiveKit ? panel('LiveKit servers', liveKitSnapshot ? liveKitServerMiniTable(liveKitSnapshot.servers) : empty('No LiveKit servers configured.'), { action: '<a class="btn secondary" href="/livekit">Details</a>' }) : ''}
          ${canOpenRealtimeCallRows ? panel('Real-time calls', activeCalls.rows.length ? callCards(activeCalls.rows, { clickable: true }) : empty('No active calls.'), {
            action: canOpenRealtimeCallRows ? '<a class="btn secondary" href="/calls">Open calls</a>' : '',
          }) : ''}
          ${panel('Message mix', bars(messageMix.rows, 'kind', 'count'))}
          ${panel('Recent registrations', userMiniTable(recentUsers.rows), { action: '<a class="btn secondary" href="/users">All users</a>' })}
          ${panel('Largest media senders', mediaMiniTable(heavyMedia.rows))}
          ${panel('Report mix', reportMix.rows.length ? `<div class="info-list">${reportMix.rows.map((r) => `<div class="info-row"><span>${escapeHtml(translateText(String(r.targetType || '')))}</span><strong>${number(r.count)}</strong></div>`).join('')}</div>` : empty('No reports yet.'), { action: '<a class="btn secondary" href="/reports">Reports</a>' })}
        </section>
      `,
      live: true,
      title: 'Dashboard',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/users', requireAdmin, requireSection('users'), async (req, res, next) => {
  try {
    const sort = SORTS[req.query.sort] ? req.query.sort : 'created_at';
    const direction = String(req.query.dir).toLowerCase() === 'asc' ? 'asc' : 'desc';
    const q = String(req.query.q || '').trim();
    const adminBlocked = req.query.adminBlocked === '1';
    const rows = await getUsers({ adminBlocked, direction, q, sort });
    res.send(page({
      active: 'users',
      body: `
        ${hero('Users', `${number(rows.length)} users with activity, calls, contacts, devices, and subscription data.`, `<div class="actions"><a class="btn secondary" href="/undelivered-messages">${escapeHtml(translateText('Undelivered messages'))}</a>${logout()}</div>`)}
        <form class="toolbar" method="get">
          ${adminBlocked ? '<input type="hidden" name="adminBlocked" value="1">' : ''}
          <label>Search <input name="q" value="${escapeAttr(q)}" placeholder="${escapeAttr(translateText('Username or display name'))}"></label>
          <label>Sort ${selectLabeled('sort', sort, userSortOptions())}</label>
          <label>Order ${selectLabeled('dir', direction, [['desc', 'Newest first'], ['asc', 'Oldest first']])}</label>
          <button>Apply</button>
          <a class="btn secondary" href="${adminBlocked ? '/users' : '/users?adminBlocked=1'}">${escapeHtml(translateText(adminBlocked ? 'All users' : 'Admin blocked'))}</a>
        </form>
        <div class="panel"><div class="table-wrap users-table-wrap"><table class="users-card-table">
          <thead><tr>${[
            'User', 'Registered', 'Last online', 'Last sign-in', 'Contacts', 'Messages',
            'Voice today', 'Voice 7d', 'Voice 15d', 'Voice 30d', 'Voice duration',
            'Video today', 'Video 7d', 'Video 15d', 'Video 30d', 'Video duration', 'Status',
          ].map((h) => `<th>${escapeHtml(translateText(h))}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(userRow).join('')}</tbody>
        </table></div></div>
      `,
      title: 'Users',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/undelivered-messages', requireAdmin, requireSection('users'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const { rows, totals } = await getUndeliveredMessageStats(q);

    res.send(page({
      active: 'undelivered',
      body: `
        ${hero('Message delivery', 'Users with undelivered messages', `<div class="actions"><a class="btn secondary" href="/users">${escapeHtml(translateText('Users'))}</a>${logout()}</div>`)}
        <section class="metric-grid">
          ${metricTriplet([
            { label: 'Total undelivered', value: number(totals.total) },
            { label: 'Private', value: number(totals.private) },
            { label: 'Groups', value: number(totals.group) },
          ])}
        </section>
        <form class="toolbar" method="get">
          <label>${escapeHtml(translateText('Search'))} <input name="q" value="${escapeAttr(q)}" placeholder="${escapeAttr(translateText('Username or display name'))}"></label>
          <button>${escapeHtml(translateText('Apply'))}</button>
        </form>
        ${panel('Message delivery queue', undeliveredMessageTable(rows))}
      `,
      title: 'Undelivered messages',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/users/:id', requireAdmin, requireSection('users'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const showSensitiveUserDetails = canEdit('users');
    const [
      user, sessions, devices, messageStats, mediaStats, groups, ownedGroups, reportsByUser,
      reportsAgainstUser, blocks, contacts, subscribers, subscriptions, calls,
    ] = await Promise.all([
      getUser(id),
      showSensitiveUserDetails ? pool.query('select * from "Session" where "userId" = $1 order by "createdAt" desc limit 30', [id]) : { rows: [] },
      showSensitiveUserDetails ? pool.query('select * from "DevicePushToken" where "userId" = $1 order by "updatedAt" desc', [id]) : { rows: [] },
      getUserMessageStats(id),
      getUserMediaStats(id),
      getUserGroups(id),
      pool.query('select id, title, "createdAt" from "Conversation" where "ownerId" = $1 and type = $2 order by "createdAt" desc', [id, 'GROUP']),
      pool.query('select * from "Report" where "reporterId" = $1 order by "createdAt" desc limit 20', [id]),
      pool.query('select * from "Report" where "targetUserId" = $1 order by "createdAt" desc limit 20', [id]),
      pool.query('select * from "AdminBlockedUser" where "userId" = $1', [id]),
      showSensitiveUserDetails ? getUserContacts(id) : { rows: [] },
      showSensitiveUserDetails ? getUserSavedBy(id) : { rows: [] },
      getUserSubscriptions(id),
      showSensitiveUserDetails ? getUserCalls(id) : { rows: [] },
    ]);
    if (!user) {
      res.status(404).send(page({ active: 'users', body: empty('User not found.'), title: 'Not found' }));
      return;
    }
    const blocked = blocks.rows[0];
    const [registrationIpLocation, latestIpLocation] = await Promise.all([
      resolveIpLocation(user.registration_ip),
      resolveIpLocation(user.latest_ip),
    ]);
    const userMetricCards = [
      ...(showSensitiveUserDetails ? [
        metric('Contacts', number(user.contacts_count), 'Saved by this user'),
      ] : []),
      metric('Sent messages', number(user.total_messages), 'Durable stat counter'),
      metric('Media sent', bytes(user.media_bytes), 'Total upload bytes'),
      ...(showSensitiveUserDetails ? [
        metric('Voice calls 30d', number(user.voice_30d), duration(user.voice_duration_sec)),
        metric('Video calls 30d', number(user.video_30d), duration(user.video_duration_sec)),
      ] : []),
      metric('Status', blocked ? 'Blocked' : 'Active', blocked ? escapeHtml(blocked.reason || 'No reason') : 'Can sign in'),
    ].join('');
    const profileDetails = [
      ['Registered', date(user.createdAt)],
      ...(showSensitiveUserDetails ? [
        ['Registration IP', formatIpWithLocation(user.registration_ip, registrationIpLocation)],
      ] : []),
      ['Registration OS', user.registration_platform || 'Unknown'],
      ['Registration language', user.registration_locale || 'Unknown'],
      ['Last online', date(user.lastSeenAt)],
      ['Last sign-in', date(user.last_signin_at)],
      ...(showSensitiveUserDetails ? [
        ['Latest IP', formatIpWithLocation(user.latest_ip, latestIpLocation)],
      ] : []),
    ];
    const adminActionsBody = canEdit('users') ? `
      <div class="stack">
        <form method="post" action="/users/${escapeAttr(id)}/block">
          <label>${escapeHtml(translateText('Block reason'))} <textarea name="reason" rows="3">${blocked ? escapeHtml(blocked.reason || '') : ''}</textarea></label>
          <button class="danger">${escapeHtml(translateText(blocked ? 'Update block' : 'Block user'))}</button>
        </form>
        ${blocked ? `<form method="post" action="/users/${escapeAttr(id)}/unblock"><button>${escapeHtml(translateText('Unblock user'))}</button></form>` : ''}
        <details class="admin-details">
          <summary>${escapeHtml(translateText('Change password'))}</summary>
          <form method="post" action="/users/${escapeAttr(id)}/password" onsubmit="return confirm('${escapeAttr(translateText('Change this user password and sign out their active sessions?'))}')">
            <label>${escapeHtml(translateText('New password'))} <input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
            <button>${escapeHtml(translateText('Save new password'))}</button>
          </form>
        </details>
        <form method="post" action="/users/${escapeAttr(id)}/delete" onsubmit="return confirm('${escapeAttr(translateText('Delete this user permanently?'))}')">
          <button class="danger">${escapeHtml(translateText('Delete user'))}</button>
        </form>
      </div>
    ` : empty('Read-only access. Editing user data is disabled for this admin.');
    const settingsTabs = [
      ...(showSensitiveUserDetails ? [{
        body: adminActionsBody,
        label: translateText('Admin actions'),
      }] : []),
      ...(req.admin?.isSuperAdmin ? [
        {
          body: catalogUrlForm(user),
          label: translateText('Catalog URL'),
        },
        {
          body: diagnosticModeForm(user),
          label: translateText('Remote diagnostics'),
        },
      ] : []),
    ];
    const modalCards = [
      modalPanelButton('subscriptions', translateText('Subscriptions'), subscriptionTable(subscriptions.rows), `${number(subscriptions.rows.length)} ${translateText('Subscriptions')}`, manualPaymentAction(id), 'blue'),
      modalPanelButton('statistics', translateText('Statistics'), tabbedModalContent('statistics', [
        {
          body: statTable(messageStats.rows, ['kind', 'count']),
          label: translateText('Messages by type'),
        },
        ...(showSensitiveUserDetails ? [{
          body: callTable(calls.rows),
          label: countTitle('Recent calls', calls.rows.length),
        }] : []),
        {
          body: statTable(mediaStats.rows.map((r) => ({ ...r, bytes: bytes(r.bytes) })), ['kind', 'count', 'bytes']),
          label: translateText('Files/media by type'),
        },
      ]), `${number(messageStats.rows.length + mediaStats.rows.length + (showSensitiveUserDetails ? calls.rows.length : 0))} ${translateText('Rows')}`, '', 'light-blue'),
      ...(showSensitiveUserDetails ? [
        modalPanelButton('contacts', translateText('Contacts'), tabbedModalContent('contacts', [
          {
            body: contactTable(contacts.rows, id) + (canEdit('users') ? `<form class="inline-form" method="post" action="/users/${escapeAttr(id)}/contacts">
              <label>${escapeHtml(translateText('Add contact by username'))} <input name="username" placeholder="${escapeAttr(translateText('Username'))}" required></label>
              <button>${escapeHtml(translateText('Add contact'))}</button>
            </form>` : ''),
            label: countTitle('Contacts saved by user', contacts.rows.length),
          },
          {
            body: contactReadonlyTable(subscribers.rows),
            label: countTitle('Users who saved this user', subscribers.rows.length),
          },
        ]), `${number(contacts.rows.length)} / ${number(subscribers.rows.length)}`, '', 'green'),
      ] : []),
      modalPanelButton('groups', translateText('Groups'), tabbedModalContent('groups', [
        {
          body: groupTable(groups.rows),
          label: countTitle('Groups user is in', groups.rows.length),
        },
        {
          body: groupTable(ownedGroups.rows),
          label: countTitle('Groups created by user', ownedGroups.rows.length),
        },
      ]), `${number(groups.rows.length)} / ${number(ownedGroups.rows.length)}`, '', 'dark-green'),
      ...(showSensitiveUserDetails ? [
        modalPanelButton('device-data', translateText('Device data'), tabbedModalContent('device-data', [
          {
            body: sessionTable(sessions.rows),
            label: countTitle('Sessions and IP addresses', sessions.rows.length),
          },
          {
            body: deviceTable(devices.rows),
            label: countTitle('Push devices', devices.rows.length),
          },
          {
            body: `<div class="privacy-pill-list">${privacySummary(user)}</div>`,
            label: translateText('Privacy'),
          },
        ]), `${number(sessions.rows.length)} / ${number(devices.rows.length)}`, '', 'dark-blue'),
      ] : []),
      ...(settingsTabs.length > 0 ? [
        modalPanelButton('settings', translateText('Settings'), tabbedModalContent('settings', settingsTabs), translateText('Admin editing'), '', 'black'),
      ] : []),
      modalPanelButton('reports', translateText('Reports'), tabbedModalContent('reports', [
        {
          body: reportSmallTable(reportsByUser.rows),
          label: countTitle('Reports made by user', reportsByUser.rows.length),
        },
        {
          body: reportSmallTable(reportsAgainstUser.rows),
          label: countTitle('Reports against user', reportsAgainstUser.rows.length),
        },
      ]), `${number(reportsByUser.rows.length + reportsAgainstUser.rows.length)} ${translateText('Reports')}`),
    ].join('');
    res.send(page({
      active: 'users',
      body: `
        ${hero(escapeHtml(user.displayName), `@${escapeHtml(user.username)}`, `<div class="actions"><a class="btn secondary" href="/users">Back</a>${logout()}</div>`)}
        <section class="metric-grid user-metric-grid">
          ${userMetricCards}
        </section>
        <section class="detail-grid user-primary-grid">
          ${panel('Profile', detailList(profileDetails))}
        </section>
        <section class="detail-grid user-modal-grid">
          ${modalCards}
        </section>
        ${manualPaymentModal(id)}
      `,
      title: user.displayName || user.username,
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/block', requireAdmin, requireSection('users', 'edit'), requireSuperAdmin, async (req, res, next) => {
  try {
    await pool.query(`
      insert into "AdminBlockedUser" ("userId", reason)
      values ($1, $2)
      on conflict ("userId") do update set reason = excluded.reason, "createdAt" = current_timestamp
    `, [req.params.id, req.body.reason || null]);
    await pool.query('delete from "Session" where "userId" = $1', [req.params.id]);
    res.redirect(`/users/${encodeURIComponent(req.params.id)}`);
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/unblock', requireAdmin, requireSection('users', 'edit'), requireSuperAdmin, async (req, res, next) => {
  try {
    await pool.query('delete from "AdminBlockedUser" where "userId" = $1', [req.params.id]);
    res.redirect(`/users/${encodeURIComponent(req.params.id)}`);
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/delete', requireAdmin, requireSection('users', 'edit'), requireSuperAdmin, async (req, res, next) => {
  try {
    await pool.query('delete from "User" where id = $1', [req.params.id]);
    res.redirect('/users');
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/password', requireAdmin, requireSection('users', 'edit'), async (req, res, next) => {
  try {
    const password = String(req.body.password || '');

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query('update "User" set "passwordHash" = $1, "updatedAt" = current_timestamp where id = $2', [passwordHash, req.params.id]);

    if (result.rowCount === 0) {
      res.status(404).send(page({ active: 'users', body: empty('User not found.'), title: 'Not found' }));
      return;
    }

    await pool.query('delete from "Session" where "userId" = $1', [req.params.id]);
    res.redirect(`/users/${encodeURIComponent(req.params.id)}`);
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/contacts', requireAdmin, requireSection('users', 'edit'), requireSuperAdmin, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const contact = await getUserByUsername(username);
    if (!contact) throw new Error('Contact user not found.');
    if (contact.id === req.params.id) throw new Error('A user cannot be added to their own contacts.');

    await pool.query(`
      insert into "Contact" (id, "ownerId", "contactId")
      values ($1, $2, $3)
      on conflict ("ownerId", "contactId") do nothing
    `, [cuid(), req.params.id, contact.id]);
    res.redirect(`/users/${encodeURIComponent(req.params.id)}#contacts`);
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/contacts/:contactId/delete', requireAdmin, requireSection('users', 'edit'), requireSuperAdmin, async (req, res, next) => {
  try {
    await pool.query('delete from "Contact" where "ownerId" = $1 and "contactId" = $2', [req.params.id, req.params.contactId]);
    res.redirect(`/users/${encodeURIComponent(req.params.id)}#contacts`);
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/subscriptions/manual', requireAdmin, async (req, res, next) => {
  try {
    if (!canManageManualPayments(req.admin)) {
      res.status(403).send(page({ active: 'users', body: empty('This admin account cannot access this section.'), title: 'Forbidden' }));
      return;
    }

    const periodKey = String(req.body.period || '');
    const period = MANUAL_SUBSCRIPTION_PERIODS[periodKey];

    if (!period) {
      res.status(400).send(page({ active: 'subscriptions', body: empty('Invalid manual subscription period.'), title: 'Bad request' }));
      return;
    }

    const user = await getUser(req.params.id);

    if (!user) {
      res.status(404).send(page({ active: 'users', body: empty('User not found.'), title: 'Not found' }));
      return;
    }

    const baseExpiresAt = await getManualSubscriptionBaseDate(req.params.id);
    const expiresAt = calculateManualSubscriptionExpiry(baseExpiresAt, period);
    const admin = req.admin || {};
    const grantedAt = new Date();
    const rawLatestEvent = {
      source: 'manual_admin_grant',
      period: periodKey,
      periodLabel: period.label,
      grantedByAdminId: admin.id || null,
      grantedByUsername: admin.username || null,
      grantedAt: grantedAt.toISOString(),
    };

    const entitlementId = cuid();

    await pool.query(`
      insert into "SubscriptionEntitlement" (
        id, "userId", platform, "productId", status, environment, "expiresAt", "willRenew",
        "rawLatestEvent", "manualGrantedByAdminId", "manualGrantedByUsername", "manualGrantedAt",
        "lastVerifiedAt", "createdAt", "updatedAt"
      )
      values ($1, $2, 'MANUAL', $3, 'ACTIVE', 'PRODUCTION', $4, false, $5::jsonb, $6, $7, $8, current_timestamp, current_timestamp, current_timestamp)
    `, [
      entitlementId,
      req.params.id,
      period.productId,
      expiresAt,
      JSON.stringify(rawLatestEvent),
      admin.id || null,
      admin.username || null,
      grantedAt,
    ]);
    notifyManualSubscriptionServerEvent(entitlementId).catch((error) => {
      console.warn('Could not send manual subscription server event', error);
    });

    res.redirect(`/users/${encodeURIComponent(req.params.id)}#subscriptions`);
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/catalog-url', requireAdmin, requireSection('users', 'edit'), requireSuperAdmin, async (req, res, next) => {
  try {
    const catalogUrl = normalizeCatalogUrl(req.body.catalogUrl);
    const result = await pool.query('update "User" set "catalogUrl" = $1, "updatedAt" = current_timestamp where id = $2', [catalogUrl, req.params.id]);

    if (result.rowCount === 0) {
      res.status(404).send(page({ active: 'users', body: empty('User not found.'), title: 'Not found' }));
      return;
    }

    res.redirect(`/users/${encodeURIComponent(req.params.id)}#catalog-url`);
  } catch (error) {
    next(error);
  }
});

app.post('/users/:id/diagnostics', requireAdmin, requireSection('users', 'edit'), requireSuperAdmin, async (req, res, next) => {
  try {
    const diagnosticMode = req.body.diagnosticMode === '1';
    const callDiagnosticMode = req.body.callDiagnosticMode === '1';
    const result = await pool.query(
      'update "User" set "diagnosticMode" = $1, "callDiagnosticMode" = $2, "updatedAt" = current_timestamp where id = $3',
      [diagnosticMode, callDiagnosticMode, req.params.id],
    );

    if (result.rowCount === 0) {
      res.status(404).send(page({ active: 'users', body: empty('User not found.'), title: 'Not found' }));
      return;
    }

    res.redirect(`/users/${encodeURIComponent(req.params.id)}#remote-diagnostics`);
  } catch (error) {
    next(error);
  }
});

app.get('/calls', requireAdmin, requireSection('calls'), async (req, res, next) => {
  try {
    const status = req.query.status === 'active' ? 'active' : 'all';
    const mode = ['VOICE', 'VIDEO'].includes(req.query.mode) ? req.query.mode : '';
    const rows = await getCalls({ mode, status });
    res.send(page({
      active: 'calls',
      body: `
        ${hero('Calls', 'Inspect live calls, participants, rooms, duration, and related users.', logout())}
        <form class="toolbar" method="get">
          <label>${escapeHtml(translateText('Status'))} ${selectLabeled('status', status, [['all', 'All calls'], ['active', 'Active only']])}</label>
          <label>Mode ${selectLabeled('mode', mode, [['', 'All modes'], ['VOICE', 'Voice'], ['VIDEO', 'Video']])}</label>
          <button>Filter</button>
        </form>
        <div class="panel"><div class="table-wrap"><table>
          <thead><tr><th>${escapeHtml(translateText('Call'))}</th><th>${escapeHtml(translateText('Conversation'))}</th><th>${escapeHtml(translateText('Mode'))}</th><th>${escapeHtml(translateText('Started'))}</th><th>${escapeHtml(translateText('Ended'))}</th><th>${escapeHtml(translateText('Participants'))}</th><th></th></tr></thead>
          <tbody>${rows.map((row) => callRowWithOptions(row, { showIds: false })).join('')}</tbody>
        </table></div></div>
      `,
      title: 'Calls',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/livekit', requireAdmin, requireSection('calls'), async (_req, res, next) => {
  try {
    const snapshot = await getLiveKitAdminSnapshot();
    res.send(page({
      active: 'livekit',
      body: `
        ${hero('LiveKit servers', 'Pooled LiveKit routing, capacity, and active call distribution.', `<div class="actions"><a class="btn secondary" href="/calls?status=active">${escapeHtml(translateText('Back to calls'))}</a>${logout()}</div>`)}
        ${snapshot.error ? `<div class="notice danger">${escapeHtml(snapshot.error)}</div>` : ''}
        ${panel('Configuration', liveKitConfigurationDetails(snapshot))}
        ${panel('LiveKit servers', liveKitServerTable(snapshot.servers))}
      `,
      title: 'LiveKit servers',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/calls/:id', requireAdmin, requireSection('calls'), async (req, res, next) => {
  try {
    const call = (await pool.query(`
      select c.*, cv.title, cv.type, cv."ownerId", count(cp.id)::int participant_count,
        count(cp.id) filter (where cp."joinedAt" is not null and cp."leftAt" is null)::int joined_now,
        max(cp."leftAt") filter (where cp."joinedAt" is not null)::timestamp(3) last_left_at,
        string_agg(distinct nullif(u."displayName", ''), ', ' order by nullif(u."displayName", '')) filter (where u.id is not null)::text participant_names
      from "Call" c
      join "Conversation" cv on cv.id = c."conversationId"
      left join "CallParticipant" cp on cp."callId" = c.id
      left join "User" u on u.id = cp."userId"
      where c.id = $1
      group by c.id, cv.id
    `, [req.params.id])).rows[0];
    if (!call) {
      res.status(404).send(page({ active: 'calls', body: empty('Call not found.'), title: 'Not found' }));
      return;
    }
    const participants = await getCallParticipants(req.params.id);
    const effectiveEndedAt = getEffectiveCallEndedAt(call);
    res.send(page({
      active: 'calls',
      body: `
        ${hero('Call details', `${escapeHtml(callPrimaryLabel(call))} · ${escapeHtml(call.id)}`, `<div class="actions"><a class="btn secondary" href="/calls">Back</a>${logout()}</div>`)}
        <section class="metric-grid">
          ${metric('Mode', displayCallMode(call.mode), 'Call media type')}
          ${metric('Status', isCallActive(call) ? 'Active' : 'Ended', durationBetween(call.startedAt, effectiveEndedAt || new Date()))}
          ${metric('Participants', number(call.participant_count), 'Invited and joined users')}
          ${metric('Conversation', displayConversationType(call.type), escapeHtml(callConversationLabel(call)))}
        </section>
        ${panel('Participants', participantTable(participants.rows))}
      `,
      title: 'Call details',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/groups', requireAdmin, requireSection('groups'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = await getGroups(q);
    res.send(page({
      active: 'groups',
      body: `
        ${hero('Groups', 'Audit group ownership, admins, members, settings, and reports.', logout())}
        <form class="toolbar" method="get">
          <label>Search <input name="q" value="${escapeAttr(q)}" placeholder="${escapeAttr(translateText('Group title or owner username'))}"></label>
          <button>Apply</button>
        </form>
        <div class="panel"><div class="table-wrap"><table>
          <thead><tr><th>${escapeHtml(translateText('Group'))}</th><th>${escapeHtml(translateText('Owner'))}</th><th>${escapeHtml(translateText('Members'))}</th><th>${escapeHtml(translateText('Admins'))}</th><th>${escapeHtml(translateText('Settings'))}</th><th>${escapeHtml(translateText('Last activity'))}</th><th></th></tr></thead>
          <tbody>${rows.map(groupRow).join('')}</tbody>
        </table></div></div>
      `,
      title: 'Groups',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/groups/:id', requireAdmin, requireSection('groups'), async (req, res, next) => {
  try {
    await sendGroupDetailPage(req, res);
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/settings', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    await pool.query(`
      update "Conversation"
      set title = $1, "hideMembers" = $2, "showAdmins" = $3, "ownerOnlyMessages" = $4, "updatedAt" = current_timestamp
      where id = $5 and type = 'GROUP'
    `, [
      String(req.body.title || '').trim() || null,
      req.body.hideMembers === 'on',
      req.body.showAdmins === 'on',
      req.body.ownerOnlyMessages === 'on',
      req.params.id,
    ]);
    res.redirect(`/groups/${encodeURIComponent(req.params.id)}`);
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/members', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const user = await getUserByUsername(username);
    if (!user) throw new Error('User not found.');
    const isAdmin = req.body.role === 'admin';
    await pool.query(`
      insert into "ConversationMember" (id, "conversationId", "userId", "isAdmin", "aliasPromptSeen")
      values ($1, $2, $3, $4, true)
      on conflict ("conversationId", "userId") do update set "isAdmin" = ("ConversationMember"."isAdmin" or excluded."isAdmin")
    `, [cuid(), req.params.id, user.id, isAdmin]);
    res.redirect(`/groups/${encodeURIComponent(req.params.id)}#members`);
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/members/:userId/remove', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    const group = await getGroup(req.params.id);
    if (group?.ownerId === req.params.userId) throw new Error('Transfer ownership before removing the owner.');
    await pool.query('delete from "ConversationMember" where "conversationId" = $1 and "userId" = $2', [req.params.id, req.params.userId]);
    res.redirect(`/groups/${encodeURIComponent(req.params.id)}#members`);
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/admins/:userId/toggle', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    const group = await getGroup(req.params.id);
    if (group?.ownerId === req.params.userId) throw new Error('Owner admin rights cannot be removed.');
    await pool.query(`
      update "ConversationMember"
      set "isAdmin" = not "isAdmin"
      where "conversationId" = $1 and "userId" = $2
    `, [req.params.id, req.params.userId]);
    res.redirect(`/groups/${encodeURIComponent(req.params.id)}#members`);
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/owner', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    const userId = String(req.body.userId || '');
    await pool.query('update "Conversation" set "ownerId" = $1, "updatedAt" = current_timestamp where id = $2 and type = $3', [userId, req.params.id, 'GROUP']);
    await pool.query('update "ConversationMember" set "isAdmin" = true, "aliasPromptSeen" = true where "conversationId" = $1 and "userId" = $2', [req.params.id, userId]);
    res.redirect(`/groups/${encodeURIComponent(req.params.id)}#members`);
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/webhooks', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    const group = await getGroup(req.params.id);
    if (!group) throw new Error('Group not found.');
    const token = createWebhookToken();
    const name = String(req.body.name || '').trim().slice(0, 80) || 'Group webhook';

    await pool.query(`
      insert into "GroupWebhook" (id, "conversationId", name, "tokenHash", "tokenPrefix")
      values ($1, $2, $3, $4, $5)
    `, [cuid(), req.params.id, name, hashWebhookToken(token), token.slice(0, 10)]);

    await sendGroupDetailPage(req, res, {
      createdWebhookName: name,
      createdWebhookUrl: getWebhookUrl(token),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/webhooks/:webhookId/toggle', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    await pool.query(`
      update "GroupWebhook"
      set enabled = $1, "updatedAt" = current_timestamp
      where id = $2 and "conversationId" = $3 and "revokedAt" is null
    `, [req.body.enabled === 'true', req.params.webhookId, req.params.id]);
    res.redirect(`/groups/${encodeURIComponent(req.params.id)}#webhooks`);
  } catch (error) {
    next(error);
  }
});

app.post('/groups/:id/webhooks/:webhookId/revoke', requireAdmin, requireSection('groups', 'edit'), async (req, res, next) => {
  try {
    await pool.query(`
      update "GroupWebhook"
      set enabled = false, "revokedAt" = current_timestamp, "updatedAt" = current_timestamp
      where id = $1 and "conversationId" = $2
    `, [req.params.webhookId, req.params.id]);
    res.redirect(`/groups/${encodeURIComponent(req.params.id)}#webhooks`);
  } catch (error) {
    next(error);
  }
});

app.get('/subscriptions', requireAdmin, requireSection('subscriptions'), async (req, res, next) => {
  try {
    const status = ['ACTIVE', 'GRACE', 'BILLING_RETRY', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'REVOKED'].includes(req.query.status) ? req.query.status : '';
    const platform = ['IOS', 'ANDROID', 'MANUAL'].includes(req.query.platform) ? req.query.platform : '';
    const { rows } = await getSubscriptions({ platform, status });
    res.send(page({
      active: 'subscriptions',
      body: `
        ${hero('Subscriptions', `${number(rows.length)} paid entitlement records with account display names, Apple/Google/manual identifiers, expiration, renewal state, and raw payment payloads.`, logout())}
        <form class="toolbar" method="get">
          <label>${escapeHtml(translateText('Status'))} ${selectLabeled('status', status, [['', 'All statuses'], ['ACTIVE', 'Active'], ['GRACE', 'Grace period'], ['BILLING_RETRY', 'Billing retry'], ['CANCELLED', 'Cancelled'], ['EXPIRED', 'Expired'], ['REFUNDED', 'Refunded'], ['REVOKED', 'Revoked']])}</label>
          <label>${escapeHtml(translateText('Platform'))} ${selectLabeled('platform', platform, [['', 'All platforms'], ['IOS', 'iOS'], ['ANDROID', 'Android'], ['MANUAL', 'Manual']])}</label>
          <button>Filter</button>
        </form>
        <div class="panel">${subscriptionTable(rows)}</div>
      `,
      title: 'Subscriptions',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/redeem-codes', requireAdmin, requireSection('subscriptions'), async (req, res, next) => {
  try {
    const rows = await getRedeemCodes();
    res.send(page({
      active: 'redeem-codes',
      body: `
        ${hero('Redeem codes', `${number(rows.length)} ${translateText('redeem codes for trial and promotional subscription access.')}`, logout())}
        <section class="detail-grid">
          ${canManageRedeemCodes(req.admin) ? panel('Create redeem code', redeemCodeCreateForm()) : panel('Create redeem code', empty('Read-only access. Redeem code changes are disabled for this admin.'))}
          ${panel('Redeem codes', redeemCodeTable(rows))}
        </section>
      `,
      title: 'Redeem codes',
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/redeem-codes', requireAdmin, requireSection('subscriptions'), async (req, res, next) => {
  try {
    if (!canManageRedeemCodes(req.admin)) {
      res.status(403).send(page({ active: 'redeem-codes', body: empty('This admin account cannot access this section.'), title: 'Forbidden' }));
      return;
    }

    const name = String(req.body.name || '').trim();
    const periodKey = String(req.body.period || '');
    const period = REDEEM_SUBSCRIPTION_PERIODS[periodKey];
    const maxUses = Math.max(1, Math.min(100000, Number.parseInt(String(req.body.maxUses || '1'), 10) || 1));
    const code = normalizeRedeemCode(req.body.code || generateRedeemCode());

    if (!name) {
      res.status(400).send(page({ active: 'redeem-codes', body: empty('Redeem code name is required.'), title: 'Bad request' }));
      return;
    }

    if (!period) {
      res.status(400).send(page({ active: 'redeem-codes', body: empty('Invalid redeem code package.'), title: 'Bad request' }));
      return;
    }

    if (!/^[A-Z0-9_-]{4,80}$/.test(code)) {
      res.status(400).send(page({ active: 'redeem-codes', body: empty('Invalid redeem code.'), title: 'Bad request' }));
      return;
    }

    try {
      await pool.query(`
        insert into "RedeemCode" (
          id, name, code, "productId", "durationMonths", "maxUses",
          "createdByAdminId", "createdByAdminUsername", "createdAt", "updatedAt"
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, current_timestamp, current_timestamp)
      `, [
        cuid(),
        name,
        code,
        period.productId,
        period.months,
        maxUses,
        req.admin.id || null,
        req.admin.username || null,
      ]);
    } catch (error) {
      if (error && error.code === '23505') {
        res.status(409).send(page({ active: 'redeem-codes', body: empty('Redeem code already exists.'), title: 'Conflict' }));
        return;
      }
      throw error;
    }

    res.redirect('/redeem-codes');
  } catch (error) {
    next(error);
  }
});

app.get('/redeem-codes/:id', requireAdmin, requireSection('subscriptions'), async (req, res, next) => {
  try {
    const code = await getRedeemCode(req.params.id);

    if (!code) {
      res.status(404).send(page({ active: 'redeem-codes', body: empty('Redeem code not found.'), title: 'Not found' }));
      return;
    }

    const uses = await getRedeemCodeUses(req.params.id);
    res.send(page({
      active: 'redeem-codes',
      body: `
        ${hero('Redeem code details', `${escapeHtml(code.name)} · ${escapeHtml(code.code)}`, `<div class="actions"><a class="btn secondary" href="/redeem-codes">${escapeHtml(translateText('Back'))}</a>${logout()}</div>`)}
        <section class="detail-grid">
          ${panel('Redeem code', detailList([
            ['Name', code.name],
            ['Code', code.code],
            ['Product', code.productId],
            ['Duration', `${code.durationMonths} ${translateText('Month')}`],
            ['Usage', `${number(code.usedCount)} / ${number(code.maxUses)}`],
            ['Created by admin', code.createdByAdminUsername || 'Unknown'],
            ['Created by partner', code.createdByPartnerUsername ? (code.partnerDisplayName || code.createdByPartnerUsername) : 'None'],
            ['Created at', date(code.createdAt)],
            ['Disabled', code.disabledAt ? 'Yes' : 'No'],
            ['Disabled at', date(code.disabledAt)],
          ]), { action: redeemCodeDisableAction(code) })}
          ${panel('Uses', redeemCodeUsesTable(uses))}
        </section>
      `,
      title: 'Redeem code details',
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/redeem-codes/:id/disable', requireAdmin, requireSection('subscriptions'), async (req, res, next) => {
  try {
    if (!canManageRedeemCodes(req.admin)) {
      res.status(403).send(page({ active: 'redeem-codes', body: empty('This admin account cannot access this section.'), title: 'Forbidden' }));
      return;
    }

    await pool.query(`
      update "RedeemCode"
      set "disabledAt" = coalesce("disabledAt", current_timestamp),
        "updatedAt" = current_timestamp
      where id = $1
    `, [req.params.id]);

    res.redirect(`/redeem-codes/${encodeURIComponent(req.params.id)}`);
  } catch (error) {
    next(error);
  }
});

app.get('/subscriptions/:id', requireAdmin, requireSection('subscriptions'), async (req, res, next) => {
  try {
    const sub = (await getSubscriptions({ id: req.params.id })).rows[0];
    if (!sub) {
      res.status(404).send(page({ active: 'subscriptions', body: empty('Subscription not found.'), title: 'Not found' }));
      return;
    }
    res.send(page({
      active: 'subscriptions',
      body: `
        ${hero('Subscription details', `${escapeHtml(sub.displayName || sub.username || sub.userId)} · ${escapeHtml(sub.productId)}`, `<div class="actions"><a class="btn secondary" href="/subscriptions">Back</a>${logout()}</div>`)}
        <section class="detail-grid">
          ${panel('Entitlement', detailList([
            ['User', userLink(sub.userId, sub.displayName, sub.username)],
            ['Platform', displaySubscriptionPlatform(sub.platform)],
            ['Product', sub.productId],
            ['Status', displaySubscriptionStatus(sub.status)],
            ['Environment', sub.environment],
            ['Expires', date(sub.expiresAt)],
            ['Will renew', sub.willRenew ? 'Yes' : 'No'],
            ...(sub.platform === 'MANUAL' ? [
              ['Granted by', sub.manualGrantedByUsername || 'Unknown'],
              ['Granted at', date(sub.manualGrantedAt)],
            ] : []),
            ['Purchase token', sub.purchaseToken || 'None'],
            ['Original transaction', sub.originalTransactionId || 'None'],
            ['Transaction', sub.transactionId || 'None'],
            ['Last verified', date(sub.lastVerifiedAt)],
          ]))}
          ${panel('Raw latest payment event', `<pre class="json">${escapeHtml(JSON.stringify(sub.rawLatestEvent || {}, null, 2))}</pre>`)}
        </section>
      `,
      title: sub.displayName || sub.username || 'Subscription details',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/reports', requireAdmin, requireSection('reports'), async (req, res, next) => {
  try {
    const type = ['USER', 'MESSAGE', 'GROUP'].includes(req.query.type) ? req.query.type : '';
    const status = ['OPEN', 'RESOLVED', 'DISMISSED'].includes(req.query.status) ? req.query.status : '';
    const rows = await getReports(type, status);
    res.send(page({
      active: 'reports',
      body: `
        ${hero('Reports', 'User, message, and group reports with direct target drill-down.', logout())}
        <form class="toolbar" method="get">
          <label>${escapeHtml(translateText('Type'))} ${selectLabeled('type', type, [['', 'All types'], ['USER', 'User'], ['MESSAGE', 'Message'], ['GROUP', 'Group']])}</label>
          <label>${escapeHtml(translateText('Status'))} ${selectLabeled('status', status, [['', 'All statuses'], ['OPEN', 'Open'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed']])}</label>
          <button>Filter</button>
        </form>
        <div class="panel"><div class="table-wrap"><table>
          <thead><tr><th>${escapeHtml(translateText('Status'))}</th><th>${escapeHtml(translateText('Type'))}</th><th>${escapeHtml(translateText('Reported at'))}</th><th>${escapeHtml(translateText('Reporter'))}</th><th>${escapeHtml(translateText('Target'))}</th><th>${escapeHtml(translateText('Reason'))}</th><th></th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td>${reportStatusPill(r)}</td>
              <td><span class="pill">${escapeHtml(translateText(r.targetType))}</span></td>
              <td>${date(r.createdAt)}</td>
              <td>${userLink(r.reporterId, r.reporter_name, r.reporter_username)}</td>
              <td>${targetLink(r)}</td>
              <td>${escapeHtml(r.reason || '')}</td>
              <td><a class="btn secondary" href="/reports/${encodeURIComponent(r.id)}">Details</a></td>
            </tr>
          `).join('')}</tbody>
        </table></div></div>
      `,
      title: 'Reports',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/reports/:id', requireAdmin, requireSection('reports'), async (req, res, next) => {
  try {
    const report = (await pool.query(`
      select r.*, ru.username reporter_username, ru."displayName" reporter_name,
        tu.username target_username, tu."displayName" target_user_name,
        tm.body target_message_body, tm.kind target_message_kind, tm."createdAt" target_message_at,
        tg.title target_group_title
      from "Report" r
      join "User" ru on ru.id = r."reporterId"
      left join "User" tu on tu.id = r."targetUserId"
      left join "Message" tm on tm.id = r."targetMessageId"
      left join "Conversation" tg on tg.id = r."targetGroupId"
      where r.id = $1
    `, [req.params.id])).rows[0];
    if (!report) {
      res.status(404).send(page({ active: 'reports', body: empty('Report not found.'), title: 'Not found' }));
      return;
    }
    res.send(page({
      active: 'reports',
      body: `
        ${hero('Report details', `${escapeHtml(report.reporter_name || report.reporter_username || report.reporterId)} · ${escapeHtml(translateText(report.targetType))}`, `<div class="actions"><a class="btn secondary" href="/reports">Back</a>${logout()}</div>`)}
        <section class="detail-grid">
          ${panel('Report', detailList([
            ['Type', translateText(report.targetType)],
            ['Datetime', date(report.createdAt)],
            ['Status', reportStatusPill(report)],
            ['Reviewed at', date(report.reviewedAt)],
            ['Reporter', userLink(report.reporterId, report.reporter_name, report.reporter_username)],
            ['Target reference', targetLink(report)],
            ['Reason', report.reason || 'No reason provided'],
          ]))}
          ${panel('Target details', detailList(reportTargetDetails(report)))}
          ${panel('Moderation action', canEdit('reports') ? `
            <form class="stack" method="post" action="/reports/${escapeAttr(report.id)}/status">
          <label>${escapeHtml(translateText('Status'))} ${select('status', report.status, ['OPEN', 'RESOLVED', 'DISMISSED'])}</label>
              <label>${escapeHtml(translateText('Moderator note'))} <textarea name="moderatorNote" rows="4">${escapeHtml(report.moderatorNote || '')}</textarea></label>
              <button>${escapeHtml(translateText('Save moderation status'))}</button>
            </form>
          ` : empty('Read-only access. Moderation changes are disabled for this admin.'))}
        </section>
      `,
      title: 'Report',
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/reports/:id/status', requireAdmin, requireSection('reports', 'edit'), async (req, res, next) => {
  try {
    const status = ['OPEN', 'RESOLVED', 'DISMISSED'].includes(req.body.status) ? req.body.status : 'OPEN';
    await pool.query(`
      update "Report"
      set "status" = $2, "moderatorNote" = $3, "reviewedAt" = case when $2 = 'OPEN' then null else now() end
      where id = $1
    `, [req.params.id, status, String(req.body.moderatorNote || '').trim().slice(0, 4000)]);
    res.redirect(`/reports/${encodeURIComponent(req.params.id)}`);
  } catch (error) {
    next(error);
  }
});

app.get('/support-tickets', requireAdmin, requireSection('support'), async (req, res, next) => {
  try {
    const activeTab = req.query.tab === 'archive' ? 'archive' : 'new';
    const allRows = await getSupportTickets();
    const newRows = allRows.filter((row) => Number(row.unread_count || 0) > 0);
    const archiveRows = allRows.filter((row) => Number(row.unread_count || 0) === 0 && row.lastAdminReplyAt);
    const rows = activeTab === 'archive' ? archiveRows : newRows;
    const unreadTotal = newRows.reduce((sum, row) => sum + Number(row.unread_count || 0), 0);

    res.send(page({
      active: 'support',
      body: `
        ${hero('Support tickets', `${number(newRows.length)} new tickets · ${number(unreadTotal)} new messages`, logout())}
        ${supportTicketTabs(activeTab, { archive: archiveRows.length, new: newRows.length })}
        ${panel('Support tickets', supportTicketTable(rows))}
      `,
      title: 'Support tickets',
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/support-tickets/:conversationId', requireAdmin, requireSection('support'), async (req, res, next) => {
  try {
    const ticket = await getSupportTicket(req.params.conversationId);

    if (!ticket) {
      res.status(404).send(page({ active: 'support', body: empty('Support ticket not found.'), title: 'Not found' }));
      return;
    }

    await markSupportTicketRead(ticket.conversationId, ticket.supportUserId);
    const messages = await getSupportTicketMessages(ticket.conversationId);

    res.send(page({
      active: 'support',
      body: `
        ${hero('Support ticket', `${escapeHtml(ticket.displayName)} (@${escapeHtml(ticket.username)})`, `<div class="actions"><a class="btn secondary" href="/support-tickets">Back</a>${logout()}</div>`)}
        <section class="detail-grid support-detail-grid">
          ${panel('Messages', supportConversation(messages, ticket.supportUserId), {
            action: canEdit('support') ? '' : `<span class="subtle">${escapeHtml(translateText('Read-only'))}</span>`,
          })}
        </section>
        ${canEdit('support') ? panel('Answer', supportReplyForm(ticket.conversationId)) : ''}
      `,
      title: 'Support ticket',
    }));
  } catch (error) {
    next(error);
  }
});

app.post('/support-tickets/:conversationId/messages', requireAdmin, requireSection('support', 'edit'), async (req, res, next) => {
  try {
    const ticket = await getSupportTicket(req.params.conversationId);

    if (!ticket) {
      res.status(404).send(page({ active: 'support', body: empty('Support ticket not found.'), title: 'Not found' }));
      return;
    }

    const body = String(req.body.body || '').trim();

    if (!body) {
      res.redirect(`/support-tickets/${encodeURIComponent(req.params.conversationId)}`);
      return;
    }

    await sendSupportReply(req.params.conversationId, body, req.admin.username);
    res.redirect(`/support-tickets/${encodeURIComponent(req.params.conversationId)}`);
  } catch (error) {
    next(error);
  }
});

async function getOverview() {
  return (await pool.query(`
    select
      (select count(*) from "User")::int users,
      coalesce((
        select "textMessages" + "imageMessages" + "videoMessages" + "fileMessages" + "voiceMessages"
        from "AnalyticsOverview"
        where id = 1
      ),0)::bigint messages,
      (select count(*) from "Call")::int calls,
      coalesce((select "mediaBytes" from "AnalyticsOverview" where id = 1),0)::bigint media_bytes,
      (select count(*) from "Report")::int reports,
      (select count(*) from "Report" where status = 'OPEN')::int open_reports,
      (select count(*) from "Report" where status = 'OPEN' and "createdAt" < now() - interval '24 hours')::int overdue_reports,
      (select count(*) from "AdminBlockedUser")::int blocked,
      (select count(*) from "SubscriptionEntitlement" where status in ('ACTIVE','GRACE') and "expiresAt" > now())::int active_subscriptions
  `)).rows[0];
}

async function getCleanupExposure() {
  const textCutoff = new Date(Date.now() - backendPolicy.retention.textMessageDays * 24 * 60 * 60 * 1000);
  const mediaCutoff = new Date(Date.now() - backendPolicy.retention.mediaMessageDays * 24 * 60 * 60 * 1000);
  const locationCutoff = new Date(Date.now() - backendPolicy.retention.locationMessageDays * 24 * 60 * 60 * 1000);
  const orphanCutoff = new Date(Date.now() - backendPolicy.maintenance.orphanMediaRetentionHours * 60 * 60 * 1000);
  const sessionCutoff = new Date(Date.now() - backendPolicy.maintenance.expiredSessionRetentionDays * 24 * 60 * 60 * 1000);
  return (await pool.query(`
    select
      (
        select count(*) from "Message"
        where (
          (kind = 'TEXT' and "createdAt" <= $1)
          or (kind = 'TEXT' and "createdAt" <= $5 and (metadata ? 'location' or metadata ? 'liveLocation'))
          or (kind in ('IMAGE','VIDEO','FILE','VOICE') and "createdAt" <= $2)
        )
      )::int expired_messages,
      (
        select count(*) from "MediaFile" mf
        where mf."createdAt" <= $3
          and not exists (select 1 from "Message" m where m."mediaId" = mf.id)
      )::int orphan_media,
      (select count(*) from "Session" where "expiresAt" <= $4)::int expired_sessions,
      (select count(*) from "Report" where status = 'OPEN' and "createdAt" < now() - interval '24 hours')::int overdue_reports
  `, [textCutoff, mediaCutoff, orphanCutoff, sessionCutoff, locationCutoff])).rows[0];
}

async function getLiveMetrics() {
  const row = (await pool.query(`
    with active_calls as (
      select c.id, c.mode
      from "Call" c
      where c."endedAt" is null
        and exists (
          select 1
          from "CallParticipant" cp
          where cp."callId" = c.id
            and cp."joinedAt" is not null
            and cp."leftAt" is null
        )
    ),
    active_participants as (
      select ac.mode, cp."userId"
      from active_calls ac
      join "CallParticipant" cp on cp."callId" = ac.id
      where cp."joinedAt" is not null
        and cp."leftAt" is null
    )
    select
      (select count(*) from "User" where "lastSeenAt" >= now() - interval '${ONLINE_WINDOW_MINUTES} minutes')::int online_users,
      (select count(*) from active_calls)::int active_calls,
      (select count(distinct "userId") from active_participants)::int people_in_calls,
      (select count(distinct "userId") from active_participants where mode = 'VOICE')::int people_in_voice_calls,
      (select count(distinct "userId") from active_participants where mode = 'VIDEO')::int people_in_video_calls
  `)).rows[0];
  const live = {
    activeCalls: Number(row.active_calls || 0),
    onlineUsers: Number(row.online_users || 0),
    peopleInCalls: Number(row.people_in_calls || 0),
    peopleInVideoCalls: Number(row.people_in_video_calls || 0),
    peopleInVoiceCalls: Number(row.people_in_voice_calls || 0),
  };
  livePeaks.activeCalls = Math.max(livePeaks.activeCalls, live.activeCalls);
  livePeaks.onlineUsers = Math.max(livePeaks.onlineUsers, live.onlineUsers);
  livePeaks.peopleInCalls = Math.max(livePeaks.peopleInCalls, live.peopleInCalls);
  livePeaks.peopleInVoiceCalls = Math.max(livePeaks.peopleInVoiceCalls, live.peopleInVoiceCalls);
  livePeaks.peopleInVideoCalls = Math.max(livePeaks.peopleInVideoCalls, live.peopleInVideoCalls);
  livePeaks.updatedAt = new Date().toISOString();
  return { ...live, peaks: livePeaks, updatedAt: livePeaks.updatedAt };
}

async function getActiveCalls() {
  return pool.query(`
    select c.id, c.mode, c."startedAt", c."endedAt", c."conversationId", c."livekitRoom", cv.title, cv.type,
      count(cp.id)::int participants,
      count(cp.id) filter (where cp."joinedAt" is not null and cp."leftAt" is null)::int joined_now,
      max(cp."leftAt") filter (where cp."joinedAt" is not null)::timestamp(3) last_left_at,
      string_agg(distinct nullif(u."displayName", ''), ', ' order by nullif(u."displayName", '')) filter (where u.id is not null)::text participant_names
    from "Call" c
    join "Conversation" cv on cv.id = c."conversationId"
    left join "CallParticipant" cp on cp."callId" = c.id
    left join "User" u on u.id = cp."userId"
    where c."endedAt" is null
      and exists (
      select 1
      from "CallParticipant" cp_active
      where cp_active."callId" = c.id
        and cp_active."joinedAt" is not null
        and cp_active."leftAt" is null
    )
    group by c.id, cv.id
    order by c."startedAt" desc
    limit 12
  `);
}

async function getLiveKitAdminSnapshot() {
  const configSnapshot = readLiveKitServerConfig();
  const [metricsByServerId, healthByServerId] = await Promise.all([
    getLiveKitServerMetrics(),
    getLiveKitServerHealthById(configSnapshot.servers),
  ]);
  const configuredIds = new Set(configSnapshot.servers.map((server) => server.id));
  const servers = configSnapshot.servers.map((server) => {
    const assignedMetrics = metricsByServerId.get(server.id) ?? createEmptyLiveKitMetrics();
    const health = healthByServerId.get(server.id) ?? createUnknownLiveKitHealth();

    return {
      ...server,
      ...assignedMetrics,
      configured: true,
      health,
    };
  });

  metricsByServerId.forEach((metrics, serverId) => {
    if (configuredIds.has(serverId)) {
      return;
    }

    servers.push({
      ...metrics,
      configured: false,
      enabled: false,
      id: serverId,
      health: createUnknownLiveKitHealth(),
      maxActiveCalls: null,
      url: '',
      weight: 1,
    });
  });

  return {
    ...configSnapshot,
    servers,
  };
}

function readLiveKitServerConfig() {
  const configPath = String(process.env.LIVEKIT_SERVERS_CONFIG_PATH || '').trim();

  if (configPath) {
    const resolvedPath = path.resolve(configPath);

    if (fs.existsSync(resolvedPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        const servers = normalizeLiveKitServerConfig(parsed);

        return {
          configPath: resolvedPath,
          error: '',
          source: 'Config file',
          servers,
        };
      } catch (error) {
        return {
          configPath: resolvedPath,
          error: `LiveKit config file error: ${error instanceof Error ? error.message : String(error)}`,
          source: 'Config file',
          servers: [],
        };
      }
    }
  }

  const fallbackUrl = firstNonEmptyEnv('LIVEKIT_URL', 'LIVEKIT_WS_URL', 'LIVEKIT_HOST');
  const fallbackApiKey = firstNonEmptyEnv('LIVEKIT_API_KEY', 'LIVEKIT_API', 'LIVEKIT_KEY');
  const fallbackApiSecret = firstNonEmptyEnv('LIVEKIT_API_SECRET', 'LIVEKIT_SECRET');

  if (!fallbackUrl || !fallbackApiKey || !fallbackApiSecret) {
    return {
      configPath: configPath ? path.resolve(configPath) : '',
      error: '',
      source: 'Missing LiveKit configuration',
      servers: [],
    };
  }

  return {
    configPath: configPath ? path.resolve(configPath) : '',
    error: '',
    source: 'Single-server env fallback',
    servers: [
      {
        enabled: true,
        id: 'default',
        maxActiveCalls: null,
        url: fallbackUrl,
        weight: 1,
      },
    ],
  };
}

function normalizeLiveKitServerConfig(parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error('LiveKit server config must be a JSON array.');
  }

  const seenIds = new Set();
  const servers = parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`LiveKit server at index ${index} must be an object.`);
    }

    const id = String(item.id || '').trim();
    const url = String(item.url || '').trim();

    if (!id) {
      throw new Error(`LiveKit server at index ${index} is missing id.`);
    }

    if (seenIds.has(id)) {
      throw new Error(`Duplicate LiveKit server id: ${id}`);
    }

    if (!url) {
      throw new Error(`LiveKit server ${id} is missing url.`);
    }

    seenIds.add(id);

    return {
      enabled: item.enabled !== false,
      id,
      maxActiveCalls: Number.isInteger(item.maxActiveCalls) && item.maxActiveCalls > 0 ? item.maxActiveCalls : null,
      url,
      weight: Number(item.weight) > 0 ? Number(item.weight) : 1,
    };
  });

  return servers;
}

async function getLiveKitServerHealthById(servers) {
  const entries = await Promise.all(servers.map(async (server) => [server.id, await probeLiveKitServerHealth(server)]));

  return new Map(entries);
}

async function probeLiveKitServerHealth(server) {
  if (!server.enabled) {
    return {
      checkedAt: new Date(),
      error: 'disabled',
      healthy: false,
      status: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(liveKitHttpUrl(server.url), {
      cache: 'no-store',
      method: 'GET',
      signal: controller.signal,
    });

    return {
      checkedAt: new Date(),
      error: response.status < 500 ? '' : `HTTP ${response.status}`,
      healthy: response.status < 500,
      status: response.status,
    };
  } catch (error) {
    return {
      checkedAt: new Date(),
      error: error instanceof Error ? error.message : String(error),
      healthy: false,
      status: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createUnknownLiveKitHealth() {
  return {
    checkedAt: null,
    error: '',
    healthy: null,
    status: null,
  };
}

function liveKitHttpUrl(liveKitUrl) {
  return String(liveKitUrl || '')
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://');
}

async function getLiveKitServerMetrics() {
  const rows = (await pool.query(`
    with active_calls as (
      select c.id, c.mode, c."livekitServerId"
      from "Call" c
      where c."endedAt" is null
        and exists (
          select 1
          from "CallParticipant" cp_active
          where cp_active."callId" = c.id
            and cp_active."joinedAt" is not null
            and cp_active."leftAt" is null
        )
    ),
    active_participants as (
      select ac.id, ac.mode, cp."userId"
      from active_calls ac
      join "CallParticipant" cp on cp."callId" = ac.id
      where cp."joinedAt" is not null
        and cp."leftAt" is null
    )
    select
      coalesce(ac."livekitServerId", '') server_id,
      count(distinct ac.id)::int active_calls,
      count(distinct ac.id) filter (where ac.mode = 'VOICE')::int voice_calls,
      count(distinct ac.id) filter (where ac.mode = 'VIDEO')::int video_calls,
      count(distinct ap."userId")::int active_participants,
      count(distinct ap."userId") filter (where ap.mode = 'VOICE')::int voice_participants,
      count(distinct ap."userId") filter (where ap.mode = 'VIDEO')::int video_participants
    from active_calls ac
    left join active_participants ap on ap.id = ac.id
    group by coalesce(ac."livekitServerId", '')
  `)).rows;
  const metrics = new Map();

  rows.forEach((row) => {
    metrics.set(row.server_id || '', {
      activeCalls: Number(row.active_calls || 0),
      activeParticipants: Number(row.active_participants || 0),
      videoCalls: Number(row.video_calls || 0),
      videoParticipants: Number(row.video_participants || 0),
      voiceCalls: Number(row.voice_calls || 0),
      voiceParticipants: Number(row.voice_participants || 0),
    });
  });

  return metrics;
}

function firstNonEmptyEnv(...keys) {
  return keys.map((key) => String(process.env[key] || '').trim()).find(Boolean) || '';
}

function createEmptyLiveKitMetrics() {
  return {
    activeCalls: 0,
    activeParticipants: 0,
    videoCalls: 0,
    videoParticipants: 0,
    voiceCalls: 0,
    voiceParticipants: 0,
  };
}

async function getMessageMix() {
  return pool.query(`
    select kind, count::bigint
    from (
      values
        ('TEXT', coalesce((select "textMessages" from "AnalyticsOverview" where id = 1),0)),
        ('IMAGE', coalesce((select "imageMessages" from "AnalyticsOverview" where id = 1),0)),
        ('VIDEO', coalesce((select "videoMessages" from "AnalyticsOverview" where id = 1),0)),
        ('FILE', coalesce((select "fileMessages" from "AnalyticsOverview" where id = 1),0)),
        ('VOICE', coalesce((select "voiceMessages" from "AnalyticsOverview" where id = 1),0)),
        ('CALL', coalesce((select "callMessages" from "AnalyticsOverview" where id = 1),0))
    ) as stats(kind, count)
    order by count desc
  `);
}

async function getGroupSummary() {
  return (await pool.query(`
    select
      (select count(*) from "Conversation" where type = 'GROUP')::int groups,
      (select count(*) from "Conversation" where type = 'GROUP' and "isPublic" = false)::int private_groups,
      (select count(*) from "Conversation" where type = 'GROUP' and "isPublic" = true)::int public_groups,
      (select count(*) from "ConversationMember" cm join "Conversation" c on c.id = cm."conversationId" where c.type = 'GROUP')::int members
  `)).rows[0];
}

async function getUndeliveredMessageStats(q = '') {
  const params = [];
  const filters = [];

  if (q) {
    params.push(`%${q}%`);
    filters.push(`(u.username ilike $${params.length} or u."displayName" ilike $${params.length})`);
  }

  const where = filters.length ? `where ${filters.join(' and ')}` : '';
  const sql = `
    with undelivered as (
      select
        cm."userId",
        count(*) filter (where c.type = 'DIRECT')::bigint private_undelivered,
        count(*) filter (where c.type = 'GROUP')::bigint group_undelivered
      from "ConversationMember" cm
      join "Conversation" c on c.id = cm."conversationId"
      join "Message" m on m."conversationId" = c.id
      left join "MessageReceipt" mr on mr."messageId" = m.id and mr."userId" = cm."userId"
      where m."senderId" <> cm."userId"
        and m."deletedAt" is null
        and m."createdAt" >= cm."joinedAt"
        and mr.id is null
        and (c.type <> 'GROUP' or cm."aliasPromptSeen" = true)
        and not exists (
          select 1
          from "MessageDeletion" md
          where md."messageId" = m.id
            and md."userId" = cm."userId"
        )
      group by cm."userId"
    ),
    filtered as (
      select
        u.id,
        u.username,
        u."displayName",
        u."lastSeenAt",
        coalesce(d.private_undelivered, 0)::bigint private_undelivered,
        coalesce(d.group_undelivered, 0)::bigint group_undelivered,
        (coalesce(d.private_undelivered, 0) + coalesce(d.group_undelivered, 0))::bigint total_undelivered
      from "User" u
      join undelivered d on d."userId" = u.id
      ${where}
    )
    select
      *,
      coalesce(sum(private_undelivered) over (), 0)::bigint private_total,
      coalesce(sum(group_undelivered) over (), 0)::bigint group_total,
      coalesce(sum(total_undelivered) over (), 0)::bigint total
    from filtered
    order by total_undelivered desc, "lastSeenAt" asc nulls first, "displayName" asc
  `;
  const rows = (await pool.query(sql, params)).rows;
  const first = rows[0] || {};

  return {
    rows,
    totals: {
      group: Number(first.group_total || 0),
      private: Number(first.private_total || 0),
      total: Number(first.total || 0),
    },
  };
}

async function getUsers({ adminBlocked = false, direction, q, sort }) {
  const params = [];
  const filters = [];

  if (q) {
    params.push(`%${q}%`);
    filters.push(`(u.username ilike $${params.length} or u."displayName" ilike $${params.length})`);
  }

  if (adminBlocked) {
    filters.push('abu."userId" is not null');
  }

  const where = filters.length ? `where ${filters.join(' and ')}` : '';
  const sql = `
    with call_stats as (
      select cp."userId",
        count(distinct c.id) filter (where c.mode = 'VOICE' and c."startedAt" >= date_trunc('day', now()))::int voice_today,
        count(distinct c.id) filter (where c.mode = 'VOICE' and c."startedAt" >= now() - interval '7 days')::int voice_7d,
        count(distinct c.id) filter (where c.mode = 'VOICE' and c."startedAt" >= now() - interval '15 days')::int voice_15d,
        count(distinct c.id) filter (where c.mode = 'VOICE' and c."startedAt" >= now() - interval '30 days')::int voice_30d,
        coalesce(sum(extract(epoch from (coalesce(c."endedAt", now()) - c."startedAt"))) filter (where c.mode = 'VOICE' and c."endedAt" is not null),0)::bigint voice_duration_sec,
        count(distinct c.id) filter (where c.mode = 'VIDEO' and c."startedAt" >= date_trunc('day', now()))::int video_today,
        count(distinct c.id) filter (where c.mode = 'VIDEO' and c."startedAt" >= now() - interval '7 days')::int video_7d,
        count(distinct c.id) filter (where c.mode = 'VIDEO' and c."startedAt" >= now() - interval '15 days')::int video_15d,
        count(distinct c.id) filter (where c.mode = 'VIDEO' and c."startedAt" >= now() - interval '30 days')::int video_30d,
        coalesce(sum(extract(epoch from (coalesce(c."endedAt", now()) - c."startedAt"))) filter (where c.mode = 'VIDEO' and c."endedAt" is not null),0)::bigint video_duration_sec
      from "CallParticipant" cp join "Call" c on c.id = cp."callId"
      group by cp."userId"
    ),
    sessions as (
      select distinct on ("userId") "userId", "createdAt" last_signin_at, "ipAddress" latest_ip, "userAgent" latest_user_agent
      from "Session"
      order by "userId", "createdAt" desc
    )
    select u.*,
      u."lastSeenAt" last_online_at,
      s.last_signin_at, s.latest_ip, s.latest_user_agent,
      coalesce(cn.count,0)::int contacts_count,
      coalesce(ums."totalMessages",0)::bigint total_messages,
      coalesce(ums."mediaBytes",0)::bigint media_bytes,
      coalesce(cs.voice_today,0)::int voice_today,
      coalesce(cs.voice_7d,0)::int voice_7d,
      coalesce(cs.voice_15d,0)::int voice_15d,
      coalesce(cs.voice_30d,0)::int voice_30d,
      coalesce(cs.voice_duration_sec,0)::bigint voice_duration_sec,
      coalesce(cs.video_today,0)::int video_today,
      coalesce(cs.video_7d,0)::int video_7d,
      coalesce(cs.video_15d,0)::int video_15d,
      coalesce(cs.video_30d,0)::int video_30d,
      coalesce(cs.video_duration_sec,0)::bigint video_duration_sec,
      abu."createdAt" blocked_at
    from "User" u
    left join (select "ownerId", count(*) from "Contact" group by "ownerId") cn on cn."ownerId" = u.id
    left join "UserMessageStats" ums on ums."userId" = u.id
    left join call_stats cs on cs."userId" = u.id
    left join sessions s on s."userId" = u.id
    left join "AdminBlockedUser" abu on abu."userId" = u.id
    ${where}
    order by ${SORTS[sort]} ${direction} nulls last
  `;
  return (await pool.query(sql, params)).rows;
}

async function getUser(id) {
  return (await pool.query(`select * from (${baseUserQuery()}) x where id = $1`, [id])).rows[0];
}

async function getUserByUsername(username) {
  return (await pool.query('select id, username, "displayName" from "User" where lower(username) = lower($1)', [username])).rows[0];
}

function baseUserQuery() {
  return `
    select u.*, u."lastSeenAt" last_online_at,
      s.last_signin_at, s.latest_ip, s.latest_user_agent,
      coalesce(nullif(u."registrationIpAddress", ''), fs.registration_ip) registration_ip,
      coalesce(nullif(u."registrationPlatform", ''), fs.registration_platform) registration_platform,
      coalesce(nullif(u."registrationLocale", ''), fs.registration_locale) registration_locale,
      coalesce(cn.count,0)::int contacts_count,
      coalesce(ums."totalMessages",0)::bigint total_messages,
      coalesce(ums."mediaBytes",0)::bigint media_bytes,
      coalesce(cs.voice_30d,0)::int voice_30d,
      coalesce(cs.voice_duration_sec,0)::bigint voice_duration_sec,
      coalesce(cs.video_30d,0)::int video_30d,
      coalesce(cs.video_duration_sec,0)::bigint video_duration_sec
    from "User" u
    left join (select distinct on ("userId") "userId", "createdAt" last_signin_at, "ipAddress" latest_ip, "userAgent" latest_user_agent from "Session" order by "userId", "createdAt" desc) s on s."userId" = u.id
    left join (select "ownerId", count(*) from "Contact" group by "ownerId") cn on cn."ownerId" = u.id
    left join "UserMessageStats" ums on ums."userId" = u.id
    left join (
      select cp."userId",
        count(distinct c.id) filter (where c.mode = 'VOICE' and c."startedAt" >= now() - interval '30 days')::int voice_30d,
        coalesce(sum(extract(epoch from (c."endedAt" - c."startedAt"))) filter (where c.mode = 'VOICE' and c."endedAt" is not null),0)::bigint voice_duration_sec,
        count(distinct c.id) filter (where c.mode = 'VIDEO' and c."startedAt" >= now() - interval '30 days')::int video_30d,
        coalesce(sum(extract(epoch from (c."endedAt" - c."startedAt"))) filter (where c.mode = 'VIDEO' and c."endedAt" is not null),0)::bigint video_duration_sec
      from "CallParticipant" cp join "Call" c on c.id = cp."callId" group by cp."userId"
    ) cs on cs."userId" = u.id
    left join (
      select distinct on ("userId")
        "userId",
        "ipAddress" registration_ip,
        platform registration_platform,
        locale registration_locale
      from "Session"
      order by "userId", "createdAt" asc
    ) fs on fs."userId" = u.id
  `;
}

function getUserMessageStats(id) {
  return pool.query(`
    select kind, count::bigint
    from (
      values
        ('TEXT', coalesce((select "textMessages" from "UserMessageStats" where "userId" = $1),0)),
        ('IMAGE', coalesce((select "imageMessages" from "UserMessageStats" where "userId" = $1),0)),
        ('VIDEO', coalesce((select "videoMessages" from "UserMessageStats" where "userId" = $1),0)),
        ('FILE', coalesce((select "fileMessages" from "UserMessageStats" where "userId" = $1),0)),
        ('VOICE', coalesce((select "voiceMessages" from "UserMessageStats" where "userId" = $1),0)),
        ('CALL', coalesce((select "callMessages" from "UserMessageStats" where "userId" = $1),0))
    ) as stats(kind, count)
    where count > 0
    order by kind
  `, [id]);
}

function getUserMediaStats(id) {
  return pool.query(`
    select kind, count::bigint, bytes::bigint
    from (
      values
        ('IMAGE', coalesce((select "imageMessages" from "UserMessageStats" where "userId" = $1),0), coalesce((select "imageBytes" from "UserMessageStats" where "userId" = $1),0)),
        ('VIDEO', coalesce((select "videoMessages" from "UserMessageStats" where "userId" = $1),0), coalesce((select "videoBytes" from "UserMessageStats" where "userId" = $1),0)),
        ('FILE', coalesce((select "fileMessages" from "UserMessageStats" where "userId" = $1),0), coalesce((select "fileBytes" from "UserMessageStats" where "userId" = $1),0)),
        ('VOICE', coalesce((select "voiceMessages" from "UserMessageStats" where "userId" = $1),0), coalesce((select "voiceBytes" from "UserMessageStats" where "userId" = $1),0))
    ) as stats(kind, count, bytes)
    where count > 0 or bytes > 0
    order by kind
  `, [id]);
}

function getUserGroups(id) {
  return pool.query(`
    select c.id, c.title, c."createdAt", cm."joinedAt", cm."isAdmin", cm."aliasName", cm."aliasPromptSeen", count(cm2.id)::int members
    from "ConversationMember" cm
    join "Conversation" c on c.id = cm."conversationId"
    left join "ConversationMember" cm2 on cm2."conversationId" = c.id
    where cm."userId" = $1 and c.type = 'GROUP'
    group by c.id, cm."joinedAt", cm."isAdmin", cm."aliasName", cm."aliasPromptSeen"
    order by cm."joinedAt" desc
  `, [id]);
}

function getUserContacts(id) {
  return pool.query(`
    select c.*, u.username, u."displayName", u."lastSeenAt"
    from "Contact" c
    join "User" u on u.id = c."contactId"
    where c."ownerId" = $1
    order by u."displayName"
  `, [id]);
}

function getUserSavedBy(id) {
  return pool.query(`
    select c.*, u.username, u."displayName", u."lastSeenAt"
    from "Contact" c
    join "User" u on u.id = c."ownerId"
    where c."contactId" = $1
    order by u."displayName"
  `, [id]);
}

function getUserSubscriptions(id) {
  return getSubscriptions({ userId: id, limit: 20 });
}

async function getManualSubscriptionBaseDate(userId) {
  const row = (await pool.query(`
    select max("expiresAt") as "expiresAt"
    from "SubscriptionEntitlement"
    where "userId" = $1 and status in ('ACTIVE','GRACE') and "expiresAt" > current_timestamp
  `, [userId])).rows[0];
  const activeExpiry = row?.expiresAt ? new Date(row.expiresAt) : null;
  const now = new Date();

  return activeExpiry && activeExpiry.getTime() > now.getTime() ? activeExpiry : now;
}

function calculateManualSubscriptionExpiry(baseDate, period) {
  const expiresAt = new Date(baseDate);

  if (period.years) {
    expiresAt.setFullYear(expiresAt.getFullYear() + period.years);
    return expiresAt;
  }

  return addCalendarMonths(expiresAt, period.months);
}

function addCalendarMonths(dateValue, months) {
  const result = new Date(dateValue);
  const originalDay = result.getDate();

  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(Math.min(originalDay, daysInMonth(result.getFullYear(), result.getMonth())));

  return result;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getUserCalls(id) {
  return pool.query(`
    select c.*, cv.title, cv.type,
      count(cp2.id)::int participants,
      cp.direction, cp."joinedAt", cp."leftAt"
    from "CallParticipant" cp
    join "Call" c on c.id = cp."callId"
    join "Conversation" cv on cv.id = c."conversationId"
    left join "CallParticipant" cp2 on cp2."callId" = c.id
    where cp."userId" = $1
    group by c.id, cv.id, cp.id
    order by c."startedAt" desc
    limit 30
  `, [id]);
}

async function getCalls({ mode = '', status = 'all' } = {}) {
  const params = [];
  const where = [];
  if (mode) {
    params.push(mode);
    where.push(`c.mode = $${params.length}`);
  }
  if (status === 'active') {
    where.push(`c."endedAt" is null`);
    where.push(`exists (
      select 1
      from "CallParticipant" cp_active
      where cp_active."callId" = c.id
        and cp_active."joinedAt" is not null
        and cp_active."leftAt" is null
    )`);
  }
  return (await pool.query(`
    select c.*, cv.title, cv.type,
      count(cp.id)::int participants,
      count(cp.id) filter (where cp."joinedAt" is not null and cp."leftAt" is null)::int joined_now,
      max(cp."leftAt") filter (where cp."joinedAt" is not null)::timestamp(3) last_left_at,
      string_agg(distinct nullif(u."displayName", ''), ', ' order by nullif(u."displayName", '')) filter (where u.id is not null)::text participant_names
    from "Call" c
    join "Conversation" cv on cv.id = c."conversationId"
    left join "CallParticipant" cp on cp."callId" = c.id
    left join "User" u on u.id = cp."userId"
    ${where.length ? `where ${where.join(' and ')}` : ''}
    group by c.id, cv.id
    order by c."startedAt" desc
    limit 300
  `, params)).rows;
}

function getCallParticipants(callId) {
  return pool.query(`
    select cp.*, u.username, u."displayName", u."lastSeenAt",
      coalesce(ums."totalMessages",0)::bigint total_messages,
      coalesce(ums."mediaBytes",0)::bigint media_bytes
    from "CallParticipant" cp
    join "User" u on u.id = cp."userId"
    left join "UserMessageStats" ums on ums."userId" = u.id
    where cp."callId" = $1
    order by cp."joinedAt" nulls last, u."displayName"
  `, [callId]);
}

async function getGroups(q = '') {
  const params = q ? [`%${q}%`] : [];
  return (await pool.query(`
    select c.*, ou.username owner_username, ou."displayName" owner_name,
      count(cm.id)::int members,
      count(cm.id) filter (where cm."aliasPromptSeen" = false and cm."userId" <> c."ownerId")::int pending_members,
      count(cm.id) filter (where cm."isAdmin" = true or cm."userId" = c."ownerId")::int admins
    from "Conversation" c
    left join "User" ou on ou.id = c."ownerId"
    left join "ConversationMember" cm on cm."conversationId" = c.id
    where c.type = 'GROUP'
      ${q ? 'and (c.title ilike $1 or ou.username ilike $1 or ou."displayName" ilike $1)' : ''}
    group by c.id, ou.id
    order by c."updatedAt" desc
    limit 300
  `, params)).rows;
}

async function getGroup(id) {
  return (await pool.query(`
    select c.*, ou.username owner_username, ou."displayName" owner_name,
      count(cm.id)::int members,
      count(cm.id) filter (where cm."aliasPromptSeen" = false and cm."userId" <> c."ownerId")::int pending_members,
      count(cm.id) filter (where cm."isAdmin" = true or cm."userId" = c."ownerId")::int admins,
      (select count(*) from "Message" where "conversationId" = c.id)::int messages,
      (select count(*) from "Call" where "conversationId" = c.id)::int calls
    from "Conversation" c
    left join "User" ou on ou.id = c."ownerId"
    left join "ConversationMember" cm on cm."conversationId" = c.id
    where c.id = $1 and c.type = 'GROUP'
    group by c.id, ou.id
  `, [id])).rows[0];
}

function getGroupMembers(id) {
  return pool.query(`
    select cm.*, u.username, u."displayName", u."lastSeenAt",
      coalesce(ums."totalMessages",0)::bigint total_messages
    from "ConversationMember" cm
    join "User" u on u.id = cm."userId"
    left join "UserMessageStats" ums on ums."userId" = u.id
    where cm."conversationId" = $1
    order by cm."isAdmin" desc, cm."joinedAt" asc
  `, [id]);
}

function getGroupCalls(id) {
  return pool.query(`
    select c.*, cv.title, cv.type, count(cp.id)::int participants
    from "Call" c
    join "Conversation" cv on cv.id = c."conversationId"
    left join "CallParticipant" cp on cp."callId" = c.id
    where c."conversationId" = $1
    group by c.id, cv.id
    order by c."startedAt" desc
    limit 20
  `, [id]);
}

function getGroupWebhooks(id) {
  return pool.query(`
    select
      gw.*,
      (select count(*) from "GroupWebhookDelivery" gwd where gwd."webhookId" = gw.id)::int deliveries,
      (select count(*) from "GroupWebhookDelivery" gwd where gwd."webhookId" = gw.id and gwd.status = 'ACCEPTED')::int accepted_deliveries
    from "GroupWebhook" gw
    where gw."conversationId" = $1
    order by gw."revokedAt" nulls first, gw."createdAt" desc
  `, [id]);
}

function getGroupWebhookDeliveries(id) {
  return pool.query(`
    select gwd.*, gw.name webhook_name, gw."tokenPrefix"
    from "GroupWebhookDelivery" gwd
    left join "GroupWebhook" gw on gw.id = gwd."webhookId"
    where gwd."conversationId" = $1
    order by gwd."createdAt" desc
    limit 20
  `, [id]);
}

function getAdminUsers() {
  return pool.query(`
    select id, username, permissions, "isActive", "createdBy", "createdAt", "updatedAt", "lastLoginAt"
    from "AdminUser"
    order by "createdAt" desc
  `);
}

function getPartnerUsers() {
  return pool.query(`
    select pu.*,
      coalesce(codes.codes_count, 0)::int as codes_count,
      coalesce(codes.used_count, 0)::int as used_count
    from "PartnerUser" pu
    left join (
      select "createdByPartnerId", count(*) as codes_count, coalesce(sum("usedCount"), 0) as used_count
      from "RedeemCode"
      where "createdByPartnerId" is not null
      group by "createdByPartnerId"
    ) codes on codes."createdByPartnerId" = pu.id
    order by pu."createdAt" desc
  `);
}

async function sendGroupDetailPage(req, res, flash = {}) {
  const group = await getGroup(req.params.id);

  if (!group) {
    res.status(404).send(page({ active: 'groups', body: empty('Group not found.'), title: 'Not found' }));
    return;
  }

  const [members, calls, reports, webhooks, webhookDeliveries] = await Promise.all([
    getGroupMembers(req.params.id),
    getGroupCalls(req.params.id),
    pool.query('select * from "Report" where "targetGroupId" = $1 order by "createdAt" desc limit 20', [req.params.id]),
    getGroupWebhooks(req.params.id),
    getGroupWebhookDeliveries(req.params.id),
  ]);

  res.send(page({
    active: 'groups',
    body: `
      ${hero(escapeHtml(group.title || translateText('Untitled group')), `${escapeHtml(group.owner_name || group.owner_username || translateText('No owner'))} · ${number(group.members)} ${translateText('members')}`, `<div class="actions"><a class="btn secondary" href="/groups">Back</a>${logout()}</div>`)}
      <section class="metric-grid">
        ${metric('Members', number(group.members), `${number(group.pending_members)} ${translateText('pending')}`)}
        ${metric('Admins', number(group.admins), 'Owner included')}
        ${metric('Messages', number(group.messages), 'Stored message rows')}
        ${metric('Calls', number(group.calls), 'Group call rows')}
      </section>
      <section class="detail-grid">
        ${panel('Group settings', canEdit('groups') ? groupSettingsForm(group) : settingsPills(group))}
        ${canEdit('groups') ? panel('Add user or admin', `
          <form class="stack" method="post" action="/groups/${escapeAttr(group.id)}/members">
            <label>${escapeHtml(translateText('Username'))} <input name="username" placeholder="${escapeAttr(translateText('Username'))}" required></label>
            <label>${escapeHtml(translateText('Role'))} ${select('role', 'member', ['member', 'admin'])}</label>
            <button>${escapeHtml(translateText('Add to group'))}</button>
          </form>
        `) : panel('Group editing', empty('Read-only access. Member and settings changes are disabled for this admin.'))}
      </section>
      ${panel('Webhooks', groupWebhooksPanel(group, webhooks.rows, webhookDeliveries.rows, flash))}
      ${panel('Members', memberManagementTable(members.rows, group))}
      <section class="detail-grid">
        ${panel('Recent calls', callTable(calls.rows))}
        ${panel('Reports', reportSmallTable(reports.rows))}
      </section>
    `,
    title: group.title || translateText('Group'),
  }));
}

async function getSubscriptions({ id = '', userId = '', platform = '', status = '', limit = 300 } = {}) {
  const params = [];
  const where = [];
  if (id) {
    params.push(id);
    where.push(`se.id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    where.push(`se."userId" = $${params.length}`);
  }
  if (platform) {
    params.push(platform);
    where.push(`se.platform = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`se.status = $${params.length}`);
  }
  params.push(limit);
  return pool.query(`
    select se.*, u.username, u."displayName"
    from "SubscriptionEntitlement" se
    join "User" u on u.id = se."userId"
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by se."updatedAt" desc
    limit $${params.length}
  `, params);
}

async function getRedeemCodes() {
  return (await pool.query(`
    select rc.*,
      coalesce(uses."actualUses", 0)::int as "actualUses",
      pu."displayName" as "partnerDisplayName"
    from "RedeemCode" rc
    left join "PartnerUser" pu on pu.id = rc."createdByPartnerId"
    left join (
      select "redeemCodeId", count(*) as "actualUses"
      from "RedeemCodeUse"
      group by "redeemCodeId"
    ) uses on uses."redeemCodeId" = rc.id
    order by rc."createdAt" desc
    limit 300
  `)).rows;
}

async function getRedeemCode(id) {
  return (await pool.query(`
    select rc.*, pu."displayName" as "partnerDisplayName"
    from "RedeemCode" rc
    left join "PartnerUser" pu on pu.id = rc."createdByPartnerId"
    where rc.id = $1
    limit 1
  `, [id])).rows[0] || null;
}

async function getRedeemCodeUses(redeemCodeId) {
  return (await pool.query(`
    select rcu.*, u.username, u."displayName", se."productId", se."expiresAt", se.status
    from "RedeemCodeUse" rcu
    join "User" u on u.id = rcu."userId"
    left join "SubscriptionEntitlement" se on se.id = rcu."entitlementId"
    where rcu."redeemCodeId" = $1
    order by rcu."usedAt" desc
    limit 300
  `, [redeemCodeId])).rows;
}

async function getReports(type, status = '') {
  const params = [];
  const where = [];
  if (type) {
    params.push(type);
    where.push(`r."targetType" = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`r."status" = $${params.length}`);
  }
  return (await pool.query(`
    select r.*, ru.username reporter_username, ru."displayName" reporter_name,
      tu.username target_username, tu."displayName" target_user_name,
      coalesce(tu."displayName" || ' (@' || tu.username || ')', tm.body, tg.title, r."targetReferenceId") target_label
    from "Report" r
    join "User" ru on ru.id = r."reporterId"
    left join "User" tu on tu.id = r."targetUserId"
    left join "Message" tm on tm.id = r."targetMessageId"
    left join "Conversation" tg on tg.id = r."targetGroupId"
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by r."createdAt" desc
    limit 300
  `, params)).rows;
}

async function getSupportTickets() {
  return (await pool.query(`
    with support_user as (
      select id
      from "User"
      where lower(username) = 'meetvap'
      limit 1
    )
    select
      c.id as "conversationId",
      c."lastMessageAt",
      c."updatedAt",
      c."lastMessageBody",
      c."lastMessageKind",
      su.id as "supportUserId",
      u.id as "userId",
      u.username,
      u."displayName",
      last_admin."lastAdminReplyAt",
      last_admin."lastAdminUsername",
      count(m.id) filter (
        where m."senderId" = u.id
          and m."deletedAt" is null
          and (sm."lastReadAt" is null or m."createdAt" > sm."lastReadAt")
      )::int as unread_count
    from support_user su
    join "ConversationMember" sm on sm."userId" = su.id
    join "Conversation" c on c.id = sm."conversationId" and c.type = 'DIRECT'
    join "ConversationMember" um on um."conversationId" = c.id and um."userId" <> su.id
    join "User" u on u.id = um."userId"
    left join "Message" m on m."conversationId" = c.id
    left join lateral (
      select
        m2."createdAt" as "lastAdminReplyAt",
        coalesce(stra."adminUsername", m2.metadata->>'adminUsername') as "lastAdminUsername"
      from "Message" m2
      left join "SupportTicketReplyAdmin" stra on stra."messageId" = m2.id
      where m2."conversationId" = c.id
        and m2."senderId" = su.id
        and m2."deletedAt" is null
      order by m2."createdAt" desc
      limit 1
    ) last_admin on true
    where exists (
      select 1
      from "Message" message_exists
      where message_exists."conversationId" = c.id
        and message_exists."deletedAt" is null
    )
    group by c.id, su.id, u.id, sm."lastReadAt", last_admin."lastAdminReplyAt", last_admin."lastAdminUsername"
    order by unread_count desc, coalesce(c."lastMessageAt", c."updatedAt") desc
    limit 300
  `)).rows;
}

async function getSupportTicket(conversationId) {
  return (await pool.query(`
    with support_user as (
      select id
      from "User"
      where lower(username) = 'meetvap'
      limit 1
    )
    select
      c.id as "conversationId",
      c."lastMessageAt",
      c."updatedAt",
      c."lastMessageBody",
      c."lastMessageKind",
      su.id as "supportUserId",
      u.id as "userId",
      u.username,
      u."displayName",
      last_admin."lastAdminReplyAt",
      last_admin."lastAdminUsername",
      count(m.id) filter (
        where m."senderId" = u.id
          and m."deletedAt" is null
          and (sm."lastReadAt" is null or m."createdAt" > sm."lastReadAt")
      )::int as unread_count
    from support_user su
    join "ConversationMember" sm on sm."userId" = su.id
    join "Conversation" c on c.id = sm."conversationId" and c.type = 'DIRECT'
    join "ConversationMember" um on um."conversationId" = c.id and um."userId" <> su.id
    join "User" u on u.id = um."userId"
    left join "Message" m on m."conversationId" = c.id
    left join lateral (
      select
        m2."createdAt" as "lastAdminReplyAt",
        coalesce(stra."adminUsername", m2.metadata->>'adminUsername') as "lastAdminUsername"
      from "Message" m2
      left join "SupportTicketReplyAdmin" stra on stra."messageId" = m2.id
      where m2."conversationId" = c.id
        and m2."senderId" = su.id
        and m2."deletedAt" is null
      order by m2."createdAt" desc
      limit 1
    ) last_admin on true
    where c.id = $1
    group by c.id, su.id, u.id, sm."lastReadAt", last_admin."lastAdminReplyAt", last_admin."lastAdminUsername"
    limit 1
  `, [conversationId])).rows[0] || null;
}

async function getSupportTicketMessages(conversationId) {
  return (await pool.query(`
    select
      m.id,
      coalesce(
        nullif(m.metadata->>'adminBody', ''),
        nullif(m.metadata->>'body', ''),
        nullif(
          case
            when (
              stra."messageId" is not null or m.metadata->>'source' = 'support_admin'
            ) and upper(btrim(m.body)) = m.kind::text then ''
            else m.body
          end,
          ''
        ),
        case
          when latest_message.id = m.id then nullif(c."lastMessageBody", '')
          else null
        end,
        ''
      ) as body,
      m.kind,
      m."createdAt",
      m."senderId",
      m.metadata,
      coalesce(stra."adminUsername", m.metadata->>'adminUsername') as "adminUsername",
      u.username,
      u."displayName",
      mf.id as "mediaId",
      mf."originalName",
      mf."mimeType",
      mf."sizeBytes",
      mf."durationSec"
    from "Message" m
    join "Conversation" c on c.id = m."conversationId"
    join "User" u on u.id = m."senderId"
    left join "MediaFile" mf on mf.id = m."mediaId"
    left join "SupportTicketReplyAdmin" stra on stra."messageId" = m.id
    left join lateral (
      select lm.id
      from "Message" lm
      where lm."conversationId" = m."conversationId"
        and lm."deletedAt" is null
      order by lm."createdAt" desc, lm.id desc
      limit 1
    ) latest_message on true
    where m."conversationId" = $1
      and m."deletedAt" is null
    order by m."createdAt" asc
    limit 1000
  `, [conversationId])).rows;
}

async function markSupportTicketRead(conversationId, supportUserId) {
  await pool.query(`
    update "ConversationMember"
    set "lastReadAt" = current_timestamp
    where "conversationId" = $1 and "userId" = $2
  `, [conversationId, supportUserId]);
}

function layout({ bare = false, body, live = false, title }) {
  const lang = getCurrentLanguage();
  const html = `<!doctype html><html lang="${escapeAttr(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(translateText(title))} · MeetVap Admin</title><link rel="stylesheet" href="/static/styles.css"><link rel="icon" href="/static/favicon.ico" sizes="any"><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="icon" href="/static/favicon-96x96.png" type="image/png" sizes="96x96"><link rel="apple-touch-icon" href="/static/apple-touch-icon.png" sizes="180x180"><link rel="manifest" href="/static/site.webmanifest"></head><body>${body}${live ? liveScript() : ''}</body></html>`;
  return translateHtml(html);
}

function page({ active, body, live = false, title }) {
  const admin = getCurrentAdmin();
  const nav = [
    ['dashboard', '/', 'Dashboard'],
    ['users', '/users', 'Users'],
    ['undelivered', '/undelivered-messages', 'Undelivered'],
    ['calls', '/calls?status=active', 'Calls'],
    ['livekit', '/livekit', 'LiveKit'],
    ['groups', '/groups', 'Groups'],
    ['subscriptions', '/subscriptions', 'Subscriptions'],
    ['redeem-codes', '/redeem-codes', 'Redeem codes'],
    ['partners', '/partners', 'Partners'],
    ['reports', '/reports', 'Reports'],
    ['support', '/support-tickets', 'Support tickets'],
    ['operations', '/operations', 'Operations'],
    ...(admin?.isSuperAdmin ? [['admins', '/admins', 'Admins']] : []),
  ].filter(([id]) => (
    id === 'dashboard' ||
    id === 'admins' ||
    (id === 'redeem-codes' ? hasAdminPermission(admin, 'subscriptions', 'read') : false) ||
    (id === 'livekit' ? hasAdminPermission(admin, 'calls', 'read') : false) ||
    (id === 'undelivered' ? hasAdminPermission(admin, 'users', 'read') : hasAdminPermission(admin, id, 'read'))
  ));
  const navHtml = nav.map(([id, href, label]) => `<a class="${active === id ? 'active' : ''}" href="${href}">${label}</a>`).join('');
  return layout({
    live,
    title,
    body: `
      <header class="mobile-topbar">
        <a class="mobile-brand" href="/"><img alt="MeetVap" class="brand-logo" src="/static/adaptive-icon.png"><strong>${escapeHtml(translateText(title))}</strong></a>
        <details class="mobile-menu">
          <summary aria-label="${escapeAttr(translateText('Open admin'))}"><span></span><span></span><span></span></summary>
          <div class="mobile-menu-sheet">
            <div class="mobile-menu-head">
              <a class="brand" href="/"><img alt="MeetVap" class="brand-logo" src="/static/adaptive-icon.png"><strong>MeetVap Admin</strong></a>
            </div>
            ${languageSelector('sidebar')}
            <nav class="nav mobile-nav">${navHtml}</nav>
            <div class="mobile-menu-actions">${logout()}</div>
          </div>
        </details>
      </header>
      <div class="shell">
        <aside class="sidebar">
          <a class="brand" href="/"><img alt="MeetVap" class="brand-logo" src="/static/adaptive-icon.png"><strong>MeetVap Admin</strong></a>
          ${languageSelector('sidebar')}
          <nav class="nav">${navHtml}</nav>
        </aside>
        <main class="content">${body}</main>
      </div>
    `,
  });
}

function hero(title, subtitle, action = '') {
  return `<div class="hero"><div><h1>${translateText(title)}</h1><p>${translateText(subtitle)}</p></div><div class="hero-actions">${action}</div></div>`;
}

function panel(title, body, options = {}) {
  const id = options.id ? ` id="${escapeAttr(options.id)}"` : '';
  return `<section${id} class="panel"><div class="panel-head"><h2>${escapeHtml(translateText(title))}</h2>${options.action || ''}</div>${body}</section>`;
}

function modalPanelButton(id, title, body, meta = '', action = '', variant = '') {
  const modalId = `user-detail-modal-${id}`;
  const variantClass = variant ? ` modal-card-button--${escapeAttr(variant)}` : '';

  return `<article class="modal-card-button${variantClass}" id="${escapeAttr(id)}">
    <button class="modal-card-trigger" type="button" onclick="document.getElementById('${escapeAttr(modalId)}')?.showModal()">
      <span>${escapeHtml(title)}</span>
      ${meta ? `<strong>${escapeHtml(String(meta))}</strong>` : ''}
    </button>
    <dialog class="admin-modal admin-modal-wide" id="${escapeAttr(modalId)}">
      <section class="admin-modal-card">
        <div class="admin-modal-head">
          <h3>${escapeHtml(title)}</h3>
          <div class="actions">
            ${action || ''}
            <button class="secondary small modal-close" type="button" aria-label="${escapeAttr(translateText('Close'))}" onclick="this.closest('dialog').close()">×</button>
          </div>
        </div>
        <div class="admin-modal-body">
          ${body}
        </div>
      </section>
    </dialog>
  </article>`;
}

function tabbedModalContent(id, tabs) {
  return `<div class="admin-tabs">
    <div class="admin-tab-list">
      ${tabs.map((tab, index) => {
        const tabId = `${id}-tab-${index}`;
        return `<label class="admin-tab-label ${index === 0 ? 'active' : ''}" for="${escapeAttr(tabId)}" onclick="this.parentElement.querySelectorAll('.admin-tab-label').forEach((item)=>item.classList.remove('active'));this.classList.add('active')">${escapeHtml(tab.label)}</label>`;
      }).join('')}
    </div>
    ${tabs.map((tab, index) => {
      const tabId = `${id}-tab-${index}`;
      return `<input class="admin-tab-input" id="${escapeAttr(tabId)}" name="${escapeAttr(id)}-tabs" type="radio" ${index === 0 ? 'checked' : ''}>
        <div class="admin-tab-panel">${tab.body}</div>`;
    }).join('')}
  </div>`;
}

function countTitle(title, count) {
  return `${translateText(title)} (${number(count)})`;
}

function metric(label, value, note = '') {
  return `<div class="metric-card"><div class="metric-label">${escapeHtml(translateText(label))}</div><div class="metric-value">${value}</div>${note ? `<div class="metric-note">${translateText(note)}</div>` : ''}</div>`;
}

function policyRows(rows) {
  return `<div class="info-list">${rows.map(([label, value]) => `<div class="info-row"><span>${escapeHtml(translateText(label))}</span><strong>${escapeHtml(translateText(value))}</strong></div>`).join('')}</div>`;
}

function liveMetric(label, value, note, key) {
  return `<div class="metric-card live-card"><div class="metric-label">${escapeHtml(translateText(label))}</div><div class="metric-value" data-live-key="${key}">${number(value)}</div><div class="metric-note">${escapeHtml(translateText(note))}</div></div>`;
}

function metricCombo(items, options = {}) {
  const classes = ['metric-card', 'metric-combo'];
  if (options.live) classes.push('live-card');
  return `<div class="${classes.join(' ')}">${items.map((item) => `
    <div class="metric-combo-item">
      <div class="metric-label">${escapeHtml(translateText(item.label))}</div>
      <div class="metric-value"${item.key ? ` data-live-key="${escapeAttr(item.key)}"` : ''}>${item.value}</div>
      ${item.note ? `<div class="metric-note">${escapeHtml(translateText(item.note))}</div>` : ''}
    </div>
  `).join('')}</div>`;
}

function metricTriplet(items, options = {}) {
  const classes = ['metric-card', 'metric-triplet'];
  if (options.live) classes.push('live-card');
  return `<div class="${classes.join(' ')}">
    <div class="metric-triplet-labels">${items.map((item) => `<span>${escapeHtml(translateText(item.label))}</span>`).join('')}</div>
    <div class="metric-triplet-values">${items.map((item) => `<strong${item.key ? ` data-live-key="${escapeAttr(item.key)}"` : ''}>${item.value}</strong>`).join('')}</div>
  </div>`;
}

function logout() {
  return `<form method="post" action="/logout"><button class="secondary">${escapeHtml(translateText('Logout'))}</button></form>`;
}

function userRow(u) {
  const statusPill = u.blocked_at
    ? `<span class="pill danger">${escapeHtml(translateText('Blocked'))}</span>`
    : `<span class="pill good">${escapeHtml(translateText('Active'))}</span>`;

  return `<tr>
    <td data-label="${escapeAttr(translateText('User'))}">${userLink(u.id, u.displayName, u.username)}<div class="users-inline-status">${statusPill}</div></td>
    <td data-label="${escapeAttr(translateText('Registered'))}">${date(u.createdAt)}</td>
    <td data-label="${escapeAttr(translateText('Last online'))}">${date(u.last_online_at)}</td>
    <td data-label="${escapeAttr(translateText('Last sign-in'))}">${date(u.last_signin_at)}</td>
    <td class="mobile-only users-stat-line" data-label="${escapeAttr(translateText('Activity'))}">${compactPairStats([
      ['Contacts', number(u.contacts_count)],
      ['Messages', number(u.total_messages)],
    ])}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Contacts'))}">${number(u.contacts_count)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Messages'))}">${number(u.total_messages)}</td>
    <td class="mobile-only users-stat-line" data-label="${escapeAttr(translateText('Voice'))}">${compactPeriodStats(u, 'voice')}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Voice today'))}">${number(u.voice_today)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Voice 7d'))}">${number(u.voice_7d)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Voice 15d'))}">${number(u.voice_15d)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Voice 30d'))}">${number(u.voice_30d)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Voice duration'))}">${duration(u.voice_duration_sec)}</td>
    <td class="mobile-only users-stat-line" data-label="${escapeAttr(translateText('Video'))}">${compactPeriodStats(u, 'video')}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Video today'))}">${number(u.video_today)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Video 7d'))}">${number(u.video_7d)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Video 15d'))}">${number(u.video_15d)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Video 30d'))}">${number(u.video_30d)}</td>
    <td class="users-desktop-cell" data-label="${escapeAttr(translateText('Video duration'))}">${duration(u.video_duration_sec)}</td>
    <td class="mobile-only users-stat-line" data-label="${escapeAttr(translateText('Duration'))}">${compactPairStats([
      ['Voice', duration(u.voice_duration_sec)],
      ['Video', duration(u.video_duration_sec)],
    ])}</td>
  </tr>`;
}

function compactPairStats(items) {
  return items
    .map(([label, value]) => compactStatPart(label, value))
    .join(', ');
}

function compactPeriodStats(row, prefix) {
  return [
    compactStatPart('1d', number(row[`${prefix}_today`])),
    compactStatPart('7d', number(row[`${prefix}_7d`])),
    compactStatPart('15d', number(row[`${prefix}_15d`])),
    compactStatPart('30d', number(row[`${prefix}_30d`])),
  ].join(', ');
}

function compactStatPart(label, value) {
  return `<span class="users-stat-part"><strong>${escapeHtml(translateText(label))}</strong> <span>(${escapeHtml(String(value))})</span></span>`;
}

function undeliveredMessageTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr>${['User', 'Private', 'Groups', 'Total undelivered', 'Last online'].map((h) => `<th>${escapeHtml(translateText(h))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td>${userLink(row.id, row.displayName, row.username)}</td>
      <td>${number(row.private_undelivered)}</td>
      <td>${number(row.group_undelivered)}</td>
      <td><strong>${number(row.total_undelivered)}</strong></td>
      <td>${date(row.lastSeenAt)}</td>
    </tr>`).join('')}</tbody>
  </table></div>` : empty('No data.');
}

function supportTicketTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr>${['Display name', 'New', 'Last message datetime', 'Admin'].map((h) => `<th>${escapeHtml(translateText(h))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => {
      const unreadCount = Number(row.unread_count || 0);
      const detailsUrl = `/support-tickets/${encodeURIComponent(row.conversationId)}`;
      return `<tr class="support-ticket-row ${unreadCount > 0 ? 'support-row-unread' : ''}" onclick="window.location.href='${escapeAttr(detailsUrl)}'">
        <td><a class="entity-link" href="${escapeAttr(detailsUrl)}"><strong>${escapeHtml(row.displayName || row.username || row.userId)}</strong><span>@${escapeHtml(row.username || row.userId)}</span></a></td>
        <td>${unreadCount > 0 ? `<span class="pill warn support-unread-badge">${number(unreadCount)}</span>` : `<span class="subtle">${escapeHtml(translateText('None'))}</span>`}</td>
        <td>${date(row.lastMessageAt || row.updatedAt)}</td>
        <td>${supportAdminStatus(row)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>` : empty('No support tickets yet.');
}

function supportTicketTabs(activeTab, counts) {
  const tabs = [
    ['new', '/support-tickets', 'New messages', counts.new],
    ['archive', '/support-tickets?tab=archive', 'Archive', counts.archive],
  ];

  return `<div class="support-tabs">
    ${tabs.map(([id, href, label, count]) => `<a class="${activeTab === id ? 'active' : ''}" href="${href}">
      ${escapeHtml(translateText(label))}
      <span>${number(count)}</span>
    </a>`).join('')}
  </div>`;
}

function supportAdminStatus(ticket) {
  if (ticket.lastAdminReplyAt) {
    const adminLabel = ticket.lastAdminUsername
      ? `${translateText('Admin')}: ${ticket.lastAdminUsername}`
      : translateText('Admin');

    return `<span class="pill good">${escapeHtml(translateText('Answered'))}</span><br><span class="subtle">${escapeHtml(adminLabel)} · ${date(ticket.lastAdminReplyAt)}</span>`;
  }

  return `<span class="pill warn">${escapeHtml(translateText('Waiting'))}</span>`;
}

function supportReplyForm(conversationId) {
  return `<form class="stack support-reply-form" method="post" action="/support-tickets/${escapeAttr(conversationId)}/messages">
    <label>${escapeHtml(translateText('Message'))}
      <textarea name="body" rows="4" required></textarea>
    </label>
    <button>${escapeHtml(translateText('Send'))}</button>
  </form>`;
}

function supportConversation(messages, supportUserId) {
  return messages.length ? `<div class="support-chat">
    ${messages.map((message) => supportMessageBubble(message, supportUserId)).join('')}
  </div>` : empty('No messages yet.');
}

function supportMessageBubble(message, supportUserId) {
  const isAdmin = message.senderId === supportUserId;
  const classes = ['support-message', isAdmin ? 'support-message-admin' : 'support-message-user'];
  const adminSuffix = message.adminUsername ? ` · ${translateText('Admin')}: ${message.adminUsername}` : '';
  const sender = isAdmin ? `MeetVap${adminSuffix}` : `${message.displayName || message.username} (@${message.username})`;

  return `<article class="${classes.join(' ')}">
    <div class="support-message-meta">
      <strong>${escapeHtml(sender)}</strong>
      <span>${date(message.createdAt)}</span>
    </div>
    ${supportMessageBody(message)}
  </article>`;
}

function supportMessageBody(message) {
  const text = getSupportMessageText(message);
  const body = text ? `<div class="support-message-text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>` : '';
  const media = supportMessageMedia(message);

  if (!body && !media) {
    return `<div class="support-message-text subtle">${escapeHtml(translateText(message.kind || 'Message'))}</div>`;
  }

  return `${body}${media}`;
}

function getSupportMessageText(message) {
  const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata
    : {};
  const metadataText = String(metadata.adminBody || metadata.body || '').trim();
  const rawBody = String(message.body || '').trim();
  const isKindLabelBody = rawBody && rawBody.toUpperCase() === String(message.kind || '').toUpperCase();

  if (metadataText) {
    return metadataText;
  }

  return isKindLabelBody ? '' : rawBody;
}

function supportMessageMedia(message) {
  if (!message.mediaId) {
    return '';
  }

  const url = getBackendMediaUrl(message.mediaId);
  const name = message.originalName || message.mediaId;
  const mimeType = String(message.mimeType || '');

  if (mimeType.startsWith('image/')) {
    return `<a class="support-media-link" href="${escapeAttr(url)}" target="_blank" rel="noopener"><img alt="${escapeAttr(name)}" class="support-media-image" src="${escapeAttr(url)}"></a>`;
  }

  if (mimeType.startsWith('video/')) {
    return `<video class="support-media-video" controls preload="metadata" src="${escapeAttr(url)}"></video>`;
  }

  return `<a class="support-file" href="${escapeAttr(url)}" target="_blank" rel="noopener">
    <strong>${escapeHtml(name)}</strong>
    <span>${escapeHtml(mimeType || translateText('File'))} · ${bytes(message.sizeBytes)}</span>
  </a>`;
}

function callRow(c) {
  return callRowWithOptions(c);
}

function callRowWithOptions(c, options = {}) {
  const title = callPrimaryLabel(c);
  const effectiveEndedAt = getEffectiveCallEndedAt(c);
  const showIds = options.showIds !== false;
  return `<tr>
    <td data-label="${escapeAttr(translateText('Call'))}"><a href="/calls/${encodeURIComponent(c.id)}"><strong>${escapeHtml(title)}</strong></a>${showIds ? `<br><span class="subtle">${escapeHtml(c.id)}</span>` : ''}</td>
    <td data-label="${escapeAttr(translateText('Conversation'))}">${showIds ? conversationLink(c.conversationId, callConversationLabel(c)) : escapeHtml(callConversationLabel(c))}</td>
    <td data-label="${escapeAttr(translateText('Mode'))}"><span class="pill ${c.mode === 'VIDEO' ? 'video' : 'voice'}">${escapeHtml(displayCallMode(c.mode))}</span></td>
    <td data-label="${escapeAttr(translateText('Started'))}">${date(c.startedAt)}</td>
    <td data-label="${escapeAttr(translateText('Ended'))}">${date(effectiveEndedAt)}</td>
    <td data-label="${escapeAttr(translateText('Participants'))}">${number(c.joined_now ?? c.participants)} / ${number(c.participants)}</td>
    <td data-label="${escapeAttr(translateText('Actions'))}"><a class="btn secondary" href="/calls/${encodeURIComponent(c.id)}">Details</a></td>
  </tr>`;
}

function groupRow(g) {
  return `<tr>
    <td><a href="/groups/${encodeURIComponent(g.id)}"><strong>${escapeHtml(g.title || translateText('Untitled group'))}</strong><br><span class="subtle">${escapeHtml(g.id)}</span></a></td>
    <td>${g.ownerId ? userLink(g.ownerId, g.owner_name, g.owner_username) : `<span class="subtle">${escapeHtml(translateText('No owner'))}</span>`}</td>
    <td>${number(g.members)}${g.pending_members > 0 ? ` <span class="pill warn">${number(g.pending_members)} ${translateText('pending')}</span>` : ''}</td>
    <td>${number(g.admins)}</td>
    <td>${settingsPills(g)}</td>
    <td>${date(g.lastMessageAt || g.updatedAt)}</td>
    <td><a class="btn secondary" href="/groups/${encodeURIComponent(g.id)}">${escapeHtml(translateText('Manage'))}</a></td>
  </tr>`;
}

function subscriptionRow(s) {
  return `<tr>
    <td data-label="${escapeAttr(translateText('Account'))}">${userLink(s.userId, s.displayName, s.username)}<br><span class="subtle">${escapeHtml(s.userId)}</span></td>
    <td data-label="${escapeAttr(translateText('Platform'))}">${subscriptionPlatformPill(s)}</td>
    <td data-label="${escapeAttr(translateText('Status'))}"><span class="pill ${subscriptionStatusClass(s.status)}">${escapeHtml(displaySubscriptionStatus(s.status))}</span></td>
    <td data-label="${escapeAttr(translateText('Product'))}">${escapeHtml(s.productId)}</td>
    <td data-label="${escapeAttr(translateText('Expires'))}">${date(s.expiresAt)}${isExpired(s.expiresAt) ? ` <span class="pill danger">${escapeHtml(translateText('Expired'))}</span>` : ''}</td>
    <td data-label="${escapeAttr(translateText('Renew'))}">${escapeHtml(translateText(s.willRenew ? 'Yes' : 'No'))}</td>
    <td data-label="${escapeAttr(translateText('Environment'))}">${escapeHtml(s.environment)}</td>
    <td data-label="${escapeAttr(translateText('Provider ID'))}">${subscriptionProviderIdentifier(s)}</td>
    <td data-label="${escapeAttr(translateText('Verified'))}">${date(s.lastVerifiedAt)}</td>
    <td data-label="${escapeAttr(translateText('Actions'))}"><a class="btn secondary" href="/subscriptions/${encodeURIComponent(s.id)}">Details</a></td>
  </tr>`;
}

function detailList(items) {
  return `<div class="info-list">${items.map(([k, v]) => `<div class="info-row"><span>${escapeHtml(translateText(k))}</span><strong>${typeof v === 'string' && !v.includes('<') ? escapeHtml(translateText(v)) : v}</strong></div>`).join('')}</div>`;
}

function statTable(rows, keys) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((r) => `<tr>${keys.map((k) => {
    const value = String(r[k] ?? '');
    return `<td data-label="${escapeAttr(translateText(k))}">${escapeHtml(translateText(value))}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>` : empty('No data.');
}

function groupTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((g) => `<tr><td data-label="${escapeAttr(translateText('Group'))}">${conversationLink(g.id, g.title || translateText('Untitled group'))}<br><span class="subtle">${translateText(g.isAdmin ? 'Admin' : 'Member')}${g.aliasPromptSeen === false ? ` · ${translateText('pending')}` : ''}</span></td><td data-label="${escapeAttr(translateText('Datetime'))}">${date(g.createdAt || g.joinedAt)}</td><td data-label="${escapeAttr(translateText('Members'))}">${g.members ? `${number(g.members)} ${translateText('members')}` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No groups.');
}

function contactTable(rows, ownerId) {
  const editable = canEdit('users');
  return `<div id="contacts">${rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((c) => `<tr><td data-label="${escapeAttr(translateText('User'))}">${userLink(c.contactId, c.displayName, c.username)}</td><td data-label="${escapeAttr(translateText('Created at'))}">${date(c.createdAt)}</td><td data-label="${escapeAttr(translateText('Actions'))}">${editable ? `<form method="post" action="/users/${escapeAttr(ownerId)}/contacts/${escapeAttr(c.contactId)}/delete" onsubmit="return confirm('${escapeAttr(translateText('Remove contact?'))}')"><button class="danger small">${escapeHtml(translateText('Remove'))}</button></form>` : `<span class="subtle">${escapeHtml(translateText('Read-only'))}</span>`}</td></tr>`).join('')}</tbody></table></div>` : empty('No contacts saved by this user.')}</div>`;
}

function contactReadonlyTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((c) => `<tr><td data-label="${escapeAttr(translateText('User'))}">${userLink(c.ownerId, c.displayName, c.username)}</td><td data-label="${escapeAttr(translateText('Created at'))}">${date(c.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : empty('No users saved this account.');
}

function subscriptionTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr><th>${escapeHtml(translateText('Account'))}</th><th>${escapeHtml(translateText('Platform'))}</th><th>${escapeHtml(translateText('Status'))}</th><th>${escapeHtml(translateText('Product'))}</th><th>${escapeHtml(translateText('Expires'))}</th><th>${escapeHtml(translateText('Renew'))}</th><th>${escapeHtml(translateText('Environment'))}</th><th>${escapeHtml(translateText('Provider ID'))}</th><th>${escapeHtml(translateText('Verified'))}</th><th></th></tr></thead>
    <tbody>${rows.map(subscriptionRow).join('')}</tbody>
  </table></div>` : empty('No subscriptions.');
}

function manualPaymentAction(userId) {
  if (!canManageManualPayments()) {
    return '';
  }

  return `<button type="button" class="secondary" onclick="document.getElementById('manual-payment-modal-${escapeAttr(userId)}').showModal()">${escapeHtml(translateText('Manual Payment'))}</button>`;
}

function manualPaymentModal(userId) {
  if (!canManageManualPayments()) {
    return '';
  }

  return `<dialog class="admin-modal" id="manual-payment-modal-${escapeAttr(userId)}">
    <form class="admin-modal-card" method="post" action="/users/${escapeAttr(userId)}/subscriptions/manual">
      <div class="admin-modal-head">
        <h3>${escapeHtml(translateText('Manual Payment'))}</h3>
        <button class="secondary small" type="button" onclick="this.closest('dialog').close()">×</button>
      </div>
      <label>${escapeHtml(translateText('Select subscription duration'))}
        ${selectLabeled('period', 'one_month', Object.entries(MANUAL_SUBSCRIPTION_PERIODS).map(([value, period]) => [value, period.label]))}
      </label>
      <button>${escapeHtml(translateText('Done'))}</button>
    </form>
  </dialog>`;
}

function catalogUrlForm(user) {
  return `<form class="stack" method="post" action="/users/${escapeAttr(user.id)}/catalog-url">
    <label>${escapeHtml(translateText('Custom Catalog URL'))}
      <input name="catalogUrl" type="url" inputmode="url" value="${escapeAttr(user.catalogUrl || '')}" placeholder="https://catalog.meetvap.com/index.php">
    </label>
    <span class="subtle">${escapeHtml(translateText('Leave empty to use the server default catalog URL.'))}</span>
    <button>${escapeHtml(translateText('Save Catalog URL'))}</button>
  </form>`;
}

function diagnosticModeForm(user) {
  const messageEnabled = user.diagnosticMode === true;
  const callEnabled = user.callDiagnosticMode === true;

  return `<form class="stack" method="post" action="/users/${escapeAttr(user.id)}/diagnostics">
    <div class="kv">
      <span>${escapeHtml(translateText('Message logging'))}</span>
      <strong>${escapeHtml(translateText(messageEnabled ? 'Enabled' : 'Disabled'))}</strong>
    </div>
    <div class="kv">
      <span>${escapeHtml(translateText('Call logging'))}</span>
      <strong>${escapeHtml(translateText(callEnabled ? 'Enabled' : 'Disabled'))}</strong>
    </div>
    <label class="check-row">
      <input name="diagnosticMode" type="checkbox" value="1" ${messageEnabled ? 'checked' : ''}>
      <span>${escapeHtml(translateText('Enable message logging'))}</span>
    </label>
    <label class="check-row">
      <input name="callDiagnosticMode" type="checkbox" value="1" ${callEnabled ? 'checked' : ''}>
      <span>${escapeHtml(translateText('Enable call logging'))}</span>
    </label>
    <span class="subtle">${escapeHtml(translateText('Diagnostic data is stored on the messenger server under diagdata/{userId}. Keep this enabled only while investigating a live issue.'))}</span>
    <button>${escapeHtml(translateText('Save diagnostics setting'))}</button>
  </form>`;
}

function normalizeCatalogUrl(value) {
  const catalogUrl = String(value || '').trim();

  if (!catalogUrl) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(catalogUrl);
  } catch {
    throw new Error('Invalid Catalog URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid Catalog URL.');
  }

  return parsed.toString();
}

function subscriptionMiniTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((s) => `<tr><td>${userLink(s.userId, s.displayName, s.username)}</td><td><span class="pill ${subscriptionStatusClass(s.status)}">${escapeHtml(displaySubscriptionStatus(s.status))}</span></td><td>${date(s.expiresAt)}</td></tr>`).join('')}</tbody></table></div>` : empty('No subscriptions.');
}

function redeemCodeCreateForm() {
  return `<form method="post" action="/redeem-codes">
    <label>${escapeHtml(translateText('Redeem code name'))}
      <input name="name" maxlength="120" required>
    </label>
    <label>${escapeHtml(translateText('Generate or enter code'))}
      <input name="code" maxlength="80" placeholder="${escapeAttr(generateRedeemCode())}">
      <small>${escapeHtml(translateText('Leave empty to generate automatically.'))}</small>
    </label>
    <label>${escapeHtml(translateText('Manual period'))}
      ${selectLabeled('period', 'one_month', Object.entries(REDEEM_SUBSCRIPTION_PERIODS).map(([value, period]) => [value, period.label]))}
    </label>
    <label>${escapeHtml(translateText('Max uses'))}
      <input min="1" name="maxUses" required type="number" value="1">
    </label>
    <button>${escapeHtml(translateText('Create redeem code'))}</button>
  </form>`;
}

function redeemCodeTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr>${['Name', 'Code', 'Product', 'Usage', 'Created by', 'Created at', 'Status', ''].map((h) => `<th>${escapeHtml(translateText(h))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td>${escapeHtml(row.name)}</td>
      <td><code>${escapeHtml(row.code)}</code></td>
      <td>${escapeHtml(translateText(redeemDurationLabel(row.durationMonths)))}</td>
      <td>${number(row.usedCount)} / ${number(row.maxUses)}</td>
      <td>${redeemCodeCreatorLabel(row)}</td>
      <td>${date(row.createdAt)}</td>
      <td>${row.disabledAt ? `<span class="pill danger">${escapeHtml(translateText('Disabled'))}</span>` : `<span class="pill good">${escapeHtml(translateText('Active'))}</span>`}</td>
      <td><a class="btn secondary" href="/redeem-codes/${encodeURIComponent(row.id)}">${escapeHtml(translateText('Details'))}</a></td>
    </tr>`).join('')}</tbody>
  </table></div>` : empty('No redeem codes.');
}

function redeemCodeCreatorLabel(row) {
  if (row.createdByPartnerUsername) {
    return `<span class="pill soft">${escapeHtml(translateText('Partner'))}</span> ${escapeHtml(row.partnerDisplayName || row.createdByPartnerUsername)}`;
  }

  if (row.createdByAdminUsername) {
    return `<span class="pill soft">${escapeHtml(translateText('Admin'))}</span> ${escapeHtml(row.createdByAdminUsername)}`;
  }

  return escapeHtml(translateText('Unknown'));
}

function redeemCodeUsesTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr>${['Used by', 'Product', 'Status', 'Expires', 'Used at'].map((h) => `<th>${escapeHtml(translateText(h))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td>${userLink(row.userId, row.displayName, row.username)}</td>
      <td>${escapeHtml(row.productId || '')}</td>
      <td>${row.status ? `<span class="pill ${subscriptionStatusClass(row.status)}">${escapeHtml(displaySubscriptionStatus(row.status))}</span>` : ''}</td>
      <td>${date(row.expiresAt)}</td>
      <td>${date(row.usedAt)}</td>
    </tr>`).join('')}</tbody>
  </table></div>` : empty('No redeem code uses yet.');
}

function redeemCodeDisableAction(code) {
  if (!canManageRedeemCodes() || code.disabledAt) {
    return '';
  }

  return `<form method="post" action="/redeem-codes/${escapeAttr(code.id)}/disable" onsubmit="return confirm('${escapeAttr(translateText('Disable this redeem code? Existing subscription grants stay active.'))}')"><button class="secondary" type="submit">${escapeHtml(translateText('Disable'))}</button></form>`;
}

function redeemDurationLabel(months) {
  switch (Number(months)) {
    case 3:
      return '3 Month';
    case 6:
      return '6 Month';
    case 12:
      return '12 Month';
    case 1:
    default:
      return '1 Month';
  }
}

function displayCallMode(mode) {
  return translateText(String(mode || ''));
}

function displayCallDirection(direction) {
  return translateText(String(direction || ''));
}

function displayConversationType(type) {
  return translateText(String(type || ''));
}

function displaySubscriptionStatus(status) {
  return translateText(String(status || ''));
}

function displaySubscriptionPlatform(platform) {
  if (platform === 'IOS') return 'iOS';
  if (platform === 'ANDROID') return 'Android';
  if (platform === 'MANUAL') return 'Manual';
  return translateText(String(platform || ''));
}

function isCallActive(call) {
  return Number(call?.joined_now || 0) > 0;
}

function getEffectiveCallEndedAt(call) {
  return call?.endedAt || call?.last_left_at || null;
}

function callPrimaryLabel(call) {
  if (call.title) return call.title;
  if (call.participant_names) return call.participant_names;
  return displayConversationType(call.type || call.id);
}

function callConversationLabel(call) {
  if (call.type === 'GROUP') {
    return call.title || displayConversationType(call.type) || call.conversationId;
  }
  return call.participant_names || call.title || displayConversationType(call.type) || call.conversationId;
}

function adminUserForm(admin = null) {
  const permissions = normalizeAdminPermissions(admin?.permissions);
  const isExisting = !!admin;
  return `<form class="stack" method="post" action="${isExisting ? `/admins/${escapeAttr(admin.id)}` : '/admins'}">
    ${isExisting ? `<div><strong>${escapeHtml(admin.username)}</strong><br><span class="subtle">${escapeHtml(admin.id)}</span></div>` : `<label>${escapeHtml(translateText('Username'))} <input name="username" autocomplete="off" required></label>`}
    <label>${escapeHtml(translateText(isExisting ? 'New password' : 'Password'))} <input name="password" type="password" autocomplete="new-password" ${isExisting ? `placeholder="${escapeAttr(translateText('Leave empty to keep current password'))}"` : 'required'} minlength="8"></label>
    <div class="permissions-grid">
      ${ADMIN_SECTIONS.filter((section) => section !== 'dashboard').map((section) => `
        <label>${escapeHtml(sectionLabel(section))}
          ${select(`${section}Permission`, permissions[section], ADMIN_PERMISSION_LEVELS)}
        </label>
      `).join('')}
    </div>
    ${isExisting ? `<label class="check"><input type="checkbox" name="isActive" ${admin.isActive ? 'checked' : ''}> ${escapeHtml(translateText('Active'))}</label>` : ''}
    <button>${escapeHtml(translateText(isExisting ? 'Save admin' : 'Create admin'))}</button>
  </form>`;
}

function adminUsersTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr><th>${escapeHtml(translateText('Admin'))}</th><th>${escapeHtml(translateText('Permissions'))}</th><th>${escapeHtml(translateText('Status'))}</th><th>${escapeHtml(translateText('Last login'))}</th><th>${escapeHtml(translateText('Edit'))}</th></tr></thead>
    <tbody>${rows.map((admin) => `<tr>
      <td><strong>${escapeHtml(admin.username)}</strong><br><span class="subtle">${escapeHtml(translateText('Created by'))} ${escapeHtml(admin.createdBy || translateText('unknown'))} · ${date(admin.createdAt)}</span></td>
      <td>${adminPermissionPills(admin.permissions)}</td>
      <td>${admin.isActive ? `<span class="pill good">${escapeHtml(translateText('Active'))}</span>` : `<span class="pill danger">${escapeHtml(translateText('Disabled'))}</span>`}</td>
      <td>${date(admin.lastLoginAt)}</td>
      <td><details class="admin-details"><summary>${escapeHtml(translateText('Edit'))}</summary>${adminUserForm(admin)}</details></td>
    </tr>`).join('')}</tbody>
  </table></div>` : empty('No database admins yet.');
}

function adminPermissionPills(permissions) {
  const normalized = normalizeAdminPermissions(permissions);
  return ADMIN_SECTIONS
    .filter((section) => section !== 'dashboard' && normalized[section] !== 'none')
    .map((section) => `<span class="pill ${normalized[section] === 'edit' ? 'good' : 'soft'}">${escapeHtml(translateText(sectionLabel(section)))}: ${escapeHtml(translateText(normalized[section]))}</span>`)
    .join(' ') || `<span class="subtle">${escapeHtml(translateText('No section access'))}</span>`;
}

function partnerCreateModal() {
  return `<dialog class="admin-modal" id="partner-create-modal">
    <form class="admin-modal-card" method="post" action="/partners">
      <div class="admin-modal-head">
        <h3>${escapeHtml(translateText('Add partner'))}</h3>
        <button class="secondary small" type="button" onclick="this.closest('dialog').close()">×</button>
      </div>
      ${partnerUserForm()}
    </form>
  </dialog>`;
}

function partnerUserForm(partner = null) {
  const isExisting = !!partner;
  return `
    ${isExisting ? `<div><strong>${escapeHtml(partner.username)}</strong><br><span class="subtle">${escapeHtml(partner.id)}</span></div>` : `<label>${escapeHtml(translateText('Username'))} <input name="username" autocomplete="off" required></label>`}
    <label>${escapeHtml(translateText('Display name'))}
      <input name="displayName" maxlength="120" value="${escapeAttr(partner?.displayName || '')}">
    </label>
    <label>${escapeHtml(translateText(isExisting ? 'New password' : 'Password'))}
      <input name="password" type="password" autocomplete="new-password" ${isExisting ? `placeholder="${escapeAttr(translateText('Leave empty to keep current password'))}"` : 'required'} minlength="8">
    </label>
    ${isExisting ? `<label class="check"><input type="checkbox" name="isActive" ${partner.isActive ? 'checked' : ''}> ${escapeHtml(translateText('Active'))}</label>` : ''}
    <button>${escapeHtml(translateText(isExisting ? 'Save partner' : 'Create partner'))}</button>
  `;
}

function partnerUsersTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr>${['Partner', 'Promo codes', 'Used', 'Status', 'Last login', 'Edit'].map((h) => `<th>${escapeHtml(translateText(h))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((partner) => `<tr>
      <td><strong>${escapeHtml(partner.displayName || partner.username)}</strong><br><span class="subtle">${escapeHtml(partner.username)} · ${escapeHtml(translateText('Created by'))} ${escapeHtml(partner.createdByAdminUsername || translateText('unknown'))} · ${date(partner.createdAt)}</span></td>
      <td>${number(partner.codes_count)}</td>
      <td>${number(partner.used_count)}</td>
      <td>${partner.isActive ? `<span class="pill good">${escapeHtml(translateText('Active'))}</span>` : `<span class="pill danger">${escapeHtml(translateText('Disabled'))}</span>`}</td>
      <td>${date(partner.lastLoginAt)}</td>
      <td>${canEdit('partners') ? `<details class="admin-details"><summary>${escapeHtml(translateText('Edit'))}</summary><form class="stack" method="post" action="/partners/${escapeAttr(partner.id)}">${partnerUserForm(partner)}</form></details>` : `<span class="subtle">${escapeHtml(translateText('Read-only'))}</span>`}</td>
    </tr>`).join('')}</tbody>
  </table></div>` : empty('No partners yet.');
}

function callTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((row) => callRowWithOptions(row, { showIds: false })).join('')}</tbody></table></div>` : empty('No calls.');
}

function callListTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((row) => callRowWithOptions(row, { showIds: false })).join('')}</tbody></table></div>` : empty('No calls.');
}

function sessionTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((s) => `<tr><td data-label="${escapeAttr(translateText('Datetime'))}">${date(s.createdAt)}</td><td data-label="${escapeAttr(translateText('IP'))}">${escapeHtml(s.ipAddress || '')}</td><td data-label="${escapeAttr(translateText('Platform'))}">${escapeHtml(translateText(s.platform || ''))}</td><td data-label="${escapeAttr(translateText('App version'))}">${appVersionLabel(s)}</td><td data-label="${escapeAttr(translateText('Language'))}">${escapeHtml(s.locale || '')}</td><td data-label="${escapeAttr(translateText('User agent'))}">${escapeHtml(s.userAgent || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('No sessions.');
}

function deviceTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((d) => `<tr><td data-label="${escapeAttr(translateText('Provider'))}"><span class="pill">${escapeHtml(d.provider)}</span></td><td data-label="${escapeAttr(translateText('Platform'))}">${escapeHtml(translateText(d.platform || ''))}</td><td data-label="${escapeAttr(translateText('App version'))}">${appVersionLabel(d)}</td><td data-label="${escapeAttr(translateText('Language'))}">${escapeHtml(d.locale || '')}</td><td data-label="${escapeAttr(translateText('Updated'))}">${date(d.updatedAt)}</td></tr>`).join('')}</tbody></table></div>` : empty('No devices.');
}

function appVersionLabel(row) {
  const version = String(row.appVersion || '').trim();
  const buildNumber = Number(row.appBuildNumber);
  const versionLabel = version
    ? `<strong>${escapeHtml(version)}</strong>`
    : `<span class="subtle">${escapeHtml(translateText('Unknown'))}</span>`;
  const buildLabel = Number.isSafeInteger(buildNumber) && buildNumber > 0
    ? `<span class="subtle">${escapeHtml(translateText('Build'))} ${number(buildNumber)}</span>`
    : '';

  return buildLabel ? `${versionLabel}<br>${buildLabel}` : versionLabel;
}

function reportSmallTable(rows) {
  return rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((r) => `<tr><td data-label="${escapeAttr(translateText('Status'))}">${reportStatusPill(r)}</td><td data-label="${escapeAttr(translateText('Type'))}"><a href="/reports/${encodeURIComponent(r.id)}"><span class="pill">${escapeHtml(translateText(r.targetType))}</span></a></td><td data-label="${escapeAttr(translateText('Created at'))}">${date(r.createdAt)}</td><td data-label="${escapeAttr(translateText('Reason'))}">${escapeHtml(r.reason || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('No reports.');
}

function reportStatusPill(report) {
  const status = report.status || 'OPEN';
  const overdue = status === 'OPEN' && new Date(report.createdAt).getTime() < Date.now() - (24 * 60 * 60 * 1000);
  const css = overdue ? 'danger' : status === 'RESOLVED' ? 'good' : status === 'DISMISSED' ? 'soft' : 'warn';
  return `<span class="pill ${css}">${escapeHtml(translateText(overdue ? 'OVERDUE' : status))}</span>`;
}

function userMiniTable(rows) {
  return `<div class="table-wrap"><table><tbody>${rows.map((u) => `<tr><td>${userLink(u.id, u.displayName, u.username)}</td><td>${date(u.createdAt)}</td></tr>`).join('')}</tbody></table></div>`;
}

function mediaMiniTable(rows) {
  return `<div class="table-wrap"><table><tbody>${rows.map((u) => `<tr><td>${userLink(u.id, u.displayName, u.username)}</td><td>${bytes(u.bytes)}</td></tr>`).join('')}</tbody></table></div>`;
}

function callCards(rows, options = {}) {
  const clickable = options.clickable !== false;
  return `<div class="call-cards">${rows.map((c) => {
    const content = `<span class="pill ${c.mode === 'VIDEO' ? 'video' : 'voice'}">${escapeHtml(displayCallMode(c.mode))}</span><strong>${escapeHtml(callPrimaryLabel(c))}</strong><span>${number(c.joined_now)} ${escapeHtml(translateText('joined'))} · ${durationBetween(c.startedAt, new Date())}</span>`;

    return clickable
      ? `<a class="call-card" href="/calls/${encodeURIComponent(c.id)}">${content}</a>`
      : `<div class="call-card">${content}</div>`;
  }).join('')}</div>`;
}

function liveKitConfigurationDetails(snapshot) {
  return detailList([
    ['Config source', snapshot.source || 'Missing LiveKit configuration'],
    ['Config path', snapshot.configPath ? `<code>${escapeHtml(snapshot.configPath)}</code>` : `<span class="subtle">${escapeHtml(translateText('None'))}</span>`],
    ['Servers', number(snapshot.servers.length)],
  ]);
}

function liveKitServerMiniTable(servers) {
  if (!servers.length) {
    return empty('No LiveKit servers configured.');
  }

  return `<div class="table-wrap"><table>
    <tbody>${servers.map((server) => `<tr>
      <td><strong>${escapeHtml(server.id)}</strong></td>
      <td>${number(server.activeCalls)} / ${server.maxActiveCalls ? number(server.maxActiveCalls) : '∞'}</td>
      <td>${serverStatusPill(server)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function liveKitServerTable(servers) {
  if (!servers.length) {
    return empty('No LiveKit servers configured.');
  }

  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>${escapeHtml(translateText('Server'))}</th>
      <th>${escapeHtml(translateText('URL'))}</th>
      <th>${escapeHtml(translateText('Status'))}</th>
      <th>${escapeHtml(translateText('Active calls'))}</th>
      <th>${escapeHtml(translateText('Active participants'))}</th>
      <th>${escapeHtml(translateText('Capacity'))}</th>
      <th>${escapeHtml(translateText('Weight'))}</th>
      <th>${escapeHtml(translateText('Load'))}</th>
    </tr></thead>
    <tbody>${servers.map((server) => `<tr>
      <td><strong>${escapeHtml(server.id || 'unassigned')}</strong>${server.configured ? '' : ` <span class="pill warn">${escapeHtml(translateText('Unknown'))}</span>`}</td>
      <td>${server.url ? `<code>${escapeHtml(server.url)}</code>` : `<span class="subtle">${escapeHtml(translateText('Not configured'))}</span>`}</td>
      <td>${serverStatusPill(server)}</td>
      <td>
        <strong>${number(server.activeCalls)}</strong>
        <br><span class="subtle">${escapeHtml(translateText('Voice'))}: ${number(server.voiceCalls)} · ${escapeHtml(translateText('Video'))}: ${number(server.videoCalls)}</span>
      </td>
      <td>
        <strong>${number(server.activeParticipants)}</strong>
        <br><span class="subtle">${escapeHtml(translateText('Voice'))}: ${number(server.voiceParticipants)} · ${escapeHtml(translateText('Video'))}: ${number(server.videoParticipants)}</span>
      </td>
      <td>${server.maxActiveCalls ? `${number(server.activeCalls)} / ${number(server.maxActiveCalls)}` : '∞'}</td>
      <td>${number(server.weight)}</td>
      <td>${liveKitLoadBar(server)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function serverStatusPill(server) {
  if (!server.configured) {
    return `<span class="pill warn">${escapeHtml(translateText('Unknown'))}</span>`;
  }

  if (!server.enabled) {
    return `<span class="pill danger">${escapeHtml(translateText('Disabled'))}</span>`;
  }

  if (server.health?.healthy === true) {
    return `<span class="pill good">${escapeHtml(translateText('Healthy'))}</span>`;
  }

  if (server.health?.healthy === false) {
    const title = server.health.error ? ` title="${escapeAttr(server.health.error)}"` : '';
    return `<span class="pill danger"${title}>${escapeHtml(translateText('Unhealthy'))}</span>`;
  }

  return `<span class="pill warn">${escapeHtml(translateText('Unknown'))}</span>`;
}

function liveKitLoadBar(server) {
  if (!server.maxActiveCalls) {
    return `<span class="subtle">${escapeHtml(translateText('Unlimited'))}</span>`;
  }

  const percent = Math.max(0, Math.min(100, Math.round((Number(server.activeCalls || 0) / server.maxActiveCalls) * 100)));

  return `<div class="load-cell"><span>${percent}%</span><i><b style="width:${percent}%"></b></i></div>`;
}

function bars(rows, labelKey, valueKey) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey] || 0)), 1);
  return `<div class="bars">${rows.map((r) => {
    const value = Number(r[valueKey] || 0);
    return `<div class="bar-row"><div><strong>${escapeHtml(translateText(String(r[labelKey] || '')))}</strong><span>${number(value)}</span></div><i style="width:${Math.max(3, (value / max) * 100)}%"></i></div>`;
  }).join('')}</div>`;
}

function groupSettingsForm(group) {
  return `<form class="stack" method="post" action="/groups/${escapeAttr(group.id)}/settings">
    <label>${escapeHtml(translateText('Group title'))} <input name="title" value="${escapeAttr(group.title || '')}" required></label>
    <label class="check"><input type="checkbox" name="hideMembers" ${group.hideMembers ? 'checked' : ''}> ${escapeHtml(translateText('Hide members from regular users'))}</label>
    <label class="check"><input type="checkbox" name="showAdmins" ${group.showAdmins !== false ? 'checked' : ''}> ${escapeHtml(translateText('Show admins'))}</label>
    <label class="check"><input type="checkbox" name="ownerOnlyMessages" ${group.ownerOnlyMessages ? 'checked' : ''}> ${escapeHtml(translateText('Only admins can send messages'))}</label>
    <button>${escapeHtml(translateText('Save group settings'))}</button>
  </form>`;
}

function groupWebhooksPanel(group, webhooks, deliveries, flash = {}) {
  const editable = canEdit('groups');
  return `<div id="webhooks" class="stack">
    ${flash.createdWebhookUrl ? `
      <div class="notice success">
        <strong>${escapeHtml(flash.createdWebhookName || translateText('Webhook'))} ${escapeHtml(translateText('created.'))}</strong>
        ${escapeHtml(translateText('Copy this URL now. The token is stored only as a hash and cannot be shown again.'))}
      </div>
      <div class="copy-box"><code>${escapeHtml(flash.createdWebhookUrl)}</code></div>
      <div class="subtle">${escapeHtml(translateText('Send JSON with'))} <code>{"text":"Hello group"}</code> ${escapeHtml(translateText('or'))} <code>{"body":"Hello group"}</code>.</div>
    ` : ''}
    ${editable ? `<form class="stack compact-form" method="post" action="/groups/${escapeAttr(group.id)}/webhooks">
      <label>${escapeHtml(translateText('Webhook name'))} <input name="name" maxlength="80" placeholder="${escapeAttr(translateText('Support bot, CRM, monitoring'))}"></label>
      <button>${escapeHtml(translateText('Create webhook URL'))}</button>
    </form>` : empty('Read-only access. Webhook changes are disabled for this admin.')}
    ${webhooks.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${escapeHtml(translateText('Name'))}</th><th>${escapeHtml(translateText('Token'))}</th><th>${escapeHtml(translateText('Status'))}</th><th>${escapeHtml(translateText('Last used'))}</th><th>${escapeHtml(translateText('Deliveries'))}</th><th>${escapeHtml(translateText('Actions'))}</th></tr></thead>
      <tbody>${webhooks.map((webhook) => {
        const revoked = !!webhook.revokedAt;
        const enabled = webhook.enabled === true && !revoked;
        return `<tr>
          <td><strong>${escapeHtml(webhook.name)}</strong><br><span class="subtle">${escapeHtml(webhook.id)}</span></td>
          <td><code>${escapeHtml(webhook.tokenPrefix)}...</code></td>
          <td>${revoked ? `<span class="pill danger">${escapeHtml(translateText('Revoked'))}</span>` : enabled ? `<span class="pill good">${escapeHtml(translateText('Enabled'))}</span>` : `<span class="pill warn">${escapeHtml(translateText('Disabled'))}</span>`}</td>
          <td>${date(webhook.lastUsedAt)}</td>
          <td>${number(webhook.accepted_deliveries)} / ${number(webhook.deliveries)}</td>
          <td><div class="row-actions">
            ${editable ? `
            ${revoked ? '' : `<form method="post" action="/groups/${escapeAttr(group.id)}/webhooks/${escapeAttr(webhook.id)}/toggle"><input type="hidden" name="enabled" value="${enabled ? 'false' : 'true'}"><button class="small secondary">${escapeHtml(translateText(enabled ? 'Disable' : 'Enable'))}</button></form>`}
            ${revoked ? '' : `<form method="post" action="/groups/${escapeAttr(group.id)}/webhooks/${escapeAttr(webhook.id)}/revoke" onsubmit="return confirm('${escapeAttr(translateText('Revoke this webhook permanently?'))}')"><button class="small danger">${escapeHtml(translateText('Revoke'))}</button></form>`}
            ` : `<span class="subtle">${escapeHtml(translateText('Read-only'))}</span>`}
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>` : empty('No webhook URLs for this group.')}
    <h3>${escapeHtml(translateText('Recent webhook deliveries'))}</h3>
    ${deliveries.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${escapeHtml(translateText('When'))}</th><th>${escapeHtml(translateText('Webhook'))}</th><th>${escapeHtml(translateText('Status'))}</th><th>${escapeHtml(translateText('Preview'))}</th><th>${escapeHtml(translateText('IP'))}</th><th>${escapeHtml(translateText('Error'))}</th></tr></thead>
      <tbody>${deliveries.map((delivery) => `<tr>
        <td>${date(delivery.createdAt)}</td>
        <td>${escapeHtml(delivery.webhook_name || translateText('Deleted webhook'))}<br><span class="subtle">${delivery.tokenPrefix ? `${escapeHtml(delivery.tokenPrefix)}...` : ''}</span></td>
        <td><span class="pill ${delivery.status === 'ACCEPTED' ? 'good' : 'danger'}">${escapeHtml(translateText(delivery.status))}</span></td>
        <td>${escapeHtml(delivery.bodyPreview || '')}</td>
        <td>${escapeHtml(delivery.ipAddress || '')}</td>
        <td>${escapeHtml(delivery.error || '')}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : empty('No webhook deliveries yet.')}
  </div>`;
}

function memberManagementTable(rows, group) {
  const editable = canEdit('groups');
  return `<div id="members" class="table-wrap"><table>
    <thead><tr><th>${escapeHtml(translateText('User'))}</th><th>${escapeHtml(translateText('Role'))}</th><th>${escapeHtml(translateText('Joined'))}</th><th>${escapeHtml(translateText('Alias'))}</th><th>${escapeHtml(translateText('Messages'))}</th><th>${escapeHtml(translateText('Actions'))}</th></tr></thead>
    <tbody>${rows.map((m) => {
      const isOwner = m.userId === group.ownerId;
      return `<tr>
        <td>${userLink(m.userId, m.displayName, m.username)}</td>
        <td>${isOwner ? `<span class="pill good">${escapeHtml(translateText('Owner'))}</span>` : m.isAdmin ? `<span class="pill">${escapeHtml(translateText('Admin'))}</span>` : `<span class="pill soft">${escapeHtml(translateText('Member'))}</span>`}${m.aliasPromptSeen === false ? ` <span class="pill warn">${escapeHtml(translateText('Pending'))}</span>` : ''}</td>
        <td>${date(m.joinedAt)}</td>
        <td>${escapeHtml(m.aliasName || '')}</td>
        <td>${number(m.total_messages)}</td>
        <td><div class="row-actions">
          ${editable ? `
          ${!isOwner ? `<form method="post" action="/groups/${escapeAttr(group.id)}/admins/${escapeAttr(m.userId)}/toggle"><button class="small">${escapeHtml(translateText(m.isAdmin ? 'Remove admin' : 'Make admin'))}</button></form>` : ''}
          ${!isOwner ? `<form method="post" action="/groups/${escapeAttr(group.id)}/owner" onsubmit="return confirm('${escapeAttr(translateText('Transfer group ownership?'))}')"><input type="hidden" name="userId" value="${escapeAttr(m.userId)}"><button class="small secondary">${escapeHtml(translateText('Make owner'))}</button></form>` : ''}
          ${!isOwner ? `<form method="post" action="/groups/${escapeAttr(group.id)}/members/${escapeAttr(m.userId)}/remove" onsubmit="return confirm('${escapeAttr(translateText('Remove this user from group?'))}')"><button class="small danger">${escapeHtml(translateText('Remove'))}</button></form>` : ''}
          ` : `<span class="subtle">${escapeHtml(translateText('Read-only'))}</span>`}
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function participantTable(rows) {
  return rows.length ? `<div class="table-wrap"><table>
    <thead><tr><th>${escapeHtml(translateText('User'))}</th><th>${escapeHtml(translateText('Direction'))}</th><th>${escapeHtml(translateText('Joined'))}</th><th>${escapeHtml(translateText('Left'))}</th><th>${escapeHtml(translateText('Status'))}</th><th>${escapeHtml(translateText('Messages'))}</th><th>${escapeHtml(translateText('Media'))}</th></tr></thead>
    <tbody>${rows.map((p) => `<tr><td>${userLink(p.userId, p.displayName, p.username)}</td><td>${escapeHtml(displayCallDirection(p.direction))}</td><td>${date(p.joinedAt)}</td><td>${date(p.leftAt)}</td><td>${p.joinedAt && !p.leftAt ? `<span class="pill good">${escapeHtml(translateText('In call'))}</span>` : `<span class="pill soft">${escapeHtml(translateText('Not active'))}</span>`}</td><td>${number(p.total_messages)}</td><td>${bytes(p.media_bytes)}</td></tr>`).join('')}</tbody>
  </table></div>` : empty('No participants.');
}

function reportTargetDetails(r) {
  if (r.targetType === 'USER') return [['User', r.targetUserId ? userLink(r.targetUserId, r.target_user_name, r.target_username) : 'Deleted user']];
  if (r.targetType === 'MESSAGE') return [['Message id', r.targetMessageId || 'Deleted message'], ['Kind', r.target_message_kind || ''], ['Sent at', date(r.target_message_at)], ['Body', escapeHtml(r.target_message_body || '')]];
  return [['Group', r.targetGroupId ? conversationLink(r.targetGroupId, r.target_group_title || translateText('Untitled group')) : 'Deleted group']];
}

function targetLink(r) {
  if (r.targetType === 'USER' && r.targetUserId) return userLink(r.targetUserId, r.target_user_name, r.target_username);
  if (r.targetType === 'GROUP' && r.targetGroupId) return conversationLink(r.targetGroupId, r.target_label || r.targetGroupId);
  return escapeHtml(r.target_label || r.targetReferenceId);
}

function userLink(id, name, username) {
  return `<a class="entity-link" href="/users/${encodeURIComponent(id)}"><strong>${escapeHtml(name || username || id)}</strong><span>@${escapeHtml(username || id)}</span></a>`;
}

function conversationLink(id, title) {
  return `<a class="entity-link" href="/groups/${encodeURIComponent(id)}"><strong>${escapeHtml(title || translateText('Untitled group'))}</strong><span>${escapeHtml(id)}</span></a>`;
}

function settingsPills(g) {
  return [
    g.hideMembers ? `<span class="pill warn">${translateText('Hidden members')}</span>` : '',
    g.showAdmins === false ? `<span class="pill warn">${translateText('Admins hidden')}</span>` : '',
    g.ownerOnlyMessages ? `<span class="pill">${translateText('Admin messages')}</span>` : '',
  ].filter(Boolean).join(' ') || `<span class="pill soft">${translateText('Default')}</span>`;
}

function privacySummary(user) {
  return [
    user.showLastSeen === false ? 'last seen hidden' : 'last seen shown',
    user.hideFromSearch ? 'search hidden' : 'search visible',
    user.hideNickname ? 'nickname hidden' : 'nickname visible',
    user.preventPeerScreenshots ? 'screenshots blocked' : 'screenshots allowed',
    user.useGroupAliases ? 'group aliases on' : 'group aliases off',
  ].map((item) => `<span class="pill soft">${escapeHtml(translateText(item))}</span>`).join(' ');
}

function subscriptionStatusClass(status) {
  if (status === 'ACTIVE' || status === 'GRACE') return 'good';
  if (status === 'BILLING_RETRY' || status === 'CANCELLED') return 'warn';
  return 'danger';
}

function subscriptionPlatformPill(subscription) {
  const platformLabel = displaySubscriptionPlatform(subscription.platform);
  const manualLine = subscription.platform === 'MANUAL' && subscription.manualGrantedByUsername
    ? `<br><span class="subtle">${escapeHtml(translateText('Granted by'))}: ${escapeHtml(subscription.manualGrantedByUsername)}</span>`
    : '';

  return `<span class="pill ${subscription.platform === 'MANUAL' ? 'good' : ''}">${escapeHtml(translateText(platformLabel))}</span>${manualLine}`;
}

function subscriptionProviderIdentifier(subscription) {
  if (subscription.platform === 'MANUAL') {
    return `<span class="subtle">${escapeHtml(translateText('Manual payment'))}</span>${subscription.manualGrantedByUsername ? `<br><span class="subtle">${escapeHtml(translateText('Granted by'))}:</span> ${escapeHtml(subscription.manualGrantedByUsername)}` : ''}`;
  }

  const identifiers = [];

  if (subscription.transactionId) {
    identifiers.push(['Transaction', subscription.transactionId]);
  }

  if (subscription.originalTransactionId) {
    identifiers.push(['Original', subscription.originalTransactionId]);
  }

  if (subscription.purchaseToken) {
    identifiers.push(['Token', subscription.purchaseToken]);
  }

  if (!identifiers.length) {
    return `<span class="subtle">${escapeHtml(translateText('None'))}</span>`;
  }

  return identifiers
    .map(([label, value]) => `<span class="subtle">${escapeHtml(translateText(label))}:</span> <code>${escapeHtml(shortIdentifier(value))}</code>`)
    .join('<br>');
}

function shortIdentifier(value) {
  const text = String(value || '');

  if (text.length <= 34) {
    return text;
  }

  return `${text.slice(0, 16)}...${text.slice(-10)}`;
}

function generateRedeemCode() {
  return crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function normalizeRedeemCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isExpired(value) {
  return !!value && new Date(value).getTime() <= Date.now();
}

function select(name, value, options) {
  return `<select name="${name}">${options.map((o) => `<option value="${escapeAttr(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(translateText(o || 'all'))}</option>`).join('')}</select>`;
}

function selectLabeled(name, value, options) {
  return `<select name="${name}">${options.map(([optionValue, label]) => `<option value="${escapeAttr(optionValue)}" ${optionValue === value ? 'selected' : ''}>${escapeHtml(translateText(label))}</option>`).join('')}</select>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(translateText(text))}</div>`;
}

function date(value) {
  return value ? new Date(value).toLocaleString() : `<span class="subtle">${escapeHtml(translateText('None'))}</span>`;
}

function formatIpWithLocation(ip, location) {
  const normalizedIp = normalizeIpForLookup(ip);

  if (!normalizedIp) {
    return escapeHtml(translateText('Unknown'));
  }

  const locationParts = [
    location?.city,
    location?.country,
  ].filter(Boolean);

  return `<span>${escapeHtml(normalizedIp)}</span>${locationParts.length ? `<br><span class="subtle">${escapeHtml(locationParts.join(', '))}</span>` : ''}`;
}

function normalizeIpForLookup(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (raw.startsWith('::ffff:')) {
    return raw.slice('::ffff:'.length);
  }

  return raw;
}

async function resolveIpLocation(value) {
  const ip = normalizeIpForLookup(value);

  if (!ip || isPrivateIp(ip)) {
    return null;
  }

  const cached = await getCachedIpLocation(ip);

  if (cached) {
    return cached;
  }

  if (typeof fetch !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1400);

  try {
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city,query`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const location = data?.status === 'success'
      ? {
        city: typeof data.city === 'string' ? data.city : '',
        country: typeof data.country === 'string' ? data.country : '',
        source: 'ip-api.com',
      }
      : null;

    if (location) {
      await cacheIpLocation(ip, location);
    }

    return location;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCachedIpLocation(ip) {
  const result = await pool.query('select country, city, source from "IpLocationCache" where ip = $1', [ip]);
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    city: row.city || '',
    country: row.country || '',
    source: row.source || '',
  };
}

async function cacheIpLocation(ip, location) {
  await pool.query(`
    insert into "IpLocationCache" (ip, country, city, source, "createdAt", "updatedAt")
    values ($1, $2, $3, $4, current_timestamp, current_timestamp)
    on conflict (ip) do update
    set country = excluded.country,
      city = excluded.city,
      source = excluded.source,
      "updatedAt" = current_timestamp
  `, [
    ip,
    location.country || null,
    location.city || null,
    location.source || 'ip-api.com',
  ]);
}

function isPrivateIp(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }

  if (/^(10\.|192\.168\.|169\.254\.)/.test(ip)) {
    return true;
  }

  const match = /^172\.(\d{1,3})\./.exec(ip);

  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }

  return false;
}

function durationBetween(start, end) {
  if (!start) return '0m';
  return duration(Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000));
}

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function bytes(value) {
  let n = Number(value || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function duration(value) {
  const total = Number(value || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '');
}

function createWebhookToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashWebhookToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function notifyManualSubscriptionServerEvent(entitlementId) {
  const secret = String(config.serverEventsInternalSecret || process.env.SERVER_EVENTS_INTERNAL_SECRET || '').trim();
  const baseUrl = getBackendBaseUrl();

  if (!secret || !baseUrl) {
    await insertManualSubscriptionServerEventFallback(entitlementId);
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/subscriptions/internal/manual-entitlement-event`, {
      body: JSON.stringify({ entitlementId }),
      headers: {
        'Content-Type': 'application/json',
        'x-meetvap-internal-secret': secret,
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Manual subscription server event failed with ${response.status}: ${await response.text()}`);
    }

    const result = await response.json().catch(() => ({}));

    if (result.sent === true) {
      return;
    }
  } catch (error) {
    console.warn('Backend manual subscription event call failed, using admin DB fallback', error);
  }

  await insertManualSubscriptionServerEventFallback(entitlementId);
}

async function insertManualSubscriptionServerEventFallback(entitlementId) {
  const conversationId = String(config.serverEventsGroupId || process.env.SERVER_EVENTS_GROUP_ID || '').trim();

  if (!conversationId) {
    return;
  }

  const entitlement = (await pool.query(`
    select
      se.id,
      se.platform,
      se."productId",
      se.status,
      se."expiresAt",
      se."lastVerifiedAt",
      se."manualGrantedByUsername",
      u."displayName",
      u.username
    from "SubscriptionEntitlement" se
    join "User" u on u.id = se."userId"
    where se.id = $1
    limit 1
  `, [entitlementId])).rows[0];

  if (!entitlement || !['ACTIVE', 'GRACE'].includes(entitlement.status) || new Date(entitlement.expiresAt).getTime() <= Date.now()) {
    return;
  }

  const senderId = await ensureMeetvapServerUserForAdminFallback();
  const expiresAt = new Date(entitlement.expiresAt);
  const lastVerifiedAt = entitlement.lastVerifiedAt ? new Date(entitlement.lastVerifiedAt) : new Date();
  const dedupeKey = [
    'subscription',
    entitlement.id,
    entitlement.status,
    expiresAt.toISOString(),
  ].join(':');
  const existing = await pool.query(`
    select id
    from "Message"
    where "conversationId" = $1
      and "senderId" = $2
      and metadata->>'source' = 'server_event'
      and metadata->>'dedupeKey' = $3
    limit 1
  `, [conversationId, senderId, dedupeKey]);

  if (existing.rowCount > 0) {
    return;
  }

  const conversation = await pool.query('select id from "Conversation" where id = $1 and type = $2 limit 1', [conversationId, 'GROUP']);

  if (conversation.rowCount === 0) {
    console.warn(`Manual subscription server event group not found: ${conversationId}`);
    return;
  }

  const messageId = cuid();
  const sentAt = new Date();
  const manualAdminLine = entitlement.platform === 'MANUAL' && entitlement.manualGrantedByUsername
    ? [`Ekleyen admin: ${entitlement.manualGrantedByUsername}`]
    : [];
  const body = [
    'Yeni abonelik',
    '',
    `Görünen ad: ${entitlement.displayName}`,
    `Kullanıcı adı: ${entitlement.username}`,
    `Platform: ${String(entitlement.platform || 'Bilinmiyor').toUpperCase()}`,
    ...manualAdminLine,
    `Ürün: ${entitlement.productId}`,
    `Bitiş tarihi: ${formatTurkishDate(expiresAt)}`,
    `İşlem tarihi: ${formatTurkishDate(lastVerifiedAt)}`,
  ].join('\n');
  const metadata = {
    dedupeKey,
    eventType: 'user_subscribed',
    source: 'server_event',
  };

  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query(`
      insert into "Message" (
        id,
        "conversationId",
        "senderId",
        kind,
        body,
        status,
        metadata,
        "createdAt",
        "updatedAt"
      )
      values ($1, $2, $3, 'TEXT', $4, 'SENT', $5::jsonb, $6, $6)
    `, [messageId, conversationId, senderId, body, JSON.stringify(metadata), sentAt]);
    await client.query(`
      update "Conversation"
      set
        "lastMessageAt" = $1,
        "lastMessageBody" = $2,
        "lastMessageKind" = 'TEXT',
        "lastMessageSenderId" = $3,
        "lastMessageStatus" = 'SENT',
        "updatedAt" = $1
      where id = $4
    `, [sentAt, body, senderId, conversationId]);
    await client.query('delete from "ConversationDeletion" where "conversationId" = $1 and "deletedAt" <= $2', [conversationId, sentAt]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureMeetvapServerUserForAdminFallback() {
  const username = 'meetvap_server';
  const existing = await pool.query('select id from "User" where lower(username) = lower($1) limit 1', [username]);

  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const id = cuid();
  const passwordHash = await bcrypt.hash('Open@rza@Rza@798', 12);

  try {
    await pool.query(`
      insert into "User" (
        id,
        "displayName",
        username,
        "avatarUrl",
        "hideFromSearch",
        "hideNickname",
        "passwordHash",
        "showLastSeen",
        "useGroupAliases",
        "createdAt",
        "updatedAt"
      )
      values ($1, 'Meetvap Server', $2, 'meetvap://logo', true, false, $3, false, false, current_timestamp, current_timestamp)
    `, [id, username, passwordHash]);

    return id;
  } catch (error) {
    if (error && error.code === '23505') {
      const repaired = await pool.query('select id from "User" where lower(username) = lower($1) limit 1', [username]);

      if (repaired.rows[0]?.id) {
        return repaired.rows[0].id;
      }
    }

    throw error;
  }
}

function formatTurkishDate(value) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
  }).format(value);
}

function getWebhookUrl(token) {
  const baseUrl = getBackendBaseUrl();
  return `${baseUrl || 'https://YOUR_BACKEND_HOST'}/group-webhooks/${encodeURIComponent(token)}/messages`;
}

function getBackendBaseUrl() {
  return String(config.backendPublicUrl || config.publicApiUrl || config.publicApiURL || '').trim().replace(/\/+$/, '');
}

function getBackendMediaUrl(mediaId) {
  const baseUrl = getBackendBaseUrl();
  const path = `/media/${encodeURIComponent(mediaId)}/file`;

  return baseUrl ? `${baseUrl}${path}` : path;
}

async function sendSupportReply(conversationId, body, adminUsername) {
  const secret = String(config.serverEventsInternalSecret || process.env.SERVER_EVENTS_INTERNAL_SECRET || '').trim();
  const baseUrl = getBackendBaseUrl();

  if (!secret || !baseUrl) {
    await insertSupportReplyFallback(conversationId, body, adminUsername);
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/support/internal/conversations/${encodeURIComponent(conversationId)}/messages`, {
      body: JSON.stringify({ adminUsername, body }),
      headers: {
        'Content-Type': 'application/json',
        'x-meetvap-internal-secret': secret,
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Support reply failed with ${response.status}: ${await response.text()}`);
    }
  } catch (error) {
    console.warn('Backend support reply call failed, using admin DB fallback', error);
    await insertSupportReplyFallback(conversationId, body, adminUsername);
  }
}

async function insertSupportReplyFallback(conversationId, body, adminUsername) {
  const client = await pool.connect();

  try {
    await client.query('begin');
    const supportUser = (await client.query(`
      select id
      from "User"
      where lower(username) = 'meetvap'
      limit 1
    `)).rows[0];

    if (!supportUser) {
      throw new Error('MeetVap support user not found.');
    }

    const conversation = (await client.query(`
      select c.id
      from "Conversation" c
      join "ConversationMember" cm on cm."conversationId" = c.id and cm."userId" = $2
      where c.id = $1 and c.type = 'DIRECT'
      limit 1
    `, [conversationId, supportUser.id])).rows[0];

    if (!conversation) {
      throw new Error('Support conversation not found.');
    }

    const messageId = cuid();
    const cleanAdminUsername = String(adminUsername || '').slice(0, 80);
    const metadata = JSON.stringify({
      adminBody: body,
      fallback: true,
      source: 'support_admin',
    });

    await client.query(`
      insert into "Message" (
        id, body, "conversationId", "createdAt", kind, metadata, "senderId", status, "updatedAt"
      )
      values ($1, $2, $3, current_timestamp, 'TEXT', $4::jsonb, $5, 'SENT', current_timestamp)
    `, [messageId, body, conversationId, metadata, supportUser.id]);
    await client.query(`
      insert into "SupportTicketReplyAdmin" ("messageId", "adminUsername", "createdAt")
      values ($1, $2, current_timestamp)
      on conflict ("messageId") do update set "adminUsername" = excluded."adminUsername"
    `, [messageId, cleanAdminUsername || null]);
    await client.query(`
      update "Conversation"
      set
        "lastMessageAt" = current_timestamp,
        "lastMessageBody" = $2,
        "lastMessageKind" = 'TEXT',
        "lastMessageSenderId" = $3,
        "lastMessageStatus" = 'SENT',
        "updatedAt" = current_timestamp
      where id = $1
    `, [conversationId, body, supportUser.id]);
    await client.query(`
      update "ConversationMember"
      set "lastReadAt" = current_timestamp
      where "conversationId" = $1 and "userId" = $2
    `, [conversationId, supportUser.id]);
    await client.query(`
      delete from "ConversationDeletion"
      where "conversationId" = $1 and "deletedAt" <= current_timestamp
    `, [conversationId]);
    await client.query(`
      insert into "AnalyticsOverview" (
        id, "totalMessages", "textMessages", "updatedAt"
      )
      values (1, 1, 1, current_timestamp)
      on conflict (id) do update set
        "totalMessages" = "AnalyticsOverview"."totalMessages" + 1,
        "textMessages" = "AnalyticsOverview"."textMessages" + 1,
        "updatedAt" = current_timestamp
    `);
    await client.query(`
      insert into "UserMessageStats" (
        "userId", "totalMessages", "textMessages", "updatedAt"
      )
      values ($1, 1, 1, current_timestamp)
      on conflict ("userId") do update set
        "totalMessages" = "UserMessageStats"."totalMessages" + 1,
        "textMessages" = "UserMessageStats"."textMessages" + 1,
        "updatedAt" = current_timestamp
    `, [supportUser.id]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function cuid() {
  return `c${Date.now().toString(36)}${crypto.randomBytes(12).toString('hex')}`;
}

function liveScript() {
  return `<script>
    const map = {
      onlineUsers: 'onlineUsers',
      peopleInCalls: 'peopleInCalls',
      peopleInVoiceCalls: 'peopleInVoiceCalls',
      peopleInVideoCalls: 'peopleInVideoCalls',
      activeCalls: 'activeCalls',
      peakOnlineUsers: 'peaks.onlineUsers',
      peakPeopleInVoiceCalls: 'peaks.peopleInVoiceCalls',
      peakPeopleInVideoCalls: 'peaks.peopleInVideoCalls'
    };
    function pick(obj, path) { return path.split('.').reduce((acc, key) => acc && acc[key], obj); }
    function fmt(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
    async function refreshLive() {
      try {
        const response = await fetch('/api/live', { credentials: 'same-origin' });
        const data = await response.json();
        document.querySelectorAll('[data-live-key]').forEach((node) => {
          const value = pick(data, map[node.dataset.liveKey] || node.dataset.liveKey);
          node.textContent = fmt(value);
        });
      } catch {}
    }
    setInterval(refreshLive, 5000);
  </script>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send(layout({ bare: true, title: 'Error', body: `<main class="content"><div class="notice">${escapeHtml(error.message || 'Admin error')}</div></main>` }));
});

init().then(() => {
  app.listen(config.port, () => {
    console.log(`MeetVap admin listening on http://localhost:${config.port}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
