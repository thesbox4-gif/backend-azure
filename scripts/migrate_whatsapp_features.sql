-- =============================================================================
-- Migration: WhatsApp Enquiries & Live Video Shopping
-- Tables: dbo.product_enquiries, dbo.video_bookings
-- Safe to re-run (idempotent — skips if tables already exist)
-- Apply: tsx scripts/apply_sql.ts scripts/migrate_whatsapp_features.sql
-- =============================================================================

-- ── product_enquiries ─────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'product_enquiries'
)
BEGIN
  CREATE TABLE dbo.product_enquiries (
    id            uniqueidentifier NOT NULL
                  CONSTRAINT DF_product_enquiries_id      DEFAULT (newid())
                  CONSTRAINT PK_product_enquiries         PRIMARY KEY,
    product_id    uniqueidentifier NULL,
    product_name  nvarchar(255)    NULL,
    customer_name nvarchar(255)    NOT NULL,
    phone         nvarchar(64)     NOT NULL,
    message       nvarchar(max)    NULL,
    status        nvarchar(32)     NOT NULL
                  CONSTRAINT DF_product_enquiries_status  DEFAULT ('new')
                  CONSTRAINT CK_product_enquiries_status  CHECK (status IN ('new', 'responded', 'closed')),
    created_at    datetimeoffset   NOT NULL
                  CONSTRAINT DF_product_enquiries_created DEFAULT (sysdatetimeoffset())
  )
  PRINT 'Created dbo.product_enquiries'
END
ELSE
  PRINT 'dbo.product_enquiries already exists — skipped'

GO

-- ── video_bookings ────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE schema_id = SCHEMA_ID('dbo') AND name = 'video_bookings'
)
BEGIN
  CREATE TABLE dbo.video_bookings (
    id             uniqueidentifier NOT NULL
                   CONSTRAINT DF_video_bookings_id        DEFAULT (newid())
                   CONSTRAINT PK_video_bookings           PRIMARY KEY,
    customer_name  nvarchar(255)    NOT NULL,
    phone          nvarchar(64)     NOT NULL,
    preferred_date date             NOT NULL,
    preferred_time nvarchar(16)     NOT NULL,
    notes          nvarchar(max)    NULL,
    status         nvarchar(32)     NOT NULL
                   CONSTRAINT DF_video_bookings_status    DEFAULT ('pending')
                   CONSTRAINT CK_video_bookings_status    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
    created_at     datetimeoffset   NOT NULL
                   CONSTRAINT DF_video_bookings_created   DEFAULT (sysdatetimeoffset())
  )
  PRINT 'Created dbo.video_bookings'
END
ELSE
  PRINT 'dbo.video_bookings already exists — skipped'

GO
