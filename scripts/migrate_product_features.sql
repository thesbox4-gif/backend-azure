-- =============================================================================
-- Migration: Product Features
--   1. dbo.customer_notifications  — subscription list
--   2. dbo.products rack columns   — rack_block, rack_row, rack_position
--   3. dbo.products barcode_image_url
--   4. dbo.ai_quota_settings upload_limit
-- Safe to re-run (idempotent).
-- Apply: tsx scripts/apply_sql.ts scripts/migrate_product_features.sql
-- =============================================================================

-- ── customer_notifications ────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'customer_notifications'
)
BEGIN
  CREATE TABLE dbo.customer_notifications (
    id              uniqueidentifier NOT NULL
                    CONSTRAINT DF_cn_id      DEFAULT (newid())
                    CONSTRAINT PK_cn         PRIMARY KEY,
    customer_id     uniqueidentifier NULL
                    REFERENCES dbo.profiles(id) ON DELETE SET NULL,
    phone           nvarchar(64)     NOT NULL,
    whatsapp_number nvarchar(64)     NULL,
    subscribed      bit              NOT NULL
                    CONSTRAINT DF_cn_subscribed DEFAULT (1),
    created_at      datetimeoffset   NOT NULL
                    CONSTRAINT DF_cn_created DEFAULT (sysdatetimeoffset()),
    CONSTRAINT UQ_cn_phone UNIQUE (phone)
  )
  PRINT 'Created dbo.customer_notifications'
END
ELSE
  PRINT 'dbo.customer_notifications already exists — skipped'
GO

-- ── rack columns on dbo.products ──────────────────────────────────────────────
IF COL_LENGTH('dbo.products', 'rack_block') IS NULL
  ALTER TABLE dbo.products ADD rack_block nvarchar(32) NULL;
GO
IF COL_LENGTH('dbo.products', 'rack_row') IS NULL
  ALTER TABLE dbo.products ADD rack_row nvarchar(32) NULL;
GO
IF COL_LENGTH('dbo.products', 'rack_position') IS NULL
  ALTER TABLE dbo.products ADD rack_position nvarchar(32) NULL;
GO

-- ── barcode_image_url on dbo.products ─────────────────────────────────────────
IF COL_LENGTH('dbo.products', 'barcode_image_url') IS NULL
  ALTER TABLE dbo.products ADD barcode_image_url nvarchar(max) NULL;
GO

-- ── upload_limit on dbo.ai_quota_settings ─────────────────────────────────────
IF COL_LENGTH('dbo.ai_quota_settings', 'upload_limit') IS NULL
  ALTER TABLE dbo.ai_quota_settings ADD upload_limit int NOT NULL
    CONSTRAINT DF_aiq_upload_limit DEFAULT (500);
GO
