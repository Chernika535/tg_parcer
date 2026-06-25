-- Telegram Feed Aggregator schema. Idempotent: safe to run on every deploy.

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,                 -- 'local' для однопользовательской версии
    tg_chat_id  BIGINT,                           -- куда слать сводки
    timezone    TEXT NOT NULL DEFAULT 'Europe/Moscow',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feeds (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_channels (
    id          BIGSERIAL PRIMARY KEY,
    feed_id     BIGINT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    username    TEXT NOT NULL,                     -- канал без @, нижний регистр
    UNIQUE (feed_id, username)
);

CREATE TABLE IF NOT EXISTS digests (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    keywords      TEXT[] NOT NULL DEFAULT '{}',    -- ключевые слова для фильтра
    channels      TEXT[] NOT NULL DEFAULT '{}',    -- источники (usernames) для этого парсинга
    send_hour     SMALLINT NOT NULL,              -- 0..23, локальное время пользователя
    send_minute   SMALLINT NOT NULL DEFAULT 0,    -- 0..59
    enabled       BOOLEAN NOT NULL DEFAULT true,
    last_sent_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Кэш постов, чтобы не перечитывать t.me/s на каждый запрос и беречь трафик.
CREATE TABLE IF NOT EXISTS posts (
    id            BIGSERIAL PRIMARY KEY,
    channel       TEXT NOT NULL,                   -- username без @
    msg_id        BIGINT NOT NULL,                 -- номер сообщения из t.me/s
    posted_at     TIMESTAMPTZ NOT NULL,
    text          TEXT NOT NULL DEFAULT '',
    has_media     BOOLEAN NOT NULL DEFAULT false,
    link          TEXT NOT NULL,                   -- https://t.me/<channel>/<msg_id>
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_channel_time ON posts (channel, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_posted_at    ON posts (posted_at DESC);

-- Гарантировать наличие пользователя по умолчанию.
INSERT INTO users (id) VALUES ('local') ON CONFLICT (id) DO NOTHING;
