<?php

declare(strict_types=1);

$allowedLanguages = ['en', 'ru', 'tr'];
$lang = isset($_GET['lang']) && is_string($_GET['lang']) ? strtolower(trim($_GET['lang'])) : 'en';

if (!in_array($lang, $allowedLanguages, true)) {
    $lang = 'en';
}

$target = 'https://www.meetvap.com/features?' . http_build_query([
    'lang' => $lang,
    'from_mob' => 'true',
]);

header('Location: ' . $target, true, 302);
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

?>
<!doctype html>
<html lang="<?= htmlspecialchars($lang, ENT_QUOTES, 'UTF-8') ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="0;url=<?= htmlspecialchars($target, ENT_QUOTES, 'UTF-8') ?>">
    <title>MeetVap</title>
</head>
<body>
    <p>
        <a href="<?= htmlspecialchars($target, ENT_QUOTES, 'UTF-8') ?>">Open MeetVap features</a>
    </p>
</body>
</html>
