<?php


$lang = strtolower($_GET['lang'] ?? 'en');

if (!in_array($lang, ['en', 'ru', 'tr'])) {
    $lang = 'en';
}


if (isset($_GET['call_from']) && $_GET['call_from'] === 'support') {
    include 'appfeatures.php';
    exit;
}



$text = [

'en' => [

'title' => 'MeetVap is now free',

'subtitle' => 'Premium security features are free for 15 days',

'description' =>
'Messaging and calling remain free forever. After the trial ends, only the advanced security features below will require a subscription.',

'trial' => '15 days of free Premium access',

'features' => [
'PANIC PIN with pinned messages and live location',
'Use a different display name in groups',
'Voice changer for voice messages and calls'
]

],

'ru' => [

'title' => 'MeetVap теперь бесплатен',

'subtitle' => 'Премиум-инструменты безопасности бесплатны 15 дней',

'description' =>
'Основные сообщения и звонки остаются бесплатными. После окончания пробного периода без подписки отключатся только расширенные инструменты безопасности ниже.',

'trial' => '15 дней бесплатного премиум-доступа',

'features' => [
'PANIC PIN с закрепленными сообщениями и живой геопозицией',
'Использовать другое отображаемое имя в группах',
'Изменитель голоса для голосовых сообщений и звонков'
]

],

'tr' => [

'title' => 'MeetVap artık ücretsiz',

'subtitle' => 'Premium güvenlik özellikleri 15 gün ücretsiz',

'description' =>
'Mesajlaşma ve aramalar her zaman ücretsiz kalır. Deneme süresi sona erdiğinde yalnızca aşağıdaki gelişmiş güvenlik özellikleri abonelik gerektirir.',

'trial' => '15 gün ücretsiz Premium erişim',

'features' => [
'Sabitlenmiş mesajlar ve canlı konum ile PANIC PIN',
'Gruplarda farklı görünen ad kullanın',
'Sesli mesajlar ve aramalar için ses değiştirici'
]

]

];

$t = $text[$lang];

?>
<!DOCTYPE html>
<html lang="<?= $lang ?>">
<head>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>MeetVap Premium</title>

<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

<style>

*{
margin:0;
padding:0;
box-sizing:border-box;
font-family:Inter,sans-serif;
}

body{

background:#eef2f7;
display:flex;
justify-content:center;
align-items:center;
min-height:100vh;
padding:12px;

}

.card{

width:100%;
max-width:420px;
background:#fff;
border-radius:28px;
padding:24px 18px;
box-shadow:0 10px 35px rgba(0,0,0,.12);

}

.icon{

width:68px;
height:68px;
margin:0 auto 14px;

background:#2F6DF6;
border-radius:50%;

display:flex;
align-items:center;
justify-content:center;

color:#fff;
font-size:30px;

}

.icon::before{

content:"🛡";

}

h1{

text-align:center;
font-size:30px;
font-weight:800;
line-height:1.15;
color:#16223A;
margin-bottom:10px;

}

.subtitle{

text-align:center;
font-size:20px;
font-weight:700;
line-height:1.25;
color:#2F6DF6;
margin-bottom:16px;

}

.desc{

text-align:center;
font-size:16px;
line-height:1.45;
color:#6b7280;
margin-bottom:18px;

}

.trial{

display:flex;
align-items:center;
gap:12px;

padding:14px 16px;
margin-bottom:12px;

background:#EAF2FF;
border-radius:16px;

font-size:16px;
font-weight:700;
color:#2F6DF6;

}

.trial::before{

content:"🕒";
font-size:20px;

}

.feature{

display:flex;
align-items:center;
gap:14px;

padding:14px 16px;
margin-bottom:10px;

border:1px solid #EDF1F7;
border-radius:18px;

background:#fff;

}

.feature-icon{
    width:28px;
    height:28px;
    flex-shrink:0;
    display:flex;
    align-items:center;
    justify-content:center;
}

.feature-icon svg{
    width:24px;
    height:24px;
    display:block;
}

.feature-text{

font-size:17px;
font-weight:600;
line-height:1.3;
color:#1E2434;

}

@media (max-width:480px){

.card{

padding:20px 16px;
border-radius:24px;

}

.icon{

width:60px;
height:60px;
font-size:26px;

}

h1{

font-size:26px;

}

.subtitle{

font-size:18px;

}

.desc{

font-size:15px;

}

.trial{

font-size:15px;

}

.feature{

padding:12px 14px;

}

.feature-icon{

width:24px;
height:24px;

}

.feature-text{

font-size:15px;

}

}

</style>

</head>

<body>

<div class="card">

    <div class="icon">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L4 5v6c0 5.2 3.4 9.9 8 11 4.6-1.1 8-5.8 8-11V5l-8-3z"/>
            <path d="M10.7 12.8l-2-2-1.4 1.4 3.4 3.4 6-6-1.4-1.4z" fill="#2F6DF6"/>
        </svg>
    </div>

    <h1><?= htmlspecialchars($t['title']) ?></h1>

    <div class="subtitle">
        <?= htmlspecialchars($t['subtitle']) ?>
    </div>

    <div class="desc">
        <?= htmlspecialchars($t['description']) ?>
    </div>

    <div class="trial">
        <?= htmlspecialchars($t['trial']) ?>
    </div>

    <!-- Feature 1 -->

    <div class="feature">

        <div class="feature-icon">

            <svg viewBox="0 0 24 24" fill="#4BA3FF">
                <circle cx="5" cy="5" r="1.5"/>
                <circle cx="12" cy="5" r="1.5"/>
                <circle cx="19" cy="5" r="1.5"/>
                <circle cx="5" cy="12" r="1.5"/>
                <circle cx="12" cy="12" r="1.5"/>
                <circle cx="19" cy="12" r="1.5"/>
                <circle cx="5" cy="19" r="1.5"/>
                <circle cx="12" cy="19" r="1.5"/>
                <circle cx="19" cy="19" r="1.5"/>
            </svg>

        </div>

        <div class="feature-text">
            <?= htmlspecialchars($t['features'][0]) ?>
        </div>

    </div>

    <!-- Feature 2 -->

    <div class="feature">

        <div class="feature-icon">

            <svg viewBox="0 0 24 24" fill="none" stroke="#4BA3FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="4"/>
                <path d="M5 20c1.8-4 11.2-4 14 0"/>
            </svg>

        </div>

        <div class="feature-text">
            <?= htmlspecialchars($t['features'][1]) ?>
        </div>

    </div>

    <!-- Feature 3 -->

    <div class="feature">

        <div class="feature-icon">

            <svg viewBox="0 0 24 24" fill="none" stroke="#4BA3FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3"/>
                <path d="M6 11a6 6 0 0 0 12 0"/>
                <path d="M12 17v4"/>
                <path d="M8 21h8"/>
            </svg>

        </div>

        <div class="feature-text">
            <?= htmlspecialchars($t['features'][2]) ?>
        </div>

    </div>

</div>

</body>
</html>