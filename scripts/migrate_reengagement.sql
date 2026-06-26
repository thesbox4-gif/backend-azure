-- =============================================================================
-- Migration: Customer Re-engagement System
--   1. dbo.reengagement_settings  — singleton config row
--   2. dbo.reengagement_log       — per-customer send history (deduplication)
-- Safe to re-run (idempotent).
-- Apply: tsx scripts/apply_sql.ts scripts/migrate_reengagement.sql
-- =============================================================================

-- ── reengagement_settings (singleton) ────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'reengagement_settings'
)
BEGIN
  CREATE TABLE dbo.reengagement_settings (
    id              int            NOT NULL
                    CONSTRAINT PK_reengagement_settings PRIMARY KEY
                    CONSTRAINT CK_reengagement_settings_id CHECK (id = 1),
    inactivity_days int            NOT NULL
                    CONSTRAINT DF_reng_days    DEFAULT (30)
                    CONSTRAINT CK_reng_days    CHECK (inactivity_days IN (30, 60, 90)),
    enabled         bit            NOT NULL
                    CONSTRAINT DF_reng_enabled DEFAULT (1),
    message         nvarchar(max)  NOT NULL
                    CONSTRAINT DF_reng_message DEFAULT (N'Hello from Yuvarani Silks ' + NCHAR(10084) + N'

It''s been a while since your last purchase.

Explore our latest arrivals and exclusive collections.

We would love to serve you again.'),
    last_run_at     datetimeoffset NULL,
    updated_at      datetimeoffset NOT NULL
                    CONSTRAINT DF_reng_updated DEFAULT (sysdatetimeoffset()),
    updated_by      uniqueidentifier NULL
                    REFERENCES dbo.profiles(id)
  )

  -- Seed the single settings row
  INSERT INTO dbo.reengagement_settings (id, inactivity_days, enabled)
  VALUES (1, 30, 1)

  PRINT 'Created dbo.reengagement_settings and seeded default row'
END
ELSE
  PRINT 'dbo.reengagement_settings already exists — skipped'
GO

-- ── reengagement_log ──────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'reengagement_log'
)
BEGIN
  CREATE TABLE dbo.reengagement_log (
    id          uniqueidentifier NOT NULL
                CONSTRAINT DF_reng_log_id DEFAULT (newid())
                CONSTRAINT PK_reengagement_log PRIMARY KEY,
    customer_id uniqueidentifier NULL
                REFERENCES dbo.profiles(id) ON DELETE SET NULL,
    phone       nvarchar(64)     NOT NULL,
    channel     nvarchar(32)     NOT NULL
                CONSTRAINT CK_reng_log_channel CHECK (channel IN ('whatsapp', 'in_app')),
    sent_at     datetimeoffset   NOT NULL
                CONSTRAINT DF_reng_log_sent DEFAULT (sysdatetimeoffset())
  )
  PRINT 'Created dbo.reengagement_log'
END
ELSE
  PRINT 'dbo.reengagement_log already exists — skipped'
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'idx_reng_log_phone_sent' AND object_id = OBJECT_ID('dbo.reengagement_log')
)
  CREATE INDEX idx_reng_log_phone_sent ON dbo.reengagement_log (phone, sent_at DESC);
GO
