<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Coming Soon</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background:
        radial-gradient(circle at 12% 0%, rgba(79, 140, 255, 0.28), transparent 34%),
        radial-gradient(circle at 92% 10%, rgba(255, 180, 69, 0.2), transparent 28%),
        linear-gradient(145deg, #07111f 0%, #0d1628 52%, #12101d 100%);
      color: #edf4ff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
    }

    .page {
      margin: 0 auto;
      max-width: 980px;
      min-height: 100vh;
      padding: 28px 18px 34px;
    }

    .hero {
      padding: 10px 2px 22px;
      text-align: left;
    }

    .eyebrow {
      color: #63d6ff;
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.14em;
      margin-bottom: 10px;
      text-transform: uppercase;
    }

    .animated-text {
      background: linear-gradient(135deg, #6ea4ff 0%, #ffd36d 42%, #ff6aa5 76%, #6ea4ff 100%);
      background-clip: text;
      background-size: 220% 220%;
      color: transparent;
      font-size: clamp(2.05rem, 9vw, 4.5rem);
      font-weight: 950;
      letter-spacing: 0;
      line-height: 0.98;
      margin-bottom: 14px;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: gradientShift 5s ease-in-out infinite;
    }

    @keyframes gradientShift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }

    .subtitle {
      color: #a9b7cd;
      font-size: clamp(1rem, 3.8vw, 1.25rem);
      font-weight: 600;
      line-height: 1.5;
      max-width: 760px;
    }

    .dot-animation {
      display: inline-flex;
      gap: 6px;
      margin-left: 8px;
      transform: translateY(-0.12em);
    }

    .dot {
      animation: bounce 1.4s infinite;
      background: #63d6ff;
      border-radius: 50%;
      display: inline-block;
      height: 7px;
      width: 7px;
    }

    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { opacity: 1; transform: translateY(0); }
      40% { opacity: 0.65; transform: translateY(-8px); }
    }

    .games-header {
      align-items: flex-end;
      display: flex;
      justify-content: space-between;
      gap: 14px;
      margin: 12px 0 14px;
    }

    .games-title {
      color: #f6f9ff;
      font-size: 1.06rem;
      font-weight: 900;
    }

    .games-count {
      color: #7f91aa;
      font-size: 0.86rem;
      font-weight: 800;
      white-space: nowrap;
    }

    .game-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .game-card {
      background:
        linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04)),
        var(--card-bg);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      box-shadow: 0 14px 32px rgba(0,0,0,0.24);
      color: #ffffff;
      display: flex;
      flex-direction: column;
      min-height: 156px;
      overflow: hidden;
      padding: 16px;
      position: relative;
      text-decoration: none;
      transform: translateZ(0);
      transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }

    .game-card:active {
      transform: scale(0.985);
    }

    @media (hover: hover) {
      .game-card:hover {
        border-color: rgba(255,255,255,0.28);
        box-shadow: 0 18px 42px rgba(0,0,0,0.34);
        transform: translateY(-2px);
      }
    }

    .game-card::after {
      background: radial-gradient(circle, rgba(255,255,255,0.26), transparent 62%);
      content: "";
      height: 120px;
      position: absolute;
      right: -44px;
      top: -42px;
      width: 120px;
    }

    .game-icon {
      align-items: center;
      background: rgba(0,0,0,0.2);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 16px;
      display: flex;
      font-size: 2rem;
      height: 54px;
      justify-content: center;
      margin-bottom: 14px;
      width: 54px;
      z-index: 1;
    }

    .game-name {
      font-size: 1.08rem;
      font-weight: 950;
      line-height: 1.15;
      margin-bottom: 7px;
      z-index: 1;
    }

    .game-description {
      color: rgba(255,255,255,0.78);
      font-size: 0.87rem;
      font-weight: 650;
      line-height: 1.35;
      margin-bottom: 18px;
      z-index: 1;
    }

    .play-row {
      align-items: center;
      color: #ffffff;
      display: flex;
      font-size: 0.88rem;
      font-weight: 900;
      gap: 6px;
      margin-top: auto;
      z-index: 1;
    }

    .arrow {
      align-items: center;
      background: rgba(255,255,255,0.18);
      border-radius: 999px;
      display: inline-flex;
      height: 24px;
      justify-content: center;
      width: 24px;
    }

    @media (min-width: 720px) {
      .page {
        padding-top: 44px;
      }

      .game-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .game-card {
        min-height: 178px;
      }
    }

    @media (max-width: 420px) {
      .game-grid {
        grid-template-columns: 1fr;
      }

      .game-card {
        min-height: 138px;
      }
    }
  </style>
  <script>
    const translations = {
      en: {
        title: 'Coming soon',
        subtitle: 'The full catalog is coming soon, but you can play simple games right now.',
        eyebrow: 'MeetVap Catalog',
        gamesTitle: 'Play now',
        gamesCount: '5 games',
        play: 'Play',
        games: {
          mario: { name: 'Mario Run', description: 'Jump, dodge, and keep moving through a retro platform challenge.' },
          pacman: { name: 'Pac-Man', description: 'Collect points, avoid ghosts, and chase the classic arcade feeling.' },
          tetris: { name: 'MeetRis', description: 'Stack blocks, clear lines, and keep the board alive.' },
          galaxy: { name: 'Galaxy Blaster', description: 'Pilot through space and survive waves of enemies.' },
          tank: { name: 'Steel Brigade', description: 'Enter a fast tank battle built for mobile play.' }
        }
      },
      tr: {
        title: 'Yakında geliyor',
        subtitle: 'Tam katalog yakında geliyor, ama şimdilik basit oyunları hemen oynayabilirsiniz.',
        eyebrow: 'MeetVap Katalog',
        gamesTitle: 'Şimdi oyna',
        gamesCount: '5 oyun',
        play: 'Oyna',
        games: {
          mario: { name: 'Mario Run', description: 'Retro platform bölümünde zıpla, engellerden kaç ve ilerle.' },
          pacman: { name: 'Pac-Man', description: 'Puanları topla, hayaletlerden kaç ve klasik arcade hissini yaşa.' },
          tetris: { name: 'MeetRis', description: 'Blokları yerleştir, satırları temizle ve oyunda kal.' },
          galaxy: { name: 'Galaxy Blaster', description: 'Uzay gemini yönet ve düşman dalgalarına karşı dayan.' },
          tank: { name: 'Çelik Tugay', description: 'Mobil oyun için hazırlanmış hızlı tank savaşına gir.' }
        }
      },
      ru: {
        title: 'Скоро',
        subtitle: 'Полный каталог скоро появится, а пока вы можете играть в простые игры уже сейчас.',
        eyebrow: 'Каталог MeetVap',
        gamesTitle: 'Играть сейчас',
        gamesCount: '5 игр',
        play: 'Играть',
        games: {
          mario: { name: 'Mario Run', description: 'Прыгайте, обходите препятствия и двигайтесь вперед в ретро-испытании.' },
          pacman: { name: 'Pac-Man', description: 'Собирайте очки, избегайте призраков и почувствуйте классику аркад.' },
          tetris: { name: 'MeetRis', description: 'Складывайте блоки, очищайте линии и удерживайте поле.' },
          galaxy: { name: 'Galaxy Blaster', description: 'Управляйте кораблем и переживите волны врагов.' },
          tank: { name: 'Steel Brigade', description: 'Вступайте в быстрый танковый бой, созданный для телефона.' }
        }
      },
      es: { title: 'Próximamente', subtitle: 'El catálogo completo llegará pronto, pero ya puedes jugar juegos simples.', eyebrow: 'Catálogo MeetVap', gamesTitle: 'Jugar ahora', gamesCount: '5 juegos', play: 'Jugar' },
      fr: { title: 'Bientôt disponible', subtitle: 'Le catalogue complet arrive bientôt, mais vous pouvez déjà jouer à des jeux simples.', eyebrow: 'Catalogue MeetVap', gamesTitle: 'Jouer maintenant', gamesCount: '5 jeux', play: 'Jouer' },
      de: { title: 'Demnächst verfügbar', subtitle: 'Der vollständige Katalog kommt bald, aber einfache Spiele können Sie jetzt schon spielen.', eyebrow: 'MeetVap Katalog', gamesTitle: 'Jetzt spielen', gamesCount: '5 Spiele', play: 'Spielen' },
      it: { title: 'Prossimamente', subtitle: 'Il catalogo completo arriverà presto, ma ora puoi giocare a giochi semplici.', eyebrow: 'Catalogo MeetVap', gamesTitle: 'Gioca ora', gamesCount: '5 giochi', play: 'Gioca' },
      pt: { title: 'Em breve', subtitle: 'O catálogo completo chegará em breve, mas você já pode jogar jogos simples.', eyebrow: 'Catálogo MeetVap', gamesTitle: 'Jogar agora', gamesCount: '5 jogos', play: 'Jogar' },
      ar: { title: 'قريباً', subtitle: 'سيصل الكتالوج الكامل قريباً، ويمكنك الآن لعب ألعاب بسيطة.', eyebrow: 'كتالوج MeetVap', gamesTitle: 'العب الآن', gamesCount: '5 ألعاب', play: 'العب' },
      ja: { title: '近日公開', subtitle: '完全なカタログは近日公開ですが、今すぐ簡単なゲームを遊べます。', eyebrow: 'MeetVap カタログ', gamesTitle: '今すぐ遊ぶ', gamesCount: '5ゲーム', play: '遊ぶ' },
      zh: { title: '即将推出', subtitle: '完整目录即将推出，但你现在可以玩简单游戏。', eyebrow: 'MeetVap 目录', gamesTitle: '立即游玩', gamesCount: '5 个游戏', play: '游玩' },
      ko: { title: '곧 출시', subtitle: '전체 카탈로그는 곧 제공되지만 지금 간단한 게임을 플레이할 수 있습니다.', eyebrow: 'MeetVap 카탈로그', gamesTitle: '지금 플레이', gamesCount: '게임 5개', play: '플레이' },
      nl: { title: 'Binnenkort beschikbaar', subtitle: 'De volledige catalogus komt binnenkort, maar je kunt nu al eenvoudige games spelen.', eyebrow: 'MeetVap Catalogus', gamesTitle: 'Nu spelen', gamesCount: '5 games', play: 'Spelen' },
      pl: { title: 'Wkrótce', subtitle: 'Pełny katalog pojawi się wkrótce, ale już teraz możesz zagrać w proste gry.', eyebrow: 'Katalog MeetVap', gamesTitle: 'Graj teraz', gamesCount: '5 gier', play: 'Graj' },
      sv: { title: 'Kommer snart', subtitle: 'Den fullständiga katalogen kommer snart, men du kan spela enkla spel redan nu.', eyebrow: 'MeetVap Katalog', gamesTitle: 'Spela nu', gamesCount: '5 spel', play: 'Spela' },
      da: { title: 'Kommer snart', subtitle: 'Det fulde katalog kommer snart, men du kan allerede nu spille enkle spil.', eyebrow: 'MeetVap Katalog', gamesTitle: 'Spil nu', gamesCount: '5 spil', play: 'Spil' },
      fi: { title: 'Tulossa pian', subtitle: 'Koko katalogi tulee pian, mutta voit pelata yksinkertaisia pelejä jo nyt.', eyebrow: 'MeetVap Katalogi', gamesTitle: 'Pelaa nyt', gamesCount: '5 peliä', play: 'Pelaa' },
      he: { title: 'בקרוב', subtitle: 'הקטלוג המלא יגיע בקרוב, אבל עכשיו אפשר לשחק במשחקים פשוטים.', eyebrow: 'קטלוג MeetVap', gamesTitle: 'שחק עכשיו', gamesCount: '5 משחקים', play: 'שחק' },
      vi: { title: 'Sắp ra mắt', subtitle: 'Danh mục đầy đủ sẽ sớm ra mắt, nhưng bây giờ bạn có thể chơi các trò chơi đơn giản.', eyebrow: 'Danh mục MeetVap', gamesTitle: 'Chơi ngay', gamesCount: '5 trò chơi', play: 'Chơi' },
      th: { title: 'เร็ว ๆ นี้', subtitle: 'แค็ตตาล็อกฉบับเต็มกำลังจะมา แต่ตอนนี้คุณเล่นเกมง่าย ๆ ได้แล้ว', eyebrow: 'แค็ตตาล็อก MeetVap', gamesTitle: 'เล่นตอนนี้', gamesCount: '5 เกม', play: 'เล่น' },
      uk: { title: 'Скоро', subtitle: 'Повний каталог скоро з’явиться, а поки ви вже можете грати в прості ігри.', eyebrow: 'Каталог MeetVap', gamesTitle: 'Грати зараз', gamesCount: '5 ігор', play: 'Грати' },
      el: { title: 'Σύντομα', subtitle: 'Ο πλήρης κατάλογος έρχεται σύντομα, αλλά μπορείτε ήδη να παίξετε απλά παιχνίδια.', eyebrow: 'Κατάλογος MeetVap', gamesTitle: 'Παίξτε τώρα', gamesCount: '5 παιχνίδια', play: 'Παίξτε' }
    };

    const games = [
      { key: 'mario', href: 'mario.php', icon: '🏃', color: 'linear-gradient(145deg, #0e4c8f, #d64242)' },
      { key: 'pacman', href: 'pacman.php', icon: '🟡', color: 'linear-gradient(145deg, #3b2b81, #d4a518)' },
      { key: 'tetris', href: 'tetris.php', icon: '▦', color: 'linear-gradient(145deg, #0f6b7a, #5937a8)' },
      { key: 'galaxy', href: 'galaxy.php', icon: '🚀', color: 'linear-gradient(145deg, #111a67, #a02278)' },
      { key: 'tank', href: 'tank.php', icon: '▰', color: 'linear-gradient(145deg, #234b32, #7f7a29)' }
    ];

    function resolveLanguage() {
      const params = new URLSearchParams(window.location.search);
      const requested = (params.get('lang') || '').split('-')[0].toLowerCase();
      const browser = (navigator.language || navigator.userLanguage || 'en').split('-')[0].toLowerCase();

      return translations[requested] ? requested : translations[browser] ? browser : 'en';
    }

    function withLanguage(url, language) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}lang=${encodeURIComponent(language)}`;
    }

    document.addEventListener('DOMContentLoaded', function() {
      const language = resolveLanguage();
      const rawText = translations[language] || translations.en;
      const text = {
        ...translations.en,
        ...rawText,
        games: {
          ...translations.en.games,
          ...(rawText.games || {})
        }
      };
      const gameGrid = document.getElementById('game-grid');

      document.documentElement.lang = language;
      document.title = text.title;
      document.getElementById('eyebrow').textContent = text.eyebrow;
      document.getElementById('main-title-text').textContent = text.title;
      document.getElementById('main-subtitle').textContent = text.subtitle;
      document.getElementById('games-title').textContent = text.gamesTitle;
      document.getElementById('games-count').textContent = text.gamesCount;

      games.forEach(function(game) {
        const gameText = text.games[game.key] || translations.en.games[game.key];
        const card = document.createElement('a');
        card.className = 'game-card';
        card.href = withLanguage(game.href, language);
        card.style.setProperty('--card-bg', game.color);
        card.innerHTML = `
          <div class="game-icon">${game.icon}</div>
          <div class="game-name">${gameText.name}</div>
          <div class="game-description">${gameText.description}</div>
          <div class="play-row"><span>${text.play}</span><span class="arrow">›</span></div>
        `;
        gameGrid.appendChild(card);
      });
    });
  </script>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="eyebrow" id="eyebrow">MeetVap Catalog</div>
      <h1 class="animated-text">
        <span id="main-title-text">Coming soon</span>
        <span class="dot-animation"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
      </h1>
      <p class="subtitle" id="main-subtitle">The full catalog is coming soon, but you can play simple games right now.</p>
    </section>

    <section aria-label="Games">
      <div class="games-header">
        <h2 class="games-title" id="games-title">Play now</h2>
        <div class="games-count" id="games-count">5 games</div>
      </div>
      <div class="game-grid" id="game-grid"></div>
    </section>
  </main>
</body>
</html>
