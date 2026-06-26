<?php
// 共通ヘルパ（JSON応答・入力取得）。
declare(strict_types=1);

require_once __DIR__ . '/db.php';

// 整合性の衝突（参照あり削除・重複紐付け等）を表す例外。
// $info はフロントへ渡す付帯情報（refs 内訳・相手loginId 等）。HTTP 409 で返す。
class JoConflictException extends RuntimeException
{
    /** @var array */
    public $info;

    public function __construct(string $code, array $info = [])
    {
        parent::__construct($code);
        $this->info = $info;
    }
}

// JSON を返して終了する。
function jo_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// エラーJSONを返して終了する。staging では detail を含める。
function jo_error(string $message, int $status = 400, array $extra = []): void
{
    jo_json(array_merge(['ok' => false, 'error' => $message], $extra), $status);
}

// GET/POST/JSONボディをまとめて連想配列で返す。
function jo_input(): array
{
    $body = [];
    $raw = file_get_contents('php://input');
    if ($raw !== '' && $raw !== false) {
        $j = json_decode($raw, true);
        if (is_array($j)) {
            $body = $j;
        }
    }
    return array_merge($_GET, $_POST, $body);
}

// 例外詳細をレスポンスに載せてよいか（production 以外で true）。
function jo_is_debug(): bool
{
    return jo_config('env') !== 'production';
}
