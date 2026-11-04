CREATE TABLE jarvis_tasks (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jarvis_tasks_owner_created
  ON jarvis_tasks (owner_id, created_at DESC);

CREATE TABLE jarvis_memories (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'note' CHECK (category IN ('note', 'preference', 'goal', 'fact')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jarvis_memories_owner_created
  ON jarvis_memories (owner_id, created_at DESC);