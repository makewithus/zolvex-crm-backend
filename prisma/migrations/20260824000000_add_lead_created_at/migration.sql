-- Migration: add_lead_created_at
-- Adds created_at timestamp to the Lead table.
-- Only touches Lead — no other tables, no drops, no data loss.
-- Existing rows receive CURRENT_TIMESTAMP as their created_at value.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
