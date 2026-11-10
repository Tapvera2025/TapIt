-- =====================================================================
-- 0144 — One duplicate-matching key for lead phone numbers
--
-- Website, ad and imported leads store lead.phone_normalized as the digits
-- of the number's E.164 form ("919876543210"). Leads typed in by hand stored
-- the bare digits of whatever was typed ("9876543210", "09876543210"), so
-- the duplicate check on Add lead missed the same person entered another
-- way. The app now stores the E.164 digits for typed leads too; this brings
-- the existing ones into line with the same rule (normalizeLeadPhone):
--
--   "0091 98765 43210" -> drop the international prefix 00
--   "98765 43210"      -> a 10-digit number takes India's code, 91
--   "098765 43210"     -> so does 0 followed by 10 digits
--
-- Only keys that are still the bare digits of the typed number are touched,
-- so a key an import built with another country code is left alone. The
-- updated_at trigger is paused so the backfill does not count as activity
-- on every lead (the stalled-lead sweep reads updated_at).
-- =====================================================================

ALTER TABLE lead DISABLE TRIGGER trg_lead_updated;

WITH typed AS (
  SELECT l.organization_id, l.id, d.digits
    FROM lead l
    CROSS JOIN LATERAL (SELECT regexp_replace(l.phone, '\D', '', 'g') AS digits) d
   WHERE l.phone IS NOT NULL
     AND btrim(l.phone) NOT LIKE '+%'
     AND l.phone_normalized = d.digits
), canonical AS (
  SELECT organization_id, id, digits,
         CASE
           WHEN digits LIKE '00%'                           THEN substr(digits, 3)
           WHEN length(digits) = 10                         THEN '91' || digits
           WHEN length(digits) = 11 AND digits LIKE '0%'    THEN '91' || substr(digits, 2)
           ELSE digits
         END AS key
    FROM typed
)
UPDATE lead l
   SET phone_normalized = c.key
  FROM canonical c
 WHERE l.organization_id = c.organization_id
   AND l.id = c.id
   AND c.key <> c.digits
   AND c.key ~ '^[1-9][0-9]{1,14}$';

ALTER TABLE lead ENABLE TRIGGER trg_lead_updated;
