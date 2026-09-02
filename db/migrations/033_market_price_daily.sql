-- 上市企业日行情事实；每个项目/交易日唯一，来源由 source_id 追溯。
CREATE TABLE IF NOT EXISTS market_price_daily (
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  trade_date DATE NOT NULL,
  open NUMERIC(20, 6) NOT NULL CHECK (open >= 0),
  close NUMERIC(20, 6) NOT NULL CHECK (close >= 0),
  high NUMERIC(20, 6) NOT NULL CHECK (high >= 0),
  low NUMERIC(20, 6) NOT NULL CHECK (low >= 0),
  volume NUMERIC(30, 6) NULL CHECK (volume IS NULL OR volume >= 0),
  amount NUMERIC(30, 6) NULL CHECK (amount IS NULL OR amount >= 0),
  source_id TEXT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, trade_date),
  CHECK (high >= low),
  CHECK (high >= open AND high >= close),
  CHECK (low <= open AND low <= close)
);
CREATE INDEX IF NOT EXISTS market_price_daily_project_date_idx ON market_price_daily (project_id, trade_date DESC);
COMMENT ON TABLE market_price_daily IS '公开行情日线事实；只用于展示历史走势，不构成投资建议。';
