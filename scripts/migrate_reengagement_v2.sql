-- =============================================================================
-- Migration: Re-engagement v2 — dynamic product listing in message
--   Adds product_base_url + collection_url to dbo.reengagement_settings
--   Updates default message template to use {CustomerName}, {Products},
--   {CollectionURL} placeholders.
-- Safe to re-run (idempotent column guards).
-- Apply: tsx scripts/apply_sql.ts scripts/migrate_reengagement_v2.sql
-- =============================================================================

IF COL_LENGTH('dbo.reengagement_settings', 'product_base_url') IS NULL
  ALTER TABLE dbo.reengagement_settings
    ADD product_base_url nvarchar(512) NOT NULL
        CONSTRAINT DF_reng_product_url DEFAULT (N'');
GO

IF COL_LENGTH('dbo.reengagement_settings', 'collection_url') IS NULL
  ALTER TABLE dbo.reengagement_settings
    ADD collection_url nvarchar(512) NOT NULL
        CONSTRAINT DF_reng_collection_url DEFAULT (N'');
GO

-- Update the message template to the new dynamic format.
-- Uses placeholders: {CustomerName}, {Products}, {CollectionURL}
UPDATE dbo.reengagement_settings
SET message = N'Hi {CustomerName} 👋

It''s been a while since your last purchase at Yuvarani Silks.

✨ New Arrivals:

{Products}

View Collection:
{CollectionURL}

We would love to serve you again ❤️'
WHERE id = 1;
GO
