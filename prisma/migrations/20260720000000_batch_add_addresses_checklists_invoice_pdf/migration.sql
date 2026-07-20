-- ============================================================
-- Migration: batch_add_addresses_checklists_invoice_pdf
-- Date: 2026-07-20
-- Type: ADDITIVE ONLY — no existing tables modified (except Invoice.pdf_url which is nullable)
-- ============================================================

-- 1. Customer Saved Addresses
CREATE TABLE "CustomerAddress" (
    "id"          TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "address"     TEXT NOT NULL,
    "city"        TEXT,
    "pincode"     TEXT,
    "is_default"  BOOLEAN NOT NULL DEFAULT false,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerAddress_customer_id_idx" ON "CustomerAddress"("customer_id");

ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Invoice PDF URL (nullable — existing rows get NULL, regenerate on demand)
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "pdf_url" TEXT;

-- 3. Checklist Templates
CREATE TABLE "ChecklistTemplate" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "service_id"  TEXT,
    "is_active"   BOOLEAN NOT NULL DEFAULT true,
    "created_by"  TEXT NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChecklistTemplate_service_id_idx" ON "ChecklistTemplate"("service_id");

-- 4. Checklist Template Items
CREATE TABLE "ChecklistTemplateItem" (
    "id"          TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "sort_order"  INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChecklistTemplateItem_template_id_idx" ON "ChecklistTemplateItem"("template_id");

ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Job Checklist (per-job instance of a template)
CREATE TABLE "JobChecklist" (
    "id"          TEXT NOT NULL,
    "job_id"      TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "applied_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_by"  TEXT NOT NULL,

    CONSTRAINT "JobChecklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobChecklist_job_id_template_id_key" ON "JobChecklist"("job_id", "template_id");
CREATE INDEX "JobChecklist_job_id_idx" ON "JobChecklist"("job_id");

ALTER TABLE "JobChecklist" ADD CONSTRAINT "JobChecklist_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "ChecklistTemplate"("id") ON UPDATE CASCADE;

-- 6. Job Checklist Items (individual check items per job checklist)
CREATE TABLE "JobChecklistItem" (
    "id"           TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "sort_order"   INTEGER NOT NULL DEFAULT 0,
    "is_required"  BOOLEAN NOT NULL DEFAULT false,
    "is_checked"   BOOLEAN NOT NULL DEFAULT false,
    "checked_by"   TEXT,
    "checked_at"   TIMESTAMP(3),
    "notes"        TEXT,

    CONSTRAINT "JobChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobChecklistItem_checklist_id_idx" ON "JobChecklistItem"("checklist_id");

ALTER TABLE "JobChecklistItem" ADD CONSTRAINT "JobChecklistItem_checklist_id_fkey"
    FOREIGN KEY ("checklist_id") REFERENCES "JobChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
