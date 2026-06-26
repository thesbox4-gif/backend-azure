-- =============================================================================
-- Migration: New Product Broadcast System
--   1. dbo.broadcast_settings  — singleton (enabled flag, product base URL)
--   2. dbo.broadcast_log       — one row per product broadcast event
--   3. dbo.broadcast_delivery  — per-customer delivery record
-- Safe to re-run (idempotent).
-- Apply: tsx scripts/apply_sql.ts scripts/migrate_broadcast.sql
-- =============================================================================

-- ── broadcast_settings (singleton) ───────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'broadcast_settings'
)
BEGIN
  CREATE TABLE dbo.broadcast_settings (
    id               int            NOT NULL
                     CONSTRAINT PK_broadcast_settings PRIMARY KEY
                     CONSTRAINT CK_broadcast_settings_id CHECK (id = 1),
    enabled          bit            NOT NULL
                     CONSTRAINT DF_bs_enabled DEFAULT (1),
    product_base_url nvarchar(512)  NOT NULL
                     CONSTRAINT DF_bs_url DEFAULT (N''),
    updated_at       datetimeoffset NOT NULL
                     CONSTRAINT DF_bs_updated DEFAULT (sysdatetimeoffset()),
    updated_by       uniqueidentifier NULL
                     REFERENCES dbo.profiles(id)
  )
  INSERT INTO dbo.broadcast_settings (id, enabled, product_base_url)
  VALUES (1, 1, N'')
  PRINT 'Created dbo.broadcast_settings and seeded default row'
END
ELSE
  PRINT 'dbo.broadcast_settings already exists — skipped'
GO

-- ── broadcast_log ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'broadcast_log'
)
BEGIN
  CREATE TABLE dbo.broadcast_log (
    id                uniqueidentifier NOT NULL
                      CONSTRAINT DF_bl_id DEFAULT (newid())
                      CONSTRAINT PK_broadcast_log PRIMARY KEY,
    product_id        uniqueidentifier NULL,   -- informational only, no FK cascade
    product_title     nvarchar(max)    NOT NULL,
    product_price     decimal(10,2)    NOT NULL,
    product_image_url nvarchar(max)    NULL,
    product_url       nvarchar(max)    NOT NULL,
    total_recipients  int              NOT NULL CONSTRAINT DF_bl_total   DEFAULT (0),
    whatsapp_sent     int              NOT NULL CONSTRAINT DF_bl_wa      DEFAULT (0),
    in_app_sent       int              NOT NULL CONSTRAINT DF_bl_inapp   DEFAULT (0),
    failed            int              NOT NULL CONSTRAINT DF_bl_failed  DEFAULT (0),
    triggered_by      uniqueidentifier NULL
                      REFERENCES dbo.profiles(id) ON DELETE SET NULL,
    created_at        datetimeoffset   NOT NULL
                      CONSTRAINT DF_bl_created DEFAULT (sysdatetimeoffset())
  )
  PRINT 'Created dbo.broadcast_log'
END
ELSE
  PRINT 'dbo.broadcast_log already exists — skipped'
GO

-- ── broadcast_delivery ────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'broadcast_delivery'
)
BEGIN
  CREATE TABLE dbo.broadcast_delivery (
    id           uniqueidentifier NOT NULL
                 CONSTRAINT DF_bd_id DEFAULT (newid())
                 CONSTRAINT PK_broadcast_delivery PRIMARY KEY,
    broadcast_id uniqueidentifier NOT NULL
                 REFERENCES dbo.broadcast_log(id) ON DELETE CASCADE,
    phone        nvarchar(64)     NOT NULL,
    customer_id  uniqueidentifier NULL,    -- registered customer, no FK (user may be deleted)
    channel      nvarchar(32)     NOT NULL
                 CONSTRAINT CK_bd_channel CHECK (channel IN ('whatsapp', 'in_app')),
    status       nvarchar(32)     NOT NULL
                 CONSTRAINT CK_bd_status  CHECK (status IN ('sent', 'failed')),
    error_msg    nvarchar(max)    NULL,
    sent_at      datetimeoffset   NOT NULL
                 CONSTRAINT DF_bd_sent DEFAULT (sysdatetimeoffset())
  )
  PRINT 'Created dbo.broadcast_delivery'
END
ELSE
  PRINT 'dbo.broadcast_delivery already exists — skipped'
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'idx_bd_broadcast' AND object_id = OBJECT_ID('dbo.broadcast_delivery')
)
  CREATE INDEX idx_bd_broadcast ON dbo.broadcast_delivery (broadcast_id, channel, status);
GO
