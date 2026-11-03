-- Converting a lead keeps its company and shows on the lead's timeline.
--
-- Leads added by hand kept the company only as a name, so a deal made from
-- one had no company. New leads now get a company record the same way
-- website and ad leads do, and conversion links one when a lead has none.
-- This fills in the deals made before that, and adds a "converted" entry to
-- the timeline of every lead that already became a deal.

ALTER TABLE lead_activity DROP CONSTRAINT IF EXISTS lead_activity_event_name_check;
ALTER TABLE lead_activity ADD CONSTRAINT lead_activity_event_name_check CHECK (event_name IN (
  'lead.created',
  'lead.assigned',
  'lead.reassigned',
  'lead.status_changed',
  'lead.nurtured',
  'lead.stalled',
  'lead.closed_lost',
  'lead.converted',
  'lead.reengaged',
  'call.recorded',
  'handover.offered',
  'handover.accepted',
  'handover.declined',
  'handover.expired',
  'handover.disposition_recorded',
  'callback.scheduled',
  'callback.rescheduled',
  'callback.completed',
  'callback.missed',
  'callback.cancelled',
  'callback.requested',
  'deal.creation_requested',
  'duplicate.warning',
  'whatsapp.message_received',
  'whatsapp.message_sent',
  'demo.scheduled',
  'demo.completed',
  'proposal.follow_up'
));

-- Deals made from a lead that had only a company name: add the company when
-- no company has that name yet (names match ignoring case) ...
INSERT INTO company (organization_id, name, created_by, created_at, updated_at)
SELECT DISTINCT ON (l.organization_id, lower(trim(l.company_name)))
       l.organization_id,
       trim(l.company_name),
       d.created_by,
       d.created_at,
       d.created_at
  FROM deal d
  JOIN lead l ON l.organization_id = d.organization_id AND l.id = d.originating_lead_id
 WHERE d.company_id IS NULL
   AND l.company_id IS NULL
   AND char_length(trim(l.company_name)) BETWEEN 1 AND 200
   AND NOT EXISTS (
     SELECT 1
       FROM company c
      WHERE c.organization_id = l.organization_id
        AND lower(c.name)     = lower(trim(l.company_name))
   )
 ORDER BY l.organization_id, lower(trim(l.company_name)), d.created_at;

-- ... then give each of those deals its lead's company.
UPDATE deal d
   SET company_id = COALESCE(l.company_id, (
         SELECT c.id
           FROM company c
          WHERE c.organization_id = l.organization_id
            AND lower(c.name)     = lower(trim(l.company_name))
          ORDER BY c.created_at, c.id
          LIMIT 1))
  FROM lead l
 WHERE d.company_id     IS NULL
   AND l.organization_id = d.organization_id
   AND l.id              = d.originating_lead_id
   AND (l.company_id IS NOT NULL OR char_length(trim(l.company_name)) BETWEEN 1 AND 200);

-- A timeline entry for each conversion made before conversions were recorded.
INSERT INTO lead_activity (organization_id, lead_id, event_name, actor_id, metadata, created_at)
SELECT d.organization_id,
       d.originating_lead_id,
       'lead.converted',
       d.created_by,
       jsonb_build_object('dealId', d.id, 'dealNumber', d.deal_number::text, 'title', d.title),
       d.created_at
  FROM deal d
 WHERE d.originating_lead_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM lead_activity a
      WHERE a.organization_id = d.organization_id
        AND a.lead_id         = d.originating_lead_id
        AND a.event_name      = 'lead.converted'
   );
