<?php
declare(strict_types=1);

function database(): PDO
{
    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '3306';
    $name = getenv('DB_NAME') ?: 'aerolinea_db';
    $user = getenv('DB_USER') ?: 'root';
    $password = getenv('DB_PASSWORD') ?: '';

    $localConfig = __DIR__ . '/mysql.local.php';
    if ($password === '' && is_file($localConfig)) {
        $password = (string) (require $localConfig)['password'];
    }

    $pdo = new PDO(
        "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4",
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ]
    );
    $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo->exec("SET character_set_client = 'utf8mb4'");
    $pdo->exec("SET character_set_results = 'utf8mb4'");
    $pdo->exec("SET character_set_connection = 'utf8mb4'");

    return $pdo;
}
