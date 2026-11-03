CREATE TABLE account_identities (
  provider text NOT NULL CHECK (provider IN ('google', 'facebook', 'discord')),
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);

INSERT INTO account_identities(provider, subject, user_id, name)
SELECT provider, subject, id, name FROM users;

ALTER TABLE sessions ADD COLUMN provider text;
UPDATE sessions SET provider = users.provider FROM users WHERE sessions.user_id = users.id;
ALTER TABLE sessions ALTER COLUMN provider SET NOT NULL;
ALTER TABLE sessions ADD CHECK (provider IN ('google', 'facebook', 'discord'));

ALTER TABLE oauth_states ADD COLUMN link_session_hash text REFERENCES sessions(token_hash) ON DELETE CASCADE;

CREATE TABLE account_merges (
  id uuid PRIMARY KEY,
  session_hash text NOT NULL UNIQUE REFERENCES sessions(token_hash) ON DELETE CASCADE,
  source_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_merges_expiry ON account_merges(expires_at);

ALTER TABLE users DROP COLUMN provider;
ALTER TABLE users DROP COLUMN subject;
