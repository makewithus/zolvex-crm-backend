-- AddTable: CustomerFeedback
-- Additive migration — no existing tables altered.
-- FKs are nullable on booking_id and job_id to maintain zero coupling.

CREATE TABLE "CustomerFeedback" (
    "id"           TEXT NOT NULL,
    "customer_id"  TEXT NOT NULL,
    "booking_id"   TEXT,
    "job_id"        TEXT,
    "rating"       INTEGER NOT NULL,
    "comment"      TEXT,
    "submitted_by" TEXT NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "CustomerFeedback_customer_id_idx" ON "CustomerFeedback"("customer_id");
CREATE INDEX "CustomerFeedback_booking_id_idx" ON "CustomerFeedback"("booking_id");
CREATE INDEX "CustomerFeedback_rating_idx" ON "CustomerFeedback"("rating");

-- Foreign Keys
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
