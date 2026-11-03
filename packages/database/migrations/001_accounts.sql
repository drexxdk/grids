CREATE TABLE users (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('google', 'facebook', 'discord')),
  subject text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE oauth_states (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  provider text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);

CREATE TABLE grids (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 70),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grids_owner ON grids(user_id, updated_at DESC);

CREATE TABLE presets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 70),
  public boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presets_owner ON presets(user_id, updated_at DESC);
CREATE INDEX presets_public ON presets(updated_at DESC) WHERE public;
