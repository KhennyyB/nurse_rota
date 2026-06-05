-- Migration: add late-start tracking columns to shift_logs
ALTER TABLE shift_logs
  ADD COLUMN IF NOT EXISTS is_late      BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS late_reason  TEXT;
